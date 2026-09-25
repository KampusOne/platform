/** Identity and statistics must not depend on each other's availability. */
export async function refreshProfileResources<P, G, B, F>(
  read: <T>(path: string) => Promise<T>,
  onIdentity: (result: PromiseSettledResult<P>) => void,
) {
  const identity = read<P>("/v1/student/me").then(
    (value) => onIdentity({ status: "fulfilled", value }),
    (reason: unknown) => onIdentity({ status: "rejected", reason }),
  );
  const statistics = Promise.allSettled([
    read<G>("/v1/student/gpa"),
    read<B>("/v1/student/purchases"),
    read<F>("/v1/student/feed"),
  ] as const);
  // Attach both handlers immediately, including when identity settles first.
  const [results] = await Promise.all([statistics, identity]);
  return results;
}

export function profileFailureMessage(error: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You’re offline. Your saved profile is still available. Reconnect to refresh.";
  }
  if (error instanceof TypeError) return "Could not connect. Check your connection and try again.";
  if (error instanceof Error && error.name === "TimeoutError") return "The connection timed out. Try again.";
  if (error instanceof Error && error.name === "ApiError") return error.message;
  return "Your profile could not be refreshed. Try again.";
}
