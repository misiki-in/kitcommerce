/**
 * The built-in marketplace simulator.
 *
 * Every connector ships a mock path so the entire pipeline -- publish, price
 * sync, inventory sync, order import, retry, dead-letter -- is demonstrable on
 * a fresh clone with no seller account and no credentials. Switching a channel
 * to "live" changes nothing above the connector.
 *
 * Remote IDs are derived from the SKU rather than random, so a retry produces
 * the same remote ID and the idempotency guarantee is actually observable.
 */
import { ConnectorError, type ConnectorContext } from "../connector";

export function mockRemoteId(prefix: string, sku: string): string {
  let h = 0;
  for (let i = 0; i < sku.length; i++) h = (h * 31 + sku.charCodeAt(i)) >>> 0;
  return `${prefix}${h.toString(36).toUpperCase().padStart(7, "0")}`;
}

/** Simulated network latency so job durations and the UI look realistic. */
export async function mockLatency(ctx: ConnectorContext): Promise<void> {
  const ms = Number(ctx.config.mockLatencyMs ?? 120);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/**
 * Optional fault injection. Set `mockFailureRate: 0.3` on a channel to watch
 * the retry ladder and dead-lettering work end to end.
 */
export function mockMaybeFail(ctx: ConnectorContext, op: string): void {
  const rate = Number(ctx.config.mockFailureRate ?? 0);
  if (rate <= 0) return;
  if (Math.random() >= rate) return;

  const roll = Math.random();
  if (roll < 0.45) {
    throw new ConnectorError(`simulated upstream 503 during ${op}`, "RETRYABLE");
  }
  if (roll < 0.75) {
    throw new ConnectorError(`simulated rate limit during ${op}`, "RATE_LIMITED", {
      retryAfterMs: 15_000,
    });
  }
  throw new ConnectorError(
    `simulated validation failure during ${op}: marketplace rejected the payload`,
    "VALIDATION",
  );
}
