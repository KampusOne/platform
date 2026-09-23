import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PostLikeStore } from "../mobile/src/lib/post-like-store.ts";
import { waitForRequest, invalidationTargets, matchesRead } from "../mobile/src/lib/request-policy.ts";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
test("view analytics does not invalidate content, mutations stay scoped", () => {
  assert.deepEqual(invalidationTargets("/v1/student/feed/id/view"), []);
  assert.ok(invalidationTargets("/v1/student/feed/id/like").includes("/v1/student/feed"));
  assert.equal(invalidationTargets("/v1/auth/logout"), null);
  assert.equal(matchesRead("/v1/student/feed?q=test", "/v1/student/feed"), true);
  assert.equal(matchesRead("/v1/student/feedback", "/v1/student/feed"), false);
});
test("one cancelled consumer cannot cancel another reader of the same request", async () => {
  let resolve; const shared = new Promise((yes) => { resolve = yes; });
  const controller = new AbortController();
  const a = waitForRequest(shared, controller.signal), b = waitForRequest(shared);
  controller.abort(new Error("left page"));
  await assert.rejects(a, /left page/);
  resolve({ posts: [1] });
  assert.deepEqual(await b, { posts: [1] });
});
test("already aborted consumers fail, shared failures are still delivered", async () => {
  const c = new AbortController(); c.abort(new Error("stopped"));
  await assert.rejects(waitForRequest(Promise.resolve(2), c.signal), /stopped/);
  await assert.rejects(waitForRequest(Promise.reject(new Error("offline")), new AbortController().signal), /offline/);
});
test("40 feed rows have immediately usable counts without a second likes request", async () => {
  let reads = 0;
  const store = new PostLikeStore({ read: async () => { reads++; return { likes: [] }; }, write: async (id, liked) => ({ id, liked, like_count: 4 }) });
  for (let n = 0; n < 40; n++) { store.seed({ id: String(n), liked: false, like_count: 3 }); store.loadIfMissing(String(n)); }
  await store.flush();
  assert.equal(reads, 0); assert.equal(store.get("0").loading, false); assert.equal(store.get("0").count, 3);
  store.dispose();
});
test("stale feed props cannot overwrite an optimistic or confirmed local like", async () => {
  let finish; const store = new PostLikeStore({ read: async () => ({ likes: [] }), write: (id, liked) => new Promise((yes) => { finish = () => yes({ id, liked, like_count: 9 }); }) });
  const old = { id: "p", liked: false, like_count: 3 }; store.seed(old);
  const saving = store.toggle("p"); store.seed(old);
  assert.equal(store.get("p").count, 4); assert.equal(store.get("p").liked, true);
  finish(); await saving; store.seed(old); assert.equal(store.get("p").count, 9);
  store.dispose();
});
test("invalid seed counts are not silently presented as zero likes", () => {
  const store = new PostLikeStore({ read: async () => ({ likes: [] }), write: async () => { throw Error(); } });
  store.seed({ id: "p", liked: false, like_count: NaN });
  assert.equal(store.get("p").ready, false); store.dispose();
});
test("feed and comment projections include engagement state in their original reads", () => {
  const source = read("server/src/routes/feed-social.ts");
  assert.match(source, /feed_likes[\s\S]*as like_count/);
  assert.match(source, /feed_comment_likes[\s\S]*as liked/);
  assert.match(source, /as source_image_url/);
  assert.match(source, /\$\{views\} as view_count/);
  assert.match(read("server/src/routes/feed-experience.ts"), /posts\.every/);
});
test("no circular loaders remain in app routes or shared components", () => {
  for (const root of ["mobile/app", "mobile/src/components"]) {
    for (const path of readdirSync(new URL("../" + root + "/", import.meta.url), { recursive: true })) {
      if (String(path).endsWith(".tsx")) assert.doesNotMatch(read(root + "/" + path), /ActivityIndicator/, path);
    }
  }
  assert.match(read("mobile/app/(tabs)/feed.tsx"), /<FeedSkeleton/);
  assert.match(read("mobile/app/(tabs)/profile.tsx"), /<ProfileSkeleton/);
});
test("public images retain upstream caching, JSON and private images keep no-store", () => {
  const config = JSON.parse(read("mobile/vercel.json"));
  assert.equal(config.headers.some((r) => r.source === "/api/:path*"), false);
  assert.match(read("server/src/middleware/security-headers.ts"), /private, no-store/);
  assert.match(read("server/src/routes/media.ts"), /privateKinds.has\(media.kind\)[\s\S]*private, no-store/);
});
test("web builds generate an uncached revision manifest and guard against reload loops", () => {
  assert.match(read("mobile/scripts/export-web.mjs"), /EXPO_PUBLIC_BUILD_ID: version/);
  assert.match(read("mobile/scripts/export-web.mjs"), /dist\/app-version.json/);
  assert.match(read("mobile/src/lib/build-version.ts"), /sessionStorage.getItem\(key\) === version/);
  assert.match(read("mobile/src/lib/build-version.ts"), /editingPath.test/);
});
