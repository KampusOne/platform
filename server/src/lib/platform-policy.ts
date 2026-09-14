export const COMMISSION_VERSION = "launch-2026-09-13";
export const MINIMUM_WITHDRAWAL_KOBO = 500_000;
export function commissionFor(grossKobo: number) {
  if (!Number.isSafeInteger(grossKobo) || grossKobo < 0)
    throw new RangeError("Invalid money amount");
  const basisPoints =
    grossKobo <= 250_000 ? 200 : grossKobo <= 500_000 ? 300 : 500;
  const commissionKobo = Number(
    (BigInt(grossKobo) * BigInt(basisPoints) + 5000n) / 10000n,
  );
  return {
    basisPoints,
    commissionKobo,
    netKobo: grossKobo - commissionKobo,
    version: COMMISSION_VERSION,
  };
}
export function ageOn(birthDate: string, at = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return -1;
  const dob = new Date(`${birthDate}T00:00:00Z`);
  if (
    !Number.isFinite(dob.getTime()) ||
    dob.toISOString().slice(0, 10) !== birthDate
  )
    return -1;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  const years = Number(today.slice(0, 4)) - dob.getUTCFullYear();
  return years - (today.slice(5) < birthDate.slice(5) ? 1 : 0);
}
export function allowedAgentAge(birthDate: string, at?: Date) {
  return ageOn(birthDate, at) >= 16;
}
