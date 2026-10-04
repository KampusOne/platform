/** Numeric construction works consistently in Hermes and browsers; no user-entered date parsing. */
export function selectedActivityDate(date: string, time = '23:59'): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  const year = Number(day[1]), month = Number(day[2]), dateOfMonth = Number(day[3]);
  const hour = Number(clock[1]), minute = Number(clock[2]);
  if (year < 1000 || month < 1 || month > 12 || dateOfMonth < 1 || hour > 23 || minute > 59) return null;
  const result = new Date(year, month - 1, dateOfMonth, hour, minute);
  return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === dateOfMonth && result.getHours() === hour && result.getMinutes() === minute ? result : null;
}
export function calendarDate(value: Date): string {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
}
export function selectedDateLabel(value: string): string {
  const date = selectedActivityDate(value, '12:00');
  return date ? date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Choose a date';
}
export function selectedTimeLabel(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return 'Choose a time';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}
