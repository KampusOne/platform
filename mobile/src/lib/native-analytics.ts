import type { PendingAnalyticsEvent } from "./analytics";

export async function deliverNativeAnalytics(
  _event: PendingAnalyticsEvent,
): Promise<boolean> {
  return false;
}
