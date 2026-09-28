/** Normalize API/Postgres timestamps to an ECMAScript ISO form Hermes parses consistently. */
function normalizeFeedTimestamp(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(trimmed)) return trimmed;
  return trimmed
    .replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

/** KampusOne's requested timeline policy: relative for 28 days, then a date. */
export function feedTime(value: unknown, now = Date.now()): { text: string; label: string; exact: string } {
  const date = new Date(normalizeFeedTimestamp(value));
  if (!Number.isFinite(date.getTime())) return { text: "Recently", label: "Publication time unavailable", exact: "Publication time unavailable" };
  const exact = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 60) return { text: "now", label: "Just now", exact };
  const units: [number, number, string, string][] = [
    [3600, 60, "m", "minute"], [86400, 3600, "h", "hour"],
    [604800, 86400, "d", "day"], [2419200, 604800, "w", "week"],
  ];
  for (const [limit, divisor, short, long] of units) {
    if (seconds < limit) {
      const count = Math.floor(seconds / divisor);
      return { text: `${count}${short}`, label: `${count} ${long}${count === 1 ? "" : "s"} ago`, exact };
    }
  }
  return {
    text: new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" as const } : {}) }).format(date),
    label: exact, exact,
  };
}

export function compactCount(value: unknown): string {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return "0";
  return new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 }).format(Math.floor(count));
}
