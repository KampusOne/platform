import { afterEach, describe, expect, it, vi } from "vitest";

import { CampusRoutingProviderError, fetchCampusWalkingRoute } from "./campus-routing";

afterEach(() => vi.restoreAllMocks());

describe("fetchCampusWalkingRoute", () => {
  it("normalizes OSRM walking geometry and steps", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "Ok",
          routes: [{
            distance: 430.4,
            duration: 340.2,
            geometry: { type: "LineString", coordinates: [[5.61, 6.4], [5.62, 6.401]] },
            legs: [{ steps: [{ distance: 120, duration: 90, name: "Uniben Road", maneuver: { type: "turn", modifier: "left" } }] }],
          }],
        }),
        { status: 200 },
      ),
    );

    const route = await fetchCampusWalkingRoute({
      baseUrl: "https://routing.example.test/route/v1/driving",
      from: { latitude: 6.4, longitude: 5.61 },
      to: { latitude: 6.401, longitude: 5.62 },
      timeoutMs: 100,
    });

    expect(route.distance).toBe(430.4);
    expect(route.geometry.coordinates).toHaveLength(2);
    expect(route.steps[0]?.maneuver.modifier).toBe("left");
  });

  it("rejects unusable provider responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "NoRoute", routes: [] }), { status: 200 }),
    );

    await expect(
      fetchCampusWalkingRoute({
        from: { latitude: 6.4, longitude: 5.61 },
        to: { latitude: 6.401, longitude: 5.62 },
        timeoutMs: 100,
      }),
    ).rejects.toBeInstanceOf(CampusRoutingProviderError);
  });
});
