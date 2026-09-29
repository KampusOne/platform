import { afterEach, describe, expect, it, vi } from "vitest";

import {
  sendGoogleAnalyticsBatch,
  type ProductAnalyticsBatch,
} from "./google-analytics";
import type { Bindings } from "../types";

const batch: ProductAnalyticsBatch = {
  clientId: "123456789.1790660000",
  platform: "android",
  appVersion: "0.3.10",
  buildNumber: "40",
  events: [
    {
      name: "page_view",
      timestampMs: 1_790_660_000_000,
      sessionId: "1790660000",
      screen: "today",
    },
    {
      name: "ui_interaction",
      timestampMs: 1_790_660_001_000,
      sessionId: "1790660000",
      screen: "today",
      action: "open_timetable",
      component: "dashboard_shortcut",
    },
  ],
};

function env(values: Partial<Bindings>): Bindings {
  return values as Bindings;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Analytics delivery", () => {
  it("does not call Google when the kill switch is off", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const result = await sendGoogleAnalyticsBatch(
      env({ GA4_ANALYTICS_ENABLED: "false" }),
      batch,
    );

    expect(result).toEqual({ status: "disabled" });
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the API secret in the Worker request URL and sends only structured product data", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);

    const result = await sendGoogleAnalyticsBatch(
      env({
        GA4_ANALYTICS_ENABLED: "true",
        GA4_MEASUREMENT_ID: "G-TEST123",
        GA4_API_SECRET: "worker-only-secret",
      }),
      batch,
    );

    expect(result).toEqual({ status: "sent" });
    expect(request).toHaveBeenCalledTimes(1);

    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toContain("measurement_id=G-TEST123");
    expect(String(url)).toContain("api_secret=worker-only-secret");

    const payload = JSON.parse(String((init as RequestInit).body));
    expect(payload.client_id).toBe(batch.clientId);
    expect(payload.events).toHaveLength(2);
    expect(payload.events[0].name).toBe("page_view");
    expect(payload.events[0].params.page_location).toBe(
      "https://app.kampusone.app/screen/today",
    );
    expect(JSON.stringify(payload)).not.toContain("email");
    expect(JSON.stringify(payload)).not.toContain("prompt");
  });
});
