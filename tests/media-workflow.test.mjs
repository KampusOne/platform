import test from "node:test";
import assert from "node:assert/strict";
import { photoCrop } from "../mobile/src/lib/photo-crop.ts";
import { normalizeMediaLinks, resolveMediaLink } from "../mobile/src/lib/media-links.ts";
import { requestPhotoEdit, finishPhotoEdit, subscribePhotoEdit, getPhotoEdit } from "../mobile/src/lib/photo-edit-session.ts";
import { requestVideoEdit, finishVideoEdit, subscribeVideoEdit, getVideoEdit } from "../mobile/src/lib/video-edit-session.ts";
import { formatVideoTime, initialVideoTrimRange, setVideoTrimEnd, setVideoTrimStart } from "../mobile/src/lib/video-trim-range.ts";
const id = "8ea652a5-7061-4b16-a0cb-609f24470de4";

test("wide photo is cropped to a square without stretching", () => {
  assert.deepEqual(photoCrop({ width: 1200, height: 800 }, 300, 1, 1, { x: 0, y: 0 }).rect, { originX: 200, originY: 0, width: 800, height: 800 });
});
test("cover uses the same wide crop on web, Android and iOS", () => {
  assert.deepEqual(photoCrop({ width: 900, height: 1200 }, 300, 3, 1, { x: 0, y: 0 }).rect, { originX: 0, originY: 450, width: 900, height: 300 });
});
test("extreme dragging and zooming never leave the image or request out-of-bounds pixels", () => {
  for (const width of [1, 123, 800, 1599]) for (const height of [1, 301, 1200]) for (const aspect of [4 / 5, 1, 16 / 9, 3]) for (const zoom of [0.25, 1, 1.4, 4, 100]) {
    for (const position of [{ x: 0, y: 0 }, { x: 1e6, y: -1e6 }, { x: -1e6, y: 1e6 }]) {
      const geometry = photoCrop({ width, height }, 311, aspect, zoom, position), r = geometry.rect;
      assert.ok(r.width >= 1 && r.height >= 1 && r.originX >= 0 && r.originY >= 0);
      assert.ok(r.originX + r.width <= width && r.originY + r.height <= height);
      assert.ok(geometry.left <= 1e-8 && geometry.top <= 1e-8);
    }
  }
});
test("invalid dimensions fail before calling a native crop operation", () => {
  for (const width of [0, -1, NaN, Infinity]) assert.throws(() => photoCrop({ width, height: 500 }, 300, 1, 1, { x: 0, y: 0 }));
});
test("saved Worker URLs use the web proxy and bypass old blocked cache entries", () => {
  assert.equal(resolveMediaLink(`https://worker.example/v1/media/${id}`, "/api"), `/api/v1/media/${id}?v=2`);
  assert.equal(resolveMediaLink(`/api/v1/media/${id}?v=1`, "/api"), `/api/v1/media/${id}?v=2`);
});
test("native URLs are absolute; private access tokens and download selection survive", () => {
  const link = resolveMediaLink(`https://old.example/v1/media/${id}?access=signed.token&download=1`, "https://api.example");
  const url = new URL(link);
  assert.equal(url.origin, "https://api.example");
  assert.equal(url.searchParams.get("access"), "signed.token");
  assert.equal(url.searchParams.get("download"), "1");
});
test("unrelated content, external images and signed tokens themselves are unchanged", () => {
  const input = { profile: { profile_image_url: `https://worker.example/v1/media/${id}` }, posts: [{ image_url: "https://images.example/photo.jpg", body: `https://worker.example/v1/media/${id}` }], accessToken: "secret-token" };
  const output = normalizeMediaLinks(input, "/api");
  assert.equal(output.profile.profile_image_url, `/api/v1/media/${id}?v=2`);
  assert.equal(output.posts[0].image_url, input.posts[0].image_url);
  assert.equal(output.posts[0].body, input.posts[0].body);
  assert.equal(output.accessToken, input.accessToken);
  assert.equal(input.profile.profile_image_url, `https://worker.example/v1/media/${id}`);
});
test("cancel returns no photo; only Save returns edited pixels, and stale sessions cannot win", async () => {
  const unsubscribe = subscribePhotoEdit(() => {});
  try {
    const image = { uri: "file:///local.jpg", width: 800, height: 800 };
    const cancelled = requestPhotoEdit("avatar", image), first = getPhotoEdit().id;
    await assert.rejects(requestPhotoEdit("cover", image), /Finish editing/);
    finishPhotoEdit(first, null);
    assert.equal(await cancelled, null);
    const saved = requestPhotoEdit("post", image), second = getPhotoEdit().id;
    finishPhotoEdit(first, image);
    assert.equal(getPhotoEdit().id, second);
    const edited = { uri: "file:///cropped.jpg", width: 750, height: 250 };
    finishPhotoEdit(second, edited);
    assert.deepEqual(await saved, edited);
    assert.equal(getPhotoEdit(), null);
  } finally { unsubscribe(); }
  await assert.rejects(requestPhotoEdit("avatar", { uri: "unused", width: 1, height: 1 }), /not ready/);
});

test("post video trim ranges enforce one-second minimum and ninety-second maximum", () => {
  assert.deepEqual(initialVideoTrimRange(180_000), { startMs: 0, endMs: 90_000 });
  const shifted = setVideoTrimEnd({ startMs: 0, endMs: 90_000 }, 150_000, 180_000);
  assert.deepEqual(shifted, { startMs: 60_000, endMs: 150_000 });
  const shortened = setVideoTrimStart(shifted, 120_000, 180_000);
  assert.deepEqual(shortened, { startMs: 120_000, endMs: 150_000 });
  assert.deepEqual(setVideoTrimEnd(shortened, 120_100, 180_000), { startMs: 120_000, endMs: 121_000 });
  assert.equal(formatVideoTime(0), "0:00");
  assert.equal(formatVideoTime(65_000), "1:05");
});

test("cancel returns no video; only Save returns the edited clip", async () => {
  const unsubscribe = subscribeVideoEdit(() => {});
  try {
    const source = { uri: "file:///source.mp4", name: "source.mp4", type: "video/mp4", durationMs: 120_000 };
    const cancelled = requestVideoEdit(source), first = getVideoEdit().id;
    await assert.rejects(requestVideoEdit(source), /Finish editing/);
    finishVideoEdit(first, null);
    assert.equal(await cancelled, null);

    const saved = requestVideoEdit(source), second = getVideoEdit().id;
    const trimmed = { ...source, uri: "file:///trimmed.mp4", durationMs: 25_000 };
    finishVideoEdit(second, trimmed);
    assert.deepEqual(await saved, trimmed);
    assert.equal(getVideoEdit(), null);
  } finally {
    unsubscribe();
  }
  await assert.rejects(
    requestVideoEdit({ uri: "unused", name: "unused.mp4", type: "video/mp4", durationMs: 1_000 }),
    /not ready/,
  );
});
