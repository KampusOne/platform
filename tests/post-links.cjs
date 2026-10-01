const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require(require.resolve("typescript", { paths: [path.join(__dirname, "../mobile"), path.join(__dirname, "../server")] }));
const source = fs.readFileSync(path.join(__dirname, "../mobile/src/lib/feed-posts.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const id = "33333333-3333-4333-8333-333333333333";
const url = `https://links.kampusone.app/s/post/${id}`;
const post = { id, title: "Campus update", body: "Do not share this body as text" };
function load(os, options = {}) {
  const calls = { shares: [], copies: [], invalidations: 0, removals: 0 };
  const exported = {};
  const storage = options.storage || new Map();
  const context = {
    Error, URL, process: { env: {} }, module: { exports: exported }, exports: exported,
    require(name) {
      if (name === "react-native") return { Platform: { OS: os }, Share: {
        dismissedAction: "dismissed", share: async (payload) => { calls.shares.push(payload); return { action: "shared" }; },
      } };
      if (name === "@/src/lib/api") return { clearApiCache: () => { calls.invalidations++; } };
      if (name === "expo-clipboard") return { setStringAsync: async (value) => {
        if (options.navigator?.clipboard?.writeText) { await options.navigator.clipboard.writeText(value); return true; }
        return false;
      } };
      if (["./app-links", "./shared-links", "./share-content"].includes(name)) {
        const nested = {};
        const file = name === "./app-links" ? "app-links.ts" : name === "./shared-links" ? "shared-links.ts" : "share-content.ts";
        const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../mobile/src/lib", file), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
        vm.runInNewContext(code, { ...context, module: { exports: nested }, exports: nested });
        return nested;
      }
      throw new Error(`Unexpected import ${name}`);
    },
    navigator: options.navigator,
    document: options.document,
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
  };
  vm.runInNewContext(compiled, context);
  return { api: exported, calls, storage };
}
test("a post URL targets the real app route and rejects invalid IDs", () => {
  const { api } = load("android");
  assert.equal(api.postUrl(id), url);
  assert.throws(() => api.postUrl("not-a-post"));
});
test("Android shares the URL in message, never the post body", async () => {
  const { api, calls } = load("android");
  assert.equal(await api.sharePostLink(post), "shared");
  assert.equal(calls.shares[0].message.includes(url), true);
  assert.equal(calls.shares[0].message.includes(post.body), false);
});
test("iOS shares one URL without duplicating it as text", async () => {
  const { api, calls } = load("ios");
  await api.sharePostLink(post);
  assert.equal(calls.shares[0].url, url);
  assert.equal(calls.shares[0].message.includes(url), false);
  assert.equal(calls.shares[0].message.includes(post.body), false);
});
test("web native sharing uses a URL, not a text summary", async () => {
  let payload;
  const { api } = load("web", { navigator: { share: async (value) => { payload = value; } } });
  assert.equal(await api.sharePostLink(post), "shared");
  assert.equal(payload.url, url);
  assert.equal(payload.text.includes(post.body), false);
});
test("cancelling web sharing is not treated as a failure or copied silently", async () => {
  let copied = false;
  const error = Object.assign(new Error("cancelled"), { name: "AbortError" });
  const { api } = load("web", { navigator: { share: async () => { throw error; }, clipboard: { writeText: async () => { copied = true; } } } });
  assert.equal(await api.sharePostLink(post), "cancelled");
  assert.equal(copied, false);
});
test("a browser without sharing copies the URL", async () => {
  let copied;
  const { api } = load("web", { document: {}, navigator: { clipboard: { writeText: async (value) => { copied = value; } } } });
  assert.equal(await api.sharePostLink(post), "copied");
  assert.equal(copied, url);
});
test("blocked clipboard offers manual copy, not false success", async () => {
  let removed = false;
  const { api } = load("web", {
    navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
    document: { activeElement: null, body: { appendChild() {} }, createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() { removed = true; } }), execCommand: () => false },
  });
  assert.equal(await api.sharePostLink(post), "manual");
  assert.equal(removed, false);
});
test("native copy without a clipboard dependency requests a selectable-link fallback", async () => {
  assert.equal(await load("android").api.copyPostLink(id), false);
});
test("a valid pending link survives web login navigation and can be cleared", () => {
  const first = load("web");
  first.api.rememberPostLink(id);
  const next = load("web", { storage: first.storage });
  assert.equal(next.api.pendingPostLink(), id);
  next.api.clearPendingPostLink();
  assert.equal(next.api.pendingPostLink(), null);
});
test("pending links cannot become arbitrary redirects", () => {
  const { api } = load("web");
  api.rememberPostLink("https://untrusted.example");
  assert.equal(api.pendingPostLink(), null);
});
test("successful deletion invalidates cached feeds and prevents stale loads restoring the post", () => {
  const { api, calls } = load("web");
  assert.equal(api.wasPostDeleted(id), false);
  api.markPostDeleted(id);
  assert.equal(api.wasPostDeleted(id), true);
  assert.equal(calls.invalidations, 1);
});
