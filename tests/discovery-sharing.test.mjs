import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const require = createRequire(
  new URL("../server/package.json", import.meta.url),
);
const ts = require("typescript"),
  uuid = "33333333-3333-4333-8333-333333333333";
function load(file, mocks = {}) {
  const exports = {};
  const compiled = ts.transpileModule(
    readFileSync(new URL("../" + file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  runInNewContext(compiled, {
    exports,
    module: { exports },
    require: (key) => {
      if (key in mocks) return mocks[key];
      throw new Error("Missing mock: " + key);
    },
    process: { env: {} },
    URL,
    URLSearchParams,
    Date,
    Number,
    Set,
    Map,
    Promise,
    JSON,
    Error,
  });
  return exports;
}
const links = () =>
  load("mobile/src/lib/shared-links.ts", {
    "./app-links": { APP_ORIGIN: "https://kampusone.app" },
  });
test("shared destinations only accept known content kinds and UUIDs", () => {
  const l = links();
  for (const kind of [
    "post",
    "profile",
    "business",
    "product",
    "tutorial",
    "material",
  ]) {
    assert.ok(l.sharedDestination(kind, uuid));
    assert.ok(l.approvedSharedUrl(l.sharedLink(kind, uuid)));
  }
  for (const value of [
    "https://evil.invalid",
    "../admin",
    "33333333-3333-4333-8333-333333333333/../admin",
  ])
    assert.equal(l.sharedDestination("profile", value), null);
  assert.equal(l.sharedDestination("admin", uuid), null);
  for (const value of [
    "http://links.kampusone.app/s/post/" + uuid,
    "https://links.kampusone.app.evil.invalid/s/post/" + uuid,
    "https://user:pass@links.kampusone.app/s/post/" + uuid,
    "https://links.kampusone.app/s/post/" +
      uuid +
      "?redirect=https://evil.invalid",
    "https://links.kampusone.app/admin",
  ])
    assert.equal(l.approvedSharedUrl(value), false);
});
test("search validates real dates and separates username searches from post filters", () => {
  const d = load("mobile/src/lib/discovery.ts"),
    base = { ...d.emptySearchFilters };
  assert.ok(d.searchFilterError({ ...base, since: "2026-02-30" }));
  assert.ok(
    d.searchFilterError({ ...base, since: "2026-10-02", until: "2026-10-01" }),
  );
  assert.ok(d.searchFilterError({ ...base, from: "@bad name" }));
  assert.equal(
    d.searchFilterError({
      ...base,
      since: "2026-10-01",
      until: "2026-10-01",
      from: "@ade",
    }),
    "",
  );
  const post = new URL(
    "https://example.invalid" +
      d.discoveryPath(" rice ", "LATEST", {
        ...base,
        from: "@ade",
        activity: "LIKED",
        excludeReplies: true,
      }),
  );
  assert.equal(post.searchParams.get("q"), "rice");
  assert.equal(post.searchParams.get("from"), "@ade");
  assert.equal(post.searchParams.get("activity"), "LIKED");
  assert.equal(post.searchParams.get("excludeReplies"), "true");
  const people = new URL(
    "https://example.invalid" +
      d.discoveryPath("@ade", "TOP", { ...base, activity: "LIKED" }),
  );
  assert.equal(people.searchParams.get("tab"), "PEOPLE");
  assert.equal(people.searchParams.has("activity"), false);
  assert.equal(
    d.mergeSearchResults(
      [{ kind: "POST", id: uuid }],
      [
        { kind: "POST", id: uuid },
        { kind: "REPLY", id: uuid },
      ],
    ).length,
    2,
  );
});
function entry(storage) {
  return load("mobile/src/lib/entry-preferences.ts", {
    react: { useSyncExternalStore: (_, snapshot) => snapshot() },
    "@react-native-async-storage/async-storage": {
      __esModule: true,
      default: {
        getItem: async (k) => storage.get(k) ?? null,
        setItem: async (k, v) => {
          storage.set(k, v);
        },
        removeItem: async (k) => {
          storage.delete(k);
        },
        getAllKeys: async () => [...storage.keys()],
      },
    },
    "./shared-links": links(),
  });
}
test("first-install completion and a whitelisted share target survive a fresh app process", async () => {
  const storage = new Map(),
    first = entry(storage);
  await first.initializeEntryPreferences();
  assert.equal(first.useFirstInstallIntro(), "new");
  await first.finishFirstInstallIntro();
  await first.rememberSharedTarget("business", uuid);
  const restarted = entry(storage);
  await restarted.initializeEntryPreferences();
  assert.equal(restarted.useFirstInstallIntro(), "done");
  assert.equal(
    restarted.pendingSharedDestination().pathname,
    "/student-service",
  );
  assert.equal(restarted.pendingSharedDestination().params.id, uuid);
  restarted.clearPendingSharedTarget();
  assert.equal(restarted.pendingSharedDestination(), null);
  await new Promise((r) => setTimeout(r, 0));
  const another = entry(storage);
  await another.initializeEntryPreferences();
  assert.equal(another.pendingSharedDestination(), null);
  assert.equal(another.useFirstInstallIntro(), "done");
});
test("existing profiles skip the intro and expired or malicious stored links are ignored", async () => {
  for (const target of [
    { kind: "admin", id: uuid, expires: Date.now() + 10000 },
    {
      kind: "profile",
      id: "https://evil.invalid",
      expires: Date.now() + 10000,
    },
    { kind: "post", id: uuid, expires: Date.now() - 1000 },
  ]) {
    const e = entry(
      new Map([
        ["k1.cache.v2.profile." + uuid, "{}"],
        ["k1.pending-share.v1", JSON.stringify(target)],
      ]),
    );
    await e.initializeEntryPreferences();
    assert.equal(e.useFirstInstallIntro(), "done");
    assert.equal(e.pendingSharedDestination(), null);
  }
});
test("web associations require actual release signing identifiers", () => {
  const a = load("portal/lib/app-link-association.ts");
  assert.equal(a.androidAssociation(""), null);
  assert.equal(a.androidAssociation("debug-placeholder"), null);
  assert.equal(a.androidAssociation("AB:CD"), null);
  const fingerprint = Array(32).fill("AB").join(":");
  assert.equal(
    a.androidAssociation(fingerprint)[0].target.sha256_cert_fingerprints[0],
    fingerprint,
  );
  assert.equal(a.appleAssociation(""), null);
  assert.equal(a.appleAssociation("INVALID"), null);
  assert.equal(
    a.appleAssociation("A1B2C3D4E5").applinks.details[0].appIDs[0],
    "A1B2C3D4E5.app.kampusone.mobile",
  );
  assert.equal(a.androidDownloadUrl("https://evil.invalid/app.apk"), null);
  assert.equal(
    a.androidDownloadUrl("https://kampusone.app/app.apk"),
    "https://kampusone.app/app.apk",
  );
});

test('all shared feature links are branded and resolve to a safe app screen',()=>{
 const l=links(),a=load('portal/lib/app-link-association.ts');
 for(const kind of ['community','study-group','class-community','message']){
  const url=l.sharedLink(kind,uuid);assert.ok(url.startsWith('https://links.kampusone.app/s/'));assert.ok(l.approvedSharedUrl(url));assert.ok(a.validSharedPath(kind,uuid));
 }
 for(const [kind,id] of [['ai','kira'],['streak','today'],['exam-period','2026-10-26_2026-11-20']]){
  assert.ok(l.approvedSharedUrl(l.sharedLink(kind,id)));assert.ok(a.validSharedPath(kind,id));
 }
 for(const id of ['2026-02-30_2026-03-02','2026-11-20_2026-10-26','2026-10-26_2028-10-26','2026-10-26_2026-11-20_evil']){
  assert.equal(l.sharedDestination('exam-period',id),null);assert.equal(a.validSharedPath('exam-period',id),false);
 }
 const countdown=load('mobile/src/lib/exam-period.ts');
 assert.deepEqual({...countdown.countdownParts(Date.parse('2026-10-26T00:00:00+01:00'),Date.parse('2026-10-24T22:58:58Z'))},{days:1,hours:0,minutes:1,seconds:2});
 assert.equal(countdown.examPeriodStart({startsOn:'2026-10-26'}),Date.parse('2026-10-25T23:00:00Z'));
});
