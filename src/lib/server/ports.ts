/**
 * Infrastructure ports.
 *
 * These interfaces are the third plugin plane, alongside platform adapters and
 * marketplace connectors. Each port's DEFAULT driver must need zero external
 * infrastructure; every other driver is opt-in and must satisfy the same
 * contract without widening it.
 *
 * Rule: the interface is defined by the WEAKEST guarantee any driver can meet.
 * If a driver needs a stronger guarantee to be useful, that is a new port, not
 * a wider one. (This is why Kafka belongs on EventBus and never on Queue --
 * Kafka's offset model cannot express per-job ack, delay and dead-letter.)
 */

// ------------------------------------------------------------------ database

export type Row = Record<string, any>;

export interface Db {
  /** Rows for a SELECT. */
  all<T = Row>(sql: string, params?: any[]): T[];
  /** First row or null. */
  get<T = Row>(sql: string, params?: any[]): T | null;
  /** INSERT/UPDATE/DELETE. */
  run(sql: string, params?: any[]): void;
  /** Run a multi-statement script (migrations). */
  exec(sql: string): void;
  /** Runs fn inside a transaction; rolls back if fn throws. */
  tx<T>(fn: () => T): T;
  close(): void;
}

// --------------------------------------------------------------------- queue

export type JobStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "RETRYING"
  | "DEAD_LETTER";

export interface Job {
  id: string;
  organization_id: string;
  store_id: string;
  channel_id: string;
  operation: string;
  entity_type: string;
  entity_id: string;
  idempotency_key: string;
  payload: string;
  status: JobStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: number;
  last_error: string;
  error_class: string;
  created_at: number;
}

export interface EnqueueInput {
  organizationId: string;
  storeId: string;
  channelId?: string;
  operation: string;
  entityType: string;
  entityId: string;
  /** Duplicate keys are silently collapsed -- this is the idempotency barrier. */
  idempotencyKey: string;
  payload?: unknown;
  maxAttempts?: number;
  runAt?: number;
}

export interface Queue {
  readonly name: string;
  enqueue(input: EnqueueInput): string | null;
  /** Atomically claim up to `limit` due jobs for this worker. */
  claim(workerId: string, limit: number): Job[];
  succeed(jobId: string, durationMs: number): void;
  /** Reschedule with backoff, or dead-letter once attempts are exhausted. */
  fail(
    jobId: string,
    err: { message: string; class: string; retryable: boolean; retryAfterMs?: number },
    durationMs: number,
  ): void;
  retry(jobId: string): void;
  /** Release jobs whose worker died mid-flight. */
  reapStale(olderThanMs: number): number;
}

// ----------------------------------------------------------------- event bus

export interface DomainEvent {
  name: string; // product.updated.v1
  organizationId: string;
  storeId: string;
  payload: Record<string, unknown>;
}

export interface EventBus {
  readonly name: string;
  /** Written in the same transaction as the state change (outbox). */
  publish(e: DomainEvent): void;
  subscribe(pattern: string, handler: (e: DomainEvent) => void | Promise<void>): void;
  /** Drain unpublished outbox rows to subscribers. */
  drain(limit: number): Promise<number>;
}

// -------------------------------------------------------------------- search

export interface SearchHit {
  id: string;
  score: number;
}

export interface Search {
  readonly name: string;
  query(storeId: string, q: string, limit: number): SearchHit[];
}

// -------------------------------------------------------------------- notify

export interface Message {
  to: string;
  subject: string;
  text: string;
}

export interface Notify {
  readonly name: string;
  send(m: Message): Promise<void>;
}

// ---------------------------------------------------------------------- blob

export interface Blob {
  readonly name: string;
  /** Returns the public URL for the stored object. */
  put(key: string, data: ArrayBuffer | Uint8Array, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
}

// ------------------------------------------------------------------- secrets

export interface Secrets {
  readonly name: string;
  seal(plain: unknown): Promise<Uint8Array>;
  open<T = unknown>(sealed: Uint8Array): Promise<T>;
}
