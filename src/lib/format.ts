/** Shared display helpers, so every page formats money and time identically. */

const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", GBP: "£", EUR: "€", AED: "د.إ" };

export function money(cents: number, currency = "INR"): string {
  return `${SYMBOL[currency] ?? ""}${(cents / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function timeAgo(ms: number | null | undefined): string {
  if (!ms) return "never";
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

/** Status -> badge variant, in one place so every status looks the same everywhere. */
export function statusVariant(status: string): "success" | "secondary" | "warning" | "destructive" {
  switch (status) {
    case "HEALTHY": case "LIVE": case "SUCCEEDED": case "ACTIVE": case "MAPPED":
      return "success";
    case "INCOMPLETE": case "RATE_LIMITED": case "DEGRADED": case "RETRYING":
      return "warning";
    case "FAILED": case "DEAD_LETTER": case "ERROR": case "AUTH_FAILURE": case "API_FAILURE":
      return "destructive";
    default:
      return "secondary";
  }
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").toLowerCase();
}
