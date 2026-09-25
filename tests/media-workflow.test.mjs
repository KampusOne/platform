import test from "node:test";
import assert from "node:assert/strict";
import { photoCrop } from "../mobile/src/lib/photo-crop.ts";
import { normalizeMediaLinks, resolveMediaLink } from "../mobile/src/lib/media-links.ts";
import { requestPhotoEdit, finishPhotoEdit, subscribePhotoEdit, getPhotoEdit } from "../mobile/src/lib/photo-edit-session.ts";
const id = "8ea652a5-7061-4b16-a0cb-609f24470de4";

test("wide photo is cropped to a square without stretching", () => {
  assert.deepEqual(photoCrop({ width: 1200, height: 800 }, 300, 1, 1, { x: 0, y: 0 }).rect, { originX: 200, originY: 0, width: 800, height: 800 });
});
test("cover uses the same wide crop on web, Android and iOS", () => {
  assert.deepEqual(photoCrop({ width: 900, height: 1200 }, 300, 3, 1, { x: 0, y: 0 }).rect, { originX: 0, originY: 450, width: 900, height: 300 });
});
test("extreme dragging and zooming never leave the image or request out-of-bounds pixels", () => {
  for (const width of [1, 123, 800, 1599]) for (const height of [1, 301, 1200]) for (const aspect of [1, 3]) for (const zoom of [0.25, 1, 1.4, 4, 100]) {
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
test("public absolute Worker media streams direct on web while relative media keeps the proxy", () => {
  assert.equal(resolveMediaLink(`https://worker.example/v1/media/${id}`, "/api"), `https://worker.example/v1/media/${id}?v=3`);
  assert.equal(resolveMediaLink(`/api/v1/media/${id}?v=1`, "/api"), `/api/v1/media/${id}?v=3`);
});
test("signed private media stays same-origin on web", () => {
  const link = resolveMediaLink(`https://worker.example/v1/media/${id}?access=signed.token`, "/api");
  assert.equal(link, `/api/v1/media/${id}?access=signed.token&v=3`);
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
  assert.equal(output.profile.profile_image_url, `https://worker.example/v1/media/${id}?v=3`);
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
    const saved = requestPhotoEdit("cover", image), second = getPhotoEdit().id;
    finishPhotoEdit(first, image);
    assert.equal(getPhotoEdit().id, second);
    const edited = { uri: "file:///cropped.jpg", width: 750, height: 250 };
    finishPhotoEdit(second, edited);
    assert.deepEqual(await saved, edited);
    assert.equal(getPhotoEdit(), null);
  } finally { unsubscribe(); }
  await assert.rejects(requestPhotoEdit("avatar", { uri: "unused", width: 1, height: 1 }), /not ready/);
});
