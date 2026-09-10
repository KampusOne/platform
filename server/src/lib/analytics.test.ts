import { describe, expect, it } from "vitest";

import { validateAnalyticsBatch } from "./analytics";

const baseEvent = {
  eventId: "10000000-0000-4000-8000-000000000101",
  occurredAt: "2026-09-10T09:00:00.000Z",
  institutionId: "10000000-0000-4000-8000-000000000001",
  sessionId: "10000000-0000-4000-8000-000000000102",
  eventName: "screen.time",
  surface: "mobile",
  platform: "android",
};

describe("analytics payload boundary", () => {
  it("accepts an allow-listed pseudonymous event", () => {
    const result = validateAnalyticsBatch({
      events: [{ ...baseEvent, durationMs: 4200, properties: { screen: "today" } }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects sensitive property keys", () => {
    const result = validateAnalyticsBatch({
      events: [{ ...baseEvent, properties: { email: "student@example.com" } }],
    });
    expect(result).toEqual({
      ok: false,
      message: "events[0].properties contains a prohibited key.",
    });
  });

  it("rejects events outside the allow-list", () => {
    const result = validateAnalyticsBatch({
      events: [{ ...baseEvent, eventName: "student.profile.dump" }],
    });
    expect(result).toEqual({
      ok: false,
      message: "events[0].eventName is not allow-listed.",
    });
  });
});
