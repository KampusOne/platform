import assert from "node:assert/strict";
import test from "node:test";

import {
  formatWalkingDistance,
  formatWalkingDuration,
  normalizeCampusBounds,
  pointInsideCampus,
  shouldRefreshWalkingRoute,
} from "../src/lib/campus-navigation.ts";

const bounds = normalizeCampusBounds({ north: "6.4065", south: "6.3915", east: "5.629", west: "5.608" });

test("campus bounds separate on-campus and off-campus locations", () => {
  assert.ok(bounds);
  assert.equal(pointInsideCampus({ latitude: 6.4, longitude: 5.618 }, bounds), true);
  assert.equal(pointInsideCampus({ latitude: 6.35, longitude: 5.618 }, bounds), false);
});

test("route refresh waits for elapsed time and meaningful movement", () => {
  const previous = { latitude: 6.4, longitude: 5.618 };
  assert.equal(shouldRefreshWalkingRoute(previous, { latitude: 6.40002, longitude: 5.618 }, 0, 20_000), false);
  assert.equal(shouldRefreshWalkingRoute(previous, { latitude: 6.4003, longitude: 5.618 }, 10_000, 20_000), false);
  assert.equal(shouldRefreshWalkingRoute(previous, { latitude: 6.4003, longitude: 5.618 }, 0, 20_000), true);
});

test("walking summaries stay compact", () => {
  assert.equal(formatWalkingDistance(420), "420 m");
  assert.equal(formatWalkingDistance(1350), "1.4 km");
  assert.equal(formatWalkingDuration(660), "11 min");
});
