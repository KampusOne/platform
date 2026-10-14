/** PostgreSQL timestamps must use the ISO grammar supported by Android/Hermes. */
export function normalizeApiTimestamp(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(text)) return text;
  return text.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}

export function apiDate(value: unknown): Date | null {
  const date = new Date(normalizeApiTimestamp(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatApiDate(value: unknown, options: Intl.DateTimeFormatOptions): string {
  const date = apiDate(value);
  return date ? new Intl.DateTimeFormat('en-NG', options).format(date) : 'Date unavailable';
}
