/** Expo has no send idempotency key. Retry only a confirmed rejection. */
export function retryablePushError(code: string | null | undefined) {
  return code === 'MessageRateExceeded' || code === 'PUSH_HTTP_429';
}
export function pushRetryDelaySeconds(attempts: number) {
  return Math.min(1800, 30 * 2 ** Math.max(0, Math.min(6, attempts - 1)));
}
