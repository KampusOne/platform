import { normalizePaymentReturn } from '../../packages/contracts/src/payment-links';

// Run before route matching on both a cold launch and a foreground callback.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return normalizePaymentReturn(path) ?? path;
}
