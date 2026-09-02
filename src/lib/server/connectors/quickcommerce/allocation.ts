/**
 * Dark-store inventory allocation helpers.
 */
import type { ConnectorContext } from "../../connector";

export function allocateStock(
  available: number,
  locations: string[],
  strategy: string,
): Array<{ location: string; quantity: number }> {
  if (locations.length === 0) return [{ location: "", quantity: available }];

  if (strategy === "split") {
    const base = Math.floor(available / locations.length);
    const remainder = available % locations.length;
    return locations.map((location, i) => ({
      location,
      quantity: base + (i < remainder ? 1 : 0),
    }));
  }
  return locations.map((location) => ({ location, quantity: available }));
}

export function locationsOf(ctx: ConnectorContext): string[] {
  const raw = ctx.config.locations;
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter(Boolean);
}
