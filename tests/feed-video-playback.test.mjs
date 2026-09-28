import test from "node:test";
import assert from "node:assert/strict";
import { pickFullyVisibleVideo } from "../mobile/src/lib/feed-video-playback.ts";
import { clearVideoPlaybackSession, readVideoPlaybackSession, writeVideoPlaybackSession } from "../mobile/src/lib/video-playback-session.ts";

test("feed video activates only when the whole video is inside the usable viewport", () => {
  assert.equal(
    pickFullyVisibleVideo([{ id: "full", y: 100, height: 300 }], 80, 700),
    "full",
  );
  assert.equal(
    pickFullyVisibleVideo([{ id: "top-partial", y: 79, height: 300 }], 80, 700, 0),
    null,
  );
  assert.equal(
    pickFullyVisibleVideo([{ id: "bottom-partial", y: 500, height: 201 }], 80, 700, 0),
    null,
  );
});

test("partial videos never win over a fully visible video", () => {
  assert.equal(
    pickFullyVisibleVideo(
      [
        { id: "above", y: -40, height: 260 },
        { id: "visible", y: 240, height: 260 },
        { id: "below", y: 620, height: 260 },
      ],
      40,
      680,
      0,
    ),
    "visible",
  );
});

test("when two videos fully fit, only the one closest to viewport center is active", () => {
  assert.equal(
    pickFullyVisibleVideo(
      [
        { id: "upper", y: 80, height: 160 },
        { id: "center", y: 300, height: 160 },
      ],
      40,
      700,
      0,
    ),
    "center",
  );
});

test("invalid or empty measurements cannot autoplay a video", () => {
  assert.equal(pickFullyVisibleVideo([], 40, 700), null);
  assert.equal(pickFullyVisibleVideo([{ id: "zero", y: 100, height: 0 }], 40, 700), null);
  assert.equal(pickFullyVisibleVideo([{ id: "bad", y: Number.NaN, height: 100 }], 40, 700), null);
});


test("video playback session preserves timestamp and mute state across screens", () => {
  clearVideoPlaybackSession("post-1");
  assert.equal(readVideoPlaybackSession("post-1"), null);
  writeVideoPlaybackSession("post-1", 12.75, false);
  const saved = readVideoPlaybackSession("post-1");
  assert.equal(saved?.position, 12.75);
  assert.equal(saved?.muted, false);
  clearVideoPlaybackSession("post-1");
  assert.equal(readVideoPlaybackSession("post-1"), null);
});

test("video playback session ignores invalid positions", () => {
  clearVideoPlaybackSession("post-2");
  writeVideoPlaybackSession("post-2", Number.NaN, true);
  writeVideoPlaybackSession("post-2", -1, true);
  assert.equal(readVideoPlaybackSession("post-2"), null);
});
import test from "node:test";
import assert from "node:assert/strict";
import { isFeedRoutePath, isFeedRoutePlaybackActive, pickFullyVisibleVideo, setFeedRoutePlaybackActive, subscribeFeedRoutePlayback } from "../mobile/src/lib/feed-video-playback.ts";
import { clearVideoPlaybackSession, readVideoPlaybackSession, writeVideoPlaybackSession } from "../mobile/src/lib/video-playback-session.ts";

test("feed video activates only when the whole video is inside the usable viewport", () => {
  assert.equal(
    pickFullyVisibleVideo([{ id: "full", y: 100, height: 300 }], 80, 700),
    "full",
  );
  assert.equal(
    pickFullyVisibleVideo([{ id: "top-partial", y: 79, height: 300 }], 80, 700, 0),
    null,
  );
  assert.equal(
    pickFullyVisibleVideo([{ id: "bottom-partial", y: 500, height: 201 }], 80, 700, 0),
    null,
  );
});

test("partial videos never win over a fully visible video", () => {
  assert.equal(
    pickFullyVisibleVideo(
      [
        { id: "above", y: -40, height: 260 },
        { id: "visible", y: 240, height: 260 },
        { id: "below", y: 620, height: 260 },
      ],
      40,
      680,
      0,
    ),
    "visible",
  );
});

test("when two videos fully fit, only the one closest to viewport center is active", () => {
  assert.equal(
    pickFullyVisibleVideo(
      [
        { id: "upper", y: 80, height: 160 },
        { id: "center", y: 300, height: 160 },
      ],
      40,
      700,
      0,
    ),
    "center",
  );
});

test("invalid or empty measurements cannot autoplay a video", () => {
  assert.equal(pickFullyVisibleVideo([], 40, 700), null);
  assert.equal(pickFullyVisibleVideo([{ id: "zero", y: 100, height: 0 }], 40, 700), null);
  assert.equal(pickFullyVisibleVideo([{ id: "bad", y: Number.NaN, height: 100 }], 40, 700), null);
});


test("video playback session preserves timestamp and mute state across screens", () => {
  clearVideoPlaybackSession("post-1");
  assert.equal(readVideoPlaybackSession("post-1"), null);
  writeVideoPlaybackSession("post-1", 12.75, false);
  const saved = readVideoPlaybackSession("post-1");
  assert.equal(saved?.position, 12.75);
  assert.equal(saved?.muted, false);
  clearVideoPlaybackSession("post-1");
  assert.equal(readVideoPlaybackSession("post-1"), null);
});

test("video playback session ignores invalid positions", () => {
  clearVideoPlaybackSession("post-2");
  writeVideoPlaybackSession("post-2", Number.NaN, true);
  writeVideoPlaybackSession("post-2", -1, true);
  assert.equal(readVideoPlaybackSession("post-2"), null);
});


test("route playback gate disables feed audio outside the feed route", () => {
  setFeedRoutePlaybackActive(false);
  const states = [];
  const unsubscribe = subscribeFeedRoutePlayback((active) => states.push(active));
  assert.equal(isFeedRoutePlaybackActive(), false);
  setFeedRoutePlaybackActive(true);
  assert.equal(isFeedRoutePlaybackActive(), true);
  setFeedRoutePlaybackActive(false);
  assert.equal(isFeedRoutePlaybackActive(), false);
  unsubscribe();
  setFeedRoutePlaybackActive(true);
  assert.deepEqual(states, [false, true, false]);
  setFeedRoutePlaybackActive(false);
});

test("only the feed pathname enables feed playback", () => {
  assert.equal(isFeedRoutePath("/feed"), true);
  assert.equal(isFeedRoutePath("/feed/"), true);
  assert.equal(isFeedRoutePath("feed"), true);
  assert.equal(isFeedRoutePath("/explore"), false);
  assert.equal(isFeedRoutePath("/map"), false);
  assert.equal(isFeedRoutePath("/profile"), false);
  assert.equal(isFeedRoutePath("/post"), false);
  assert.equal(isFeedRoutePath("/video"), false);
  assert.equal(isFeedRoutePath("/notifications"), false);
});
