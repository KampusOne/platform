/** Serialize cookie mutations across tabs without storing tokens in browser storage. */
export async function withSessionLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(
      "kampusone.session.v1",
      { mode: "exclusive", signal: AbortSignal.timeout(30_000) },
      operation,
    );
  }
  return operation();
}
