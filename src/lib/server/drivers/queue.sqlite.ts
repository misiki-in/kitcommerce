/**
 * Default queue driver: the database itself.
 *
 * No broker in core. `sync_jobs` is a durable queue -- jobs survive restarts,
 * retries are scheduled rows, and the outbox commits in the same transaction as
 * the state change that produced it. Redis/NATS/SQS drivers can replace this
 * later without the sync engine noticing.
 *
 * SQLite has one writer, so a claim inside an exclusive transaction is already
 * serialised; the Postgres driver uses SELECT ... FOR UPDATE SKIP LOCKED to get
 * the same guarantee with many writers.
 */
import type { Db, EnqueueInput, Job, Queue } from "../ports";
import { newId } from "../ids";

/** Spec 20: 5s, 30s, 2m, 10m, 30m -- then dead-letter. */
export const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000];

export function sqliteQueue(db: Db): Queue {
  return {
    name: "sqlite",

    enqueue(input: EnqueueInput): string | null {
      const id = newId("job");
      const now = Date.now();
      // The unique index on idempotency_key is the dedupe barrier: re-queuing
      // the same logical operation is a no-op, not a duplicate remote write.
      const existing = db.get<{ id: string }>(
        "SELECT id FROM sync_jobs WHERE idempotency_key = ?",
        [input.idempotencyKey],
      );
      if (existing) return null;

      db.run(
        `INSERT INTO sync_jobs
           (id, organization_id, store_id, channel_id, operation, entity_type,
            entity_id, idempotency_key, payload, status, attempt_count,
            max_attempts, next_attempt_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,'PENDING',0,?,?,?)`,
        [
          id,
          input.organizationId,
          input.storeId,
          input.channelId ?? "",
          input.operation,
          input.entityType,
          input.entityId,
          input.idempotencyKey,
          JSON.stringify(input.payload ?? {}),
          input.maxAttempts ?? BACKOFF_MS.length,
          input.runAt ?? now,
          now,
        ],
      );
      return id;
    },

    claim(workerId: string, limit: number): Job[] {
      const now = Date.now();
      return db.tx(() => {
        const due = db.all<Job>(
          `SELECT * FROM sync_jobs
            WHERE status IN ('PENDING','RETRYING') AND next_attempt_at <= ?
            ORDER BY next_attempt_at ASC
            LIMIT ?`,
          [now, limit],
        );
        for (const j of due) {
          db.run(
            `UPDATE sync_jobs
                SET status='RUNNING', locked_by=?, locked_at=?,
                    attempt_count = attempt_count + 1,
                    started_at = COALESCE(started_at, ?)
              WHERE id = ?`,
            [workerId, now, now, j.id],
          );
          j.attempt_count += 1;
          j.status = "RUNNING";
        }
        return due;
      });
    },

    succeed(jobId: string, durationMs: number): void {
      const now = Date.now();
      db.tx(() => {
        const job = db.get<Job>("SELECT * FROM sync_jobs WHERE id = ?", [jobId]);
        if (!job) return;
        db.run(
          `UPDATE sync_jobs
              SET status='SUCCEEDED', completed_at=?, last_error='', error_class='',
                  locked_by='', locked_at=NULL
            WHERE id = ?`,
          [now, jobId],
        );
        db.run(
          `INSERT INTO sync_attempts
             (id, job_id, attempt, status, duration_ms, created_at)
           VALUES (?,?,?,'SUCCEEDED',?,?)`,
          [newId("att"), jobId, job.attempt_count, durationMs, now],
        );
      });
    },

    fail(jobId, err, durationMs): void {
      const now = Date.now();
      db.tx(() => {
        const job = db.get<Job>("SELECT * FROM sync_jobs WHERE id = ?", [jobId]);
        if (!job) return;

        const exhausted = job.attempt_count >= job.max_attempts;
        // A validation error is permanent: retrying it forever just burns rate
        // limit and hides the real problem from the merchant (spec 43).
        const dead = exhausted || !err.retryable;

        if (dead) {
          db.run(
            `UPDATE sync_jobs
                SET status='DEAD_LETTER', completed_at=?, last_error=?, error_class=?,
                    locked_by='', locked_at=NULL
              WHERE id = ?`,
            [now, err.message.slice(0, 2000), err.class, jobId],
          );
        } else {
          const idx = Math.min(job.attempt_count - 1, BACKOFF_MS.length - 1);
          const delay = err.retryAfterMs ?? BACKOFF_MS[Math.max(0, idx)]!;
          db.run(
            `UPDATE sync_jobs
                SET status='RETRYING', next_attempt_at=?, last_error=?, error_class=?,
                    locked_by='', locked_at=NULL
              WHERE id = ?`,
            [now + delay, err.message.slice(0, 2000), err.class, jobId],
          );
        }

        db.run(
          `INSERT INTO sync_attempts
             (id, job_id, attempt, status, error, error_class, duration_ms, created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            newId("att"),
            jobId,
            job.attempt_count,
            dead ? "DEAD_LETTER" : "FAILED",
            err.message.slice(0, 2000),
            err.class,
            durationMs,
            now,
          ],
        );
      });
    },

    retry(jobId: string): void {
      db.run(
        `UPDATE sync_jobs
            SET status='PENDING', next_attempt_at=?, attempt_count=0,
                last_error='', error_class='', completed_at=NULL,
                locked_by='', locked_at=NULL
          WHERE id = ?`,
        [Date.now(), jobId],
      );
    },

    reapStale(olderThanMs: number): number {
      const cutoff = Date.now() - olderThanMs;
      const stale = db.all<{ id: string }>(
        "SELECT id FROM sync_jobs WHERE status='RUNNING' AND locked_at IS NOT NULL AND locked_at < ?",
        [cutoff],
      );
      for (const s of stale) {
        db.run(
          `UPDATE sync_jobs
              SET status='RETRYING', next_attempt_at=?, locked_by='', locked_at=NULL,
                  last_error='worker died mid-flight; requeued', error_class='RETRYABLE'
            WHERE id = ?`,
          [Date.now(), s.id],
        );
      }
      return stale.length;
    },
  };
}
