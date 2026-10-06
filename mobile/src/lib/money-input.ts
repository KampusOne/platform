/** Parse the decimal input once; database/API amounts always use integer kobo. */
export function nairaToKobo(value: string): number {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim().replace(/,/g, ''));
  if (!match) throw new Error('Enter a price with at most two decimal places.');
  const kobo = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(kobo) || kobo > 100_000_000) throw new Error('Enter a price up to ₦1,000,000.');
  return kobo;
}
