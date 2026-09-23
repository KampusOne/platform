/** The HTTP request is shared; cancellation belongs to each caller, not the cache. */
export function waitForRequest<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Request cancelled"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Request cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** View tracking must not evict the feed, profile, timetable and every other read. */
export function invalidationTargets(path: string): string[] | null {
  if (/^\/v1\/student\/feed\/[^/]+\/view$/.test(path)) return [];
  if (path.startsWith("/v1/student/feed")) return ["/v1/student/feed", "/v1/student/home"];
  if (path.startsWith("/v1/media")) return ["/v1/student/me", "/v1/student/feed", "/v1/student/home"];
  if (path.startsWith("/v1/student/timetable")) return ["/v1/student/timetable", "/v1/student/home"];
  if (path.startsWith("/v1/student/gpa")) return ["/v1/student/gpa", "/v1/student/home"];
  return null; // Unknown mutations and session transitions invalidate conservatively.
}
export function matchesRead(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "?") || path.startsWith(prefix + "/");
}
