import test from "node:test";
import assert from "node:assert/strict";
import { isFeedRoutePath, isFeedRoutePlaybackActive, pickFullyVisibleVideo, setFeedRoutePlaybackActive, subscribeFeedRoutePlayback } from "../mobile/src/lib/feed-video-playback.ts";
import { clearVideoPlaybackSession, readVideoPlaybackSession, writeVideoPlaybackSession } from "../mobile/src/lib/video-playback-session.ts";
import { postVideoSource } from "../mobile/src/lib/video-source.ts";

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

test('current media-array videos play when legacy image_url and media_type are absent', () => {
  const url = 'https://api.kampusone.app/v1/media/8ea652a5-7061-4b16-a0cb-609f24470de4?access=signed.token';
  assert.equal(postVideoSource({ image_url: null, media_type: null, media: [{ type: 'video/mp4', url }] }), url);
  assert.equal(postVideoSource({ media: [{ type: 'image/jpeg', url: 'https://example.com/photo.jpg' }, { type: 'video/webm', url }] }), url);
});

test('validated API video metadata takes priority over a stale legacy source', () => {
  assert.equal(postVideoSource({ image_url: 'https://example.com/old.mp4', media_type: 'video', media: [{ type: 'video/mp4', url: '/api/v1/media/current' }] }), '/api/v1/media/current');
  assert.equal(postVideoSource({ image_url: 'https://example.com/old.mp4', media_type: 'video/mp4', media: [{ type: 7, url: 'https://example.com/bad' }] }), 'https://example.com/old.mp4');
});

test('malformed, image-only and unsupported video URLs never create a video source', () => {
  for (const value of [null, {}, { media: [null, { type: 'video/mp4', url: {} }] }, { media: [{ type: 'image/jpeg', url: 'https://example.com/photo.jpg' }] }, { media: [{ type: 'video/mp4', url: 'javascript:alert(1)' }] }, { media_type: 7, image_url: 'https://example.com/photo.jpg' }])
    assert.equal(postVideoSource(value), '');
});
