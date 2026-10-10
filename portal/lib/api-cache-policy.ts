/**
 * All portal reads are deduplicated. Critical state never reuses a finished
 * snapshot, while non-sensitive pages can reuse one within the current session.
 */
export function portalReadCacheTtl(path: string): number {
  const route = path.split("?")[0] ?? "";
  if (!/^\/v1\//.test(route)) return 0;
  if (
    /^\/v1\/(?:auth|media|admin|manage|payments|payout-setup|usage|ai|agents|applications)(?:\/|$)/.test(route) ||
    /\/(?:wallet|balance|ledger|payment|payout|checkout|quote|earnings|commission|orders|purchases|webhook|live-location|rider-location)(?:\/|$)/.test(route)
  ) return 0;
  if (/^\/v1\/(?:messages|notifications)(?:\/|$)/.test(route)) return 2_000;
  if (/^\/v1\/(?:student\/catalog|maps|student\/campus)(?:\/|$)/.test(route)) return 60_000;
  if (/^\/v1\/(?:student\/feed|people|communities|student\/store)(?:\/|$)/.test(route)) return 5_000;
  if (route === "/v1/config/public") return 15_000;
  return 10_000;
}
