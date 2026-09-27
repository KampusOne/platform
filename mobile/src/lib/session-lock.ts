/** Serialize cookie mutations across tabs without storing tokens in browser storage. */
export async function withSessionLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      return await navigator.locks.request(
        "kampusone.session.v1",
        { mode: "exclusive", signal: controller.signal },
        () => {
          // Only lock acquisition expires, never a running cookie mutation.
          clearTimeout(timer);
          return operation();
        },
      );
    } finally { clearTimeout(timer); }
  }
  return operation();
}
