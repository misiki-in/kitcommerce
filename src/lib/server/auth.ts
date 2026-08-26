/**
 * Identity, sessions, and the single authorization chokepoint.
 *
 * MVP tenancy: signup creates a personal organization, which owns one store.
 * There are no teams, no roles and no invites -- but the org exists in the data
 * model from the first row, so adding `memberships` later is an addition rather
 * than a migration of every table.
 */
import { config } from "./config";
import { newId, token } from "./ids";
import type { Db } from "./ports";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Principal {
  user: User;
  organizationId: string;
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function createAuth(db: Db) {
  const now = () => Date.now();

  return {
    async signup(email: string, password: string, name: string): Promise<Principal> {
      const normalized = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
        throw new AuthError("enter a valid email address");
      }
      if (password.length < 8) {
        throw new AuthError("password must be at least 8 characters");
      }
      const clash = db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", [normalized]);
      if (clash) throw new AuthError("an account with that email already exists");

      // Bun's built-in argon2id -- no bcrypt dependency to install.
      const hash = await Bun.password.hash(password);
      const userId = newId("usr");
      const orgId = newId("org");

      db.tx(() => {
        db.run(
          "INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)",
          [userId, normalized, hash, name.trim(), now()],
        );
        db.run(
          "INSERT INTO organizations (id, name, owner_user_id, created_at) VALUES (?,?,?,?)",
          [orgId, name.trim() ? `${name.trim()}'s workspace` : normalized, userId, now()],
        );
        // Written now so the phase-2 role check has a row to read.
        db.run(
          "INSERT INTO memberships (id, organization_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
          [newId("mem"), orgId, userId, "owner", now()],
        );
      });

      return { user: { id: userId, email: normalized, name: name.trim() }, organizationId: orgId };
    },

    async login(email: string, password: string): Promise<Principal> {
      const normalized = email.trim().toLowerCase();
      const row = db.get<{ id: string; email: string; name: string; password_hash: string }>(
        "SELECT * FROM users WHERE email = ?",
        [normalized],
      );
      // Same message either way so the endpoint does not confirm which emails
      // have accounts.
      const invalid = new AuthError("incorrect email or password", 401);
      if (!row) {
        // Constant-ish work regardless of whether the user exists.
        await Bun.password.hash(password);
        throw invalid;
      }
      const ok = await Bun.password.verify(password, row.password_hash);
      if (!ok) throw invalid;

      const org = db.get<{ id: string }>(
        "SELECT id FROM organizations WHERE owner_user_id = ?",
        [row.id],
      );
      if (!org) throw new AuthError("account has no organization", 500);

      return {
        user: { id: row.id, email: row.email, name: row.name },
        organizationId: org.id,
      };
    },

    /**
     * Sign in (or sign up) via a verified Google profile.
     *
     * A federated account gets a random local password hash it can never use:
     * the column is NOT NULL, and leaving it empty would make an empty password
     * submission verify against it.
     */
    async upsertFederated(profile: {
      email: string;
      name: string;
    }): Promise<{ principal: Principal; created: boolean }> {
      const email = profile.email.trim().toLowerCase();
      const existing = db.get<{ id: string; email: string; name: string }>(
        "SELECT id, email, name FROM users WHERE email = ?",
        [email],
      );

      if (existing) {
        const org = db.get<{ id: string }>(
          "SELECT id FROM organizations WHERE owner_user_id = ?",
          [existing.id],
        );
        if (!org) throw new AuthError("account has no organization", 500);
        return {
          principal: {
            user: { id: existing.id, email: existing.email, name: existing.name },
            organizationId: org.id,
          },
          created: false,
        };
      }

      const hash = await Bun.password.hash(token(48));
      const userId = newId("usr");
      const orgId = newId("org");
      const name = profile.name.trim() || email.split("@")[0]!;

      db.tx(() => {
        db.run(
          "INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)",
          [userId, email, hash, name, now()],
        );
        db.run(
          "INSERT INTO organizations (id, name, owner_user_id, created_at) VALUES (?,?,?,?)",
          [orgId, `${name}'s workspace`, userId, now()],
        );
        db.run(
          "INSERT INTO memberships (id, organization_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
          [newId("mem"), orgId, userId, "owner", now()],
        );
      });

      return {
        principal: { user: { id: userId, email, name }, organizationId: orgId },
        created: true,
      };
    },

    createSession(userId: string): string {
      const id = token(32);
      db.run("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)", [
        id,
        userId,
        now() + config.sessionTtlMs,
        now(),
      ]);
      return id;
    },

    resolveSession(sessionId: string | null): Principal | null {
      if (!sessionId) return null;
      const row = db.get<{
        user_id: string; expires_at: number; email: string; name: string;
      }>(
        `SELECT s.user_id, s.expires_at, u.email, u.name
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = ?`,
        [sessionId],
      );
      if (!row) return null;
      if (row.expires_at < now()) {
        db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
        return null;
      }
      const org = db.get<{ id: string }>(
        "SELECT id FROM organizations WHERE owner_user_id = ?",
        [row.user_id],
      );
      if (!org) return null;
      return {
        user: { id: row.user_id, email: row.email, name: row.name },
        organizationId: org.id,
      };
    },

    destroySession(sessionId: string): void {
      db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * THE authorization chokepoint.
 *
 * Every access decision in the app goes through these functions. Today the body
 * is an ownership comparison; when teams and roles arrive it becomes a
 * membership + permission lookup, and only this file changes. Inline
 * `if (row.organization_id === principal.organizationId)` checks scattered
 * across handlers are what turn RBAC into a rewrite -- so there are none.
 */
export function createAuthz(db: Db) {
  return {
    canAccessStore(p: Principal, storeId: string): boolean {
      const row = db.get<{ organization_id: string }>(
        "SELECT organization_id FROM stores WHERE id = ?",
        [storeId],
      );
      return row != null && row.organization_id === p.organizationId;
    },

    canAccessProduct(p: Principal, productId: string): boolean {
      const row = db.get<{ organization_id: string }>(
        "SELECT organization_id FROM products WHERE id = ?",
        [productId],
      );
      return row != null && row.organization_id === p.organizationId;
    },

    canAccessChannel(p: Principal, channelId: string): boolean {
      const row = db.get<{ organization_id: string }>(
        "SELECT organization_id FROM channels WHERE id = ?",
        [channelId],
      );
      return row != null && row.organization_id === p.organizationId;
    },

    canAccessJob(p: Principal, jobId: string): boolean {
      const row = db.get<{ organization_id: string }>(
        "SELECT organization_id FROM sync_jobs WHERE id = ?",
        [jobId],
      );
      return row != null && row.organization_id === p.organizationId;
    },

    /** Service-layer cap, deliberately not a UNIQUE constraint. */
    canCreateStore(p: Principal): boolean {
      const row = db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM stores WHERE organization_id = ?",
        [p.organizationId],
      );
      return (row?.n ?? 0) < config.maxStoresPerOrg;
    },
  };
}

export type Authz = ReturnType<typeof createAuthz>;
