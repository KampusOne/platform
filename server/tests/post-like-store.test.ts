import { test } from "vitest";
import assert from "node:assert/strict";
import { PostLikeStore } from "../../mobile/src/lib/post-like-store";

const row = (id: string, liked = false, like_count = 0) => ({ id, liked, like_count });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("batches and deduplicates visible post reads", async () => {
  const calls: string[][] = [];
  const store = new PostLikeStore({ read: async (ids) => { calls.push(ids); return { likes: ids.map((id) => row(id)) }; }, write: async (id, liked) => row(id, liked, 1) });
  store.load("a"); store.load("b"); store.load("a");
  await store.flush();
  assert.deepEqual(calls, [["a", "b"]]);
  assert.equal(store.get("a").ready, true);
  assert.equal(store.get("a"), store.get("a"));
  store.dispose();
});

test("splits batches at the API's 50-post limit", async () => {
  const sizes: number[] = [];
  const store = new PostLikeStore({ read: async (ids) => { sizes.push(ids.length); return { likes: ids.map((id) => row(id)) }; }, write: async (id, liked) => row(id, liked) });
  for (let i = 0; i < 51; i++) store.load(String(i));
  await store.flush();
  assert.deepEqual(sizes, [50, 1]);
  store.dispose();
});

test("updates optimistically, prevents double taps, then uses the server count", async () => {
  const pending = deferred<ReturnType<typeof row>>();
  const writes: boolean[] = [];
  const store = new PostLikeStore({ read: async () => ({ likes: [row("a", false, 3)] }), write: async (_id, liked) => { writes.push(liked); return pending.promise; } });
  store.load("a"); await store.flush();
  const first = store.toggle("a");
  assert.equal(store.get("a").liked, true);
  assert.equal(store.get("a").count, 4);
  assert.equal(store.get("a").pending, true);
  await store.toggle("a");
  assert.deepEqual(writes, [true]);
  pending.resolve(row("a", true, 5)); await first;
  assert.equal(store.get("a").count, 5);
  assert.equal(store.get("a").pending, false);
  store.dispose();
});

test("unlikes without letting the count go below zero", async () => {
  const writes: boolean[] = [];
  const store = new PostLikeStore({ read: async () => ({ likes: [row("a", true, 1)] }), write: async (id, liked) => { writes.push(liked); return row(id, liked, 0); } });
  store.load("a"); await store.flush(); await store.toggle("a");
  assert.deepEqual(writes, [false]);
  assert.equal(store.get("a").liked, false);
  assert.equal(store.get("a").count, 0);
  store.dispose();
});

test("rolls back a failed write and retries the same desired state", async () => {
  const writes: boolean[] = [];
  const store = new PostLikeStore({ read: async () => ({ likes: [row("a", false, 2)] }), write: async (id, liked) => { writes.push(liked); if (writes.length === 1) throw new Error("offline"); return row(id, liked, 3); } });
  store.load("a"); await store.flush();
  await assert.rejects(store.toggle("a"), /could not be saved/);
  assert.equal(store.get("a").liked, false);
  assert.equal(store.get("a").count, 2);
  assert.equal(store.get("a").pending, false);
  await store.toggle("a");
  assert.deepEqual(writes, [true, true]);
  assert.equal(store.get("a").count, 3);
  store.dispose();
});

test("does not let a stale refresh undo a successful like", async () => {
  const pending = deferred<{ likes: ReturnType<typeof row>[] }>();
  let reads = 0;
  const store = new PostLikeStore({ read: async () => ++reads === 1 ? { likes: [row("a")] } : pending.promise, write: async (id, liked) => row(id, liked, 1) });
  store.load("a"); await store.flush();
  store.load("a"); const stale = store.flush();
  await store.toggle("a");
  pending.resolve({ likes: [row("a")] }); await stale;
  assert.equal(store.get("a").liked, true);
  assert.equal(store.get("a").count, 1);
  store.dispose();
});

test("unavailable reads expose retry instead of pretending zero likes loaded", async () => {
  let writes = 0;
  const store = new PostLikeStore({ read: async () => { throw new Error("offline"); }, write: async (id, liked) => { writes++; return row(id, liked, 1); } });
  store.load("a"); await store.flush(); await store.toggle("a");
  assert.equal(store.get("a").ready, false);
  assert.equal(store.get("a").loading, false);
  assert.match(store.get("a").error, /retry/);
  assert.equal(writes, 0);
  store.dispose();
});

test("rejects an invalid negative count", async () => {
  const store = new PostLikeStore({ read: async () => ({ likes: [row("a", false, -1)] }), write: async (id, liked) => row(id, liked) });
  store.load("a"); await store.flush();
  assert.equal(store.get("a").ready, false);
  assert.equal(store.get("a").count, 0);
  store.dispose();
});

test("updates every mounted copy of a post", async () => {
  const values: number[][] = [[], []];
  const store = new PostLikeStore({ read: async () => ({ likes: [row("a")] }), write: async (id, liked) => row(id, liked, 1) });
  const unsubscribe = values.map((seen) => store.subscribe("a", () => seen.push(store.get("a").count)));
  store.load("a"); await store.flush(); await store.toggle("a");
  assert.deepEqual(values[0], values[1]);
  assert.equal(values[0]!.at(-1), 1);
  unsubscribe.forEach((stop) => stop()); store.dispose();
});

test("disposed account stores ignore late results and cannot write", async () => {
  const pending = deferred<{ likes: ReturnType<typeof row>[] }>();
  let writes = 0;
  const store = new PostLikeStore({ read: async () => pending.promise, write: async (id, liked) => { writes++; return row(id, liked); } });
  store.load("a"); const read = store.flush(); store.dispose();
  pending.resolve({ likes: [row("a", true, 10)] }); await read; await store.toggle("a");
  assert.equal(store.get("a").ready, false);
  assert.equal(writes, 0);
});
