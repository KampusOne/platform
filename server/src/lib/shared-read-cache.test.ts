import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { cachedSharedRead } from "./shared-read-cache";
import type { Bindings, Variables } from "../types";

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
function setup() {
  const stored = new Map<string, Response>();
  const writes: Promise<unknown>[] = [];
  const cache = {
    async match(key: Request) { return stored.get(key.url)?.clone(); },
    async put(key: Request, response: Response) { stored.set(key.url, response.clone()); },
  };
  const context = (origin = "https://api.test/v1/maps/campuses/test/features") =>
    ({
      req: { url: origin },
      env: { ENVIRONMENT: "staging" },
      executionCtx: { waitUntil(operation: Promise<unknown>) { writes.push(operation); } },
    }) as unknown as AppContext;
  return { cache, context, stored, async flush() { await Promise.all(writes.splice(0)); } };
}

describe("Worker shared read cache", () => {
  it("reuses only the same namespace, tenant, campus and revision", async () => {
    const test = setup();
    let hits = 0;
    const load = async () => ({ loaded: ++hits });
    expect(await cachedSharedRead(test.context(), "places", "tenant-a:campus-a:r1", 120, load, test.cache)).toEqual({ loaded: 1 });
    await test.flush();
    expect(await cachedSharedRead(test.context(), "places", "tenant-a:campus-a:r1", 120, load, test.cache)).toEqual({ loaded: 1 });
    expect(await cachedSharedRead(test.context(), "places", "tenant-b:campus-a:r1", 120, load, test.cache)).toEqual({ loaded: 2 });
    expect(await cachedSharedRead(test.context(), "places", "tenant-a:campus-a:r2", 120, load, test.cache)).toEqual({ loaded: 3 });
  });

  it("coalesces simultaneous misses and never caches failures", async () => {
    const test = setup();
    let reads = 0;
    let release!: (value: { items: number[] }) => void;
    const gate = new Promise<{ items: number[] }>((resolve) => { release = resolve; });
    const loader = () => { reads++; return gate; };
    const one = cachedSharedRead(test.context(), "features", "tenant:campus:r1", 60, loader, test.cache);
    const two = cachedSharedRead(test.context(), "features", "tenant:campus:r1", 60, loader, test.cache);
    // Both Cache.match calls must settle before the singleflight assertion.
    await Promise.resolve(); await Promise.resolve();
    expect(reads).toBe(1);
    release({ items: [1] });
    expect(await one).toEqual({ items: [1] });
    expect(await two).toEqual({ items: [1] });
    await test.flush();
    expect(test.stored.size).toBe(1);
    await expect(cachedSharedRead(test.context(), "throw", "tenant:r1", 60, async () => {
      throw new Error("offline");
    }, test.cache)).rejects.toThrow("offline");
    expect(test.stored.size).toBe(1);
  });

  it("falls back to origin when cache lookup fails", async () => {
    const test = setup();
    const failingCache = {
      async match(_request: Request): Promise<Response | undefined> { throw new Error("cache unavailable"); },
      async put(_request: Request, _response: Response) { throw new Error("cache unavailable"); },
    };
    expect(await cachedSharedRead(test.context(), "places", "tenant:campus:r1", 60, async () => ({ places: 5 }), failingCache)).toEqual({ places: 5 });
    await test.flush();
  });

  it("uses the authoritative source without caching when running locally", async () => {
    const test = setup();
    const context = test.context();
    (context.env as { ENVIRONMENT: string }).ENVIRONMENT = "local";
    let reads = 0;
    for (let i = 0; i < 2; i++) await cachedSharedRead(context, "places", "tenant:campus:r1", 60, async () => ++reads, test.cache);
    expect(reads).toBe(2);
    expect(test.stored.size).toBe(0);
  });
});
