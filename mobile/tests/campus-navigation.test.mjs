import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDistance,
  formatDuration,
  isInsideCampus,
  pointInPolygon,
  shouldRefreshWalkingRoute,
} from "../src/lib/campus-map.ts";

const campus = {
  name: "Ugbowo campus",
  slug: "ugbowo",
  latitude: "6.398255",
  longitude: "5.618838",
  boundary: [
    [5.6091, 6.40525],
    [5.6279, 6.405],
    [5.6277, 6.394],
    [5.6102, 6.3942],
    [5.6091, 6.40525],
  ],
};

test("campus polygon separates on-campus and off-campus locations", () => {
  assert.equal(pointInPolygon([5.618, 6.4], campus.boundary), true);
  assert.equal(pointInPolygon([5.618, 6.35], campus.boundary), false);
  assert.equal(
    isInsideCampus({ latitude: 6.4, longitude: 5.618 }, campus),
    true,
  );
  assert.equal(
    isInsideCampus({ latitude: 6.35, longitude: 5.618 }, campus),
    false,
  );
});

test("route refresh waits for elapsed time and meaningful movement", () => {
  const previous = [5.618, 6.4];
  assert.equal(
    shouldRefreshWalkingRoute(previous, [5.618, 6.40002], 0, 20_000),
    false,
  );
  assert.equal(
    shouldRefreshWalkingRoute(previous, [5.618, 6.40035], 10_000, 20_000),
    false,
  );
  assert.equal(
    shouldRefreshWalkingRoute(previous, [5.618, 6.40035], 0, 20_000),
    true,
  );
});

test("walking summaries stay compact", () => {
  assert.equal(formatDistance(420), "420 m");
  assert.equal(formatDistance(1350), "1.4 km");
  assert.equal(formatDuration(660), "11 min");
});
