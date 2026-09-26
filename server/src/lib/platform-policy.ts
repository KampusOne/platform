export const MINIMUM_WITHDRAWAL_KOBO = 500_000;
// Money calculations live in the versioned database fee engine.
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
