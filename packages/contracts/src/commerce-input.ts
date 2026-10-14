/** Shared by the Worker and clients without importing a validation runtime. */
export function normalizeNigerianPhone(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, '');
  if (/^0[789]\d{9}$/.test(compact)) return '+234' + compact.slice(1);
  if (/^234[789]\d{9}$/.test(compact)) return '+' + compact;
  return compact;
}

export const recipientNameError = 'Enter a recipient name with at least 2 characters.';
export const recipientPhoneError = 'Enter a valid Nigerian mobile number, such as 08012345678 or +2348012345678.';
export const paidAgentOrderStatuses = ['PAID', 'ACCEPTED', 'READY', 'IN_DELIVERY', 'DELIVERED'] as const;
export function isPaidAgentOrder(status: string): boolean {
  return (paidAgentOrderStatuses as readonly string[]).includes(status);
}
