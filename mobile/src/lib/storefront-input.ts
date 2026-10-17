import { normalizeNigerianPhone } from '../../../packages/contracts/src/commerce-input';
export type StorefrontDraft = {
  name: string; description: string; phone: string; pickup: string;
  additionalLocations: string; pickupPlace: string | null; instructions: string;
  hours: string; preparationMinutes: number;
};
export function storefrontInput(draft: StorefrontDraft, submit = false) {
  const contactPhoneE164 = normalizeNigerianPhone(draft.phone);
  const pickupLocations = [...new Set([draft.pickup, ...draft.additionalLocations.split('\n')].map(x => x.trim()).filter(Boolean))];
  const payload = {
    displayName: draft.name.trim(), description: draft.description.trim(), contactPhoneE164,
    pickupLocation: draft.pickup.trim(), pickupLocations, pickupPlaceId: draft.pickupPlace,
    pickupInstructions: draft.instructions.trim(),
    openingHours: draft.hours.trim() ? { schedule: draft.hours.trim() } : {},
    defaultPreparationMinutes: draft.preparationMinutes,
  };
  const errors: Record<string, string> = {};
  if (payload.displayName.length < 2 || payload.displayName.length > 120) errors.name = 'Enter a store name with 2–120 characters.';
  if (payload.description.length < 10 || payload.description.length > 2000) errors.description = 'Describe your store in 10–2,000 characters.';
  if (!/^\+234[789]\d{9}$/.test(contactPhoneE164)) errors.phone = 'Enter a Nigerian mobile number, such as 08012345678.';
  if (payload.pickupLocation.length < 5 || payload.pickupLocation.length > 500) errors.pickup = 'Enter a pickup address with 5–500 characters.';
  if (pickupLocations.length > 100 || pickupLocations.some(x => x.length < 3 || x.length > 500)) errors.additionalLocations = 'Use up to 100 pickup locations, each with 3–500 characters.';
  if (payload.pickupInstructions.length > 1000) errors.instructions = 'Keep pickup instructions within 1,000 characters.';
  if (draft.hours.trim().length > 160) errors.hours = 'Keep opening hours within 160 characters.';
  else if (submit && !draft.hours.trim()) errors.hours = 'Add opening hours before submitting your store for review.';
  return { payload, errors };
}
/** Older stores may have per-day {opens, closes} records. Never show [object Object]. */
export function storefrontHours(value: Record<string, unknown>) {
  return Object.entries(value).flatMap(([day, entry]) => {
    if (typeof entry === 'string') return [entry];
    if (entry && typeof entry === 'object' && 'opens' in entry && 'closes' in entry)
      return [`${day}: ${String(entry.opens)}–${String(entry.closes)}`];
    return [];
  }).join('; ');
}
