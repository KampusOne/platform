/** PostgreSQL text timestamps are not portable to Hermes. API dates use ISO 8601. */
export function isoTimestamp(value: string | Date): string {
  return new Date(value).toISOString();
}
