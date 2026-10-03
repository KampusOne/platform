export const intakePhoneCountries = [
  { code: "+234", name: "Nigeria", nationalLength: 10, trunkZero: true },
  { code: "+233", name: "Ghana", nationalLength: 9, trunkZero: true },
  { code: "+229", name: "Benin", nationalLength: 10, trunkZero: false },
  { code: "+237", name: "Cameroon", nationalLength: 9, trunkZero: false },
  { code: "+44", name: "United Kingdom", nationalLength: 10, trunkZero: true },
  { code: "+1", name: "United States / Canada", nationalLength: 10, trunkZero: false },
] as const;

/** Keep the calling code once, including numbers pasted into a national field. */
export function normalizeIntakePhone(value: string, callingCode = "+234") {
  const raw = value.trim();
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  const international = raw.startsWith("+") || raw.startsWith("00");
  if (raw.startsWith("00")) digits = digits.slice(2);
  if (!digits) return raw === "+" ? "+" : "";
  const country = international
    ? intakePhoneCountries.find(({ code }) => digits.startsWith(code.slice(1)))
    : intakePhoneCountries.find(({ code }) => code === callingCode);
  // Preserve explicitly international numbers outside the selector's countries.
  if (!country) return international ? `+${digits}` : callingCode + digits;
  const prefix = country.code.slice(1);
  let national = international ? digits.slice(prefix.length) : digits;
  if (country.trunkZero) national = national.replace(/^0/, "");
  // A complete prefixed number or an old duplicated-prefix draft, never a
  // partial national number whose first few digits happen to match the code.
  if (national.length > country.nationalLength && national.startsWith(prefix))
    national = national.slice(prefix.length);
  if (country.trunkZero) national = national.replace(/^0/, "");
  return country.code + national;
}
