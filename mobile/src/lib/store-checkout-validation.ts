import { normalizeNigerianPhone, recipientNameError, recipientPhoneError } from '../../../packages/contracts/src/commerce-input';
export { normalizeNigerianPhone };
export type CheckoutFieldErrors = Record<string, string>;
export function checkoutRecipientErrors(value: { recipientName: string; recipientPhoneE164: string; fulfilmentMode?: string; deliveryLocation?: string | null }): CheckoutFieldErrors {
  const errors: CheckoutFieldErrors = {};
  if (value.recipientName.trim().length < 2) errors.recipientName = recipientNameError;
  else if (value.recipientName.trim().length > 120) errors.recipientName = 'Keep the recipient name within 120 characters.';
  if (!/^\+234[789]\d{9}$/.test(normalizeNigerianPhone(value.recipientPhoneE164))) errors.recipientPhoneE164 = recipientPhoneError;
  if (value.fulfilmentMode !== 'PICKUP' && (value.deliveryLocation?.trim().length ?? 0) < 5) errors.deliveryLocation = 'Enter the delivery address with at least 5 characters.';
  return errors;
}
export function checkoutServerFieldErrors(details?: Record<string, unknown>): CheckoutFieldErrors {
  const fields = details?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  const errors: CheckoutFieldErrors = {};
  for (const [field, messages] of Object.entries(fields)) {
    if (Array.isArray(messages) && typeof messages[0] === 'string') errors[field] = messages[0];
  }
  return errors;
}
