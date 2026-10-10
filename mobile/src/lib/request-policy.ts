/** The HTTP request is shared; cancellation belongs to each caller, not the cache. */
export function waitForRequest<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Request cancelled"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("Request cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

/** Background bookkeeping must never evict unrelated screen data. */
export function invalidationTargets(path: string): string[] | null {
  if (/^\/v1\/student\/feed\/[^/]+\/view$/.test(path)) return [];
  if (path === "/v1/student/events") return [];
  if (path === "/v1/analytics/events") return [];
  if (path === "/v1/notifications/alarm-events") return [];
  if (
    path === "/v1/notifications/devices" ||
    /^\/v1\/notifications\/devices\//.test(path)
  )
    return [];

  if (path === "/v1/account/streak") return ["/v1/student/home"];
  if (path.startsWith("/v1/student/feed"))
    return ["/v1/student/feed", "/v1/student/home"];
  if (path.startsWith("/v1/media"))
    return /^\/v1\/media\/message-uploads(?:\/|$)/.test(path) ? [] : ["/v1/student/me", "/v1/student/feed", "/v1/student/home"];
  if (path.startsWith("/v1/student/timetable"))
    return ["/v1/student/timetable", "/v1/student/home"];
  if (path.startsWith("/v1/student/gpa"))
    return ["/v1/student/gpa", "/v1/student/home"];
  if (/^\/v1\/messages\/threads\/[^/]+\/read$/.test(path))
    return ["/v1/messages/inbox"];
  if (path.startsWith("/v1/messages")) return ["/v1/messages"];
  if (path.startsWith("/v1/notifications")) return ["/v1/notifications"];
  if (path.startsWith("/v1/learning/alarms"))
    return ["/v1/learning/alarms", "/v1/student/timetable"];
  if (path.startsWith("/v1/calendar")) return ["/v1/calendar"];
  if (path.startsWith("/v1/communities")) return ["/v1/communities"];
  if (path.startsWith("/v1/applications")) return ["/v1/applications"];
  if (path.startsWith("/v1/agents")) return ["/v1/agents"];
  if (path.startsWith("/v1/people"))
    return ["/v1/people", "/v1/student/feed"];
  if (path.startsWith("/v1/account"))
    return ["/v1/account", "/v1/student/me", "/v1/student/home"];

  return null; // Unknown mutations and session transitions invalidate conservatively.
}
export function matchesRead(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "?") || path.startsWith(prefix + "/");
}

/**
 * Every feature participates in account-local read caching, but not every value
 * may be *reused*. Money, access, live GPS and AI usage are deduplicated only
 * while a read is in flight. These responses are never stored as snapshots.
 *
 * This is deliberately an in-memory policy, not AsyncStorage or a CDN policy:
 * private responses must not survive account changes or become shared across
 * university tenants. Individual screens may opt out with cache: "no-store".
 */
export type ReadCachePolicy = { freshMs: number; retainMs: number };
export function readCachePolicy(path: string): ReadCachePolicy {
  const resource = path.split("?")[0] ?? "";
  const freshOnly: ReadCachePolicy = { freshMs: 0, retainMs: 0 };
  if (!/^\/v1\//.test(resource)) return freshOnly;
  // Authorization, prices, transactions and live operations must be fresh.
  if (
    /^\/v1\/(?:auth|media|payments|payout-setup|usage|ai|admin|manage)(?:\/|$)/.test(resource) ||
    /\/(?:wallet|balance|ledger|payment|payments|payout|payouts|checkout|quote|quotes|earnings|commission|commissions|orders|purchases|webhook|webhooks|live-location|rider-location|delivery-status|status-check)(?:\/|$)/.test(resource)
  ) return freshOnly;
  if (resource === "/v1/config/public") return { freshMs: 15_000, retainMs: 30_000 };
  if (/^\/v1\/config(?:\/|$)/.test(resource)) return freshOnly;
  // User-private conversations are only kept in RAM for a few seconds.
  if (/^\/v1\/messages(?:\/|$)/.test(resource)) return { freshMs: 1_500, retainMs: 12_000 };
  if (/^\/v1\/notifications(?:\/|$)/.test(resource)) return { freshMs: 2_000, retainMs: 10_000 };
  if (/^\/v1\/(?:maps|student\/campus|student\/catalog)(?:\/|$)/.test(resource))
    return { freshMs: 300_000, retainMs: 900_000 };
  if (/^\/v1\/(?:student\/timetable|student\/gpa|calendar|exams|learning\/alarms)(?:\/|$)/.test(resource))
    return { freshMs: 30_000, retainMs: 300_000 };
  if (/^\/v1\/(?:student\/feed|discovery|communities)(?:\/|$)/.test(resource))
    return { freshMs: 5_000, retainMs: 60_000 };
  if (/^\/v1\/(?:people|student\/me|account)(?:\/|$)/.test(resource))
    return { freshMs: 10_000, retainMs: 60_000 };
  if (/^\/v1\/(?:student\/store|student\/tutorials|agents|tutor-commerce)(?:\/|$)/.test(resource))
    return { freshMs: 12_000, retainMs: 90_000 };
  if (/^\/v1\/student\/home(?:\/|$)/.test(resource))
    return { freshMs: 8_000, retainMs: 120_000 };
  return { freshMs: 10_000, retainMs: 60_000 };
}
