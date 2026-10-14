/** PostgreSQL's spaces, microseconds and short offsets are not portable to Hermes. */
export function normalizeServerTimestamp(value: string): string {
  return value.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}
export function serverDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (value === '' || (typeof value === 'number' && !Number.isFinite(value))) return null;
  const date = new Date(typeof value === 'string' ? normalizeServerTimestamp(value) : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Normalize full timestamp fields in fresh and cached responses, preserving
 * calendar dates, clock strings and the student's literal text. */
export function normalizeServerDates<T>(payload: T): T {
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      typeof child === 'string' && /(?:_at|At|PeriodEnd)$/.test(key)
        && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(child)
        ? normalizeServerTimestamp(child) : visit(child),
    ]));
  }
  return visit(payload) as T;
}
