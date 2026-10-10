import { describe, expect, it, vi } from "vitest";
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
      env: { ENVIRONMENT: "staging", SHARED_READ_CACHE_ENABLED: "true" },
      executionCtx: { waitUntil(operation: Promise<unknown>) { writes.push(operation); } },
    }) as unknown as AppContext;
  return { cache, context, stored, async flush() { await Promise.all(writes.splice(0)); } };
}

describe("Worker shared read cache", () => {
  it("requires an explicit enable flag and honors force-fresh requests", async () => {
    const test=setup(), context=test.context(); let reads=0;
    context.env.SHARED_READ_CACHE_ENABLED="false";
    for(let n=0;n<2;n++) await cachedSharedRead(context,"campus-places","kill-switch",60,async()=>++reads,test.cache);
    context.env.SHARED_READ_CACHE_ENABLED="true";
    context.req.header=(()=>"no-cache") as unknown as typeof context.req.header;
    for(let n=0;n<2;n++) await cachedSharedRead(context,"campus-places","kill-switch",60,async()=>++reads,test.cache);
    expect(reads).toBe(4);expect(test.stored.size).toBe(0);
  });
  it("refetches corrupt or expired entries and bounds stored TTL and size",async()=>{
    const test=setup();let loads=0;
    const load=async()=>({count:++loads});
    await cachedSharedRead(test.context(),"campus-places","corruption",60,load,test.cache);await test.flush();
    const key=[...test.stored.keys()][0]!;
    test.stored.set(key,new Response("broken JSON"));
    expect(await cachedSharedRead(test.context(),"campus-places","corruption",60,load,test.cache)).toEqual({count:2});await test.flush();
    test.stored.set(key,Response.json({version:2,createdAt:Date.now()-2000,expiresAt:Date.now()-1000,value:{count:2}}));
    expect(await cachedSharedRead(test.context(),"campus-places","corruption",60,load,test.cache)).toEqual({count:3});await test.flush();
    const saved=await test.stored.get(key)!.clone().json() as {expiresAt:number;createdAt:number};
    expect(saved.expiresAt-saved.createdAt).toBeLessThanOrEqual(60_000);
    await cachedSharedRead(test.context(),"campus-features","too-large",600,async()=>"x".repeat(8*1024*1024),test.cache);await test.flush();
    expect(test.stored.size).toBe(1);
    expect(key).not.toContain("corruption");
    expect(test.stored.get(key)!.headers.has("Set-Cookie")).toBe(false);
  });
  it("keeps a completed load coalesced until a slow cache write settles",async()=>{
    const test=setup();let finish!:()=>void,loads=0;
    const delayed={match:test.cache.match,put:async(key:Request,value:Response)=>{await new Promise<void>(resolve=>{finish=resolve;});await test.cache.put(key,value);}};
    const load=async()=>++loads;
    expect(await cachedSharedRead(test.context(),"campus-places","slow-write",60,load,delayed)).toBe(1);
    expect(await cachedSharedRead(test.context(),"campus-places","slow-write",60,load,delayed)).toBe(1);
    expect(loads).toBe(1);finish();await test.flush();
  });
  it("reuses only the same namespace, tenant, campus and revision", async () => {
    const test = setup();
    let hits = 0;
    const load = async () => ({ loaded: ++hits });
    expect(await cachedSharedRead(test.context(), "campus-places", "tenant-a:campus-a:r1", 120, load, test.cache)).toEqual({ loaded: 1 });
    await test.flush();
    expect(await cachedSharedRead(test.context(), "campus-places", "tenant-a:campus-a:r1", 120, load, test.cache)).toEqual({ loaded: 1 });
    expect(await cachedSharedRead(test.context(), "campus-places", "tenant-b:campus-a:r1", 120, load, test.cache)).toEqual({ loaded: 2 });
    expect(await cachedSharedRead(test.context(), "campus-places", "tenant-a:campus-a:r2", 120, load, test.cache)).toEqual({ loaded: 3 });
  });

  it("coalesces simultaneous misses and never caches failures", async () => {
    const test = setup();
    let reads = 0;
    let release!: (value: { items: number[] }) => void;
    const gate = new Promise<{ items: number[] }>((resolve) => { release = resolve; });
    const loader = () => { reads++; return gate; };
    const one = cachedSharedRead(test.context(), "campus-features", "tenant:campus:r1", 60, loader, test.cache);
    const two = cachedSharedRead(test.context(), "campus-features", "tenant:campus:r1", 60, loader, test.cache);
    // Both Cache.match calls must settle before the singleflight assertion.
    await vi.waitFor(() => expect(reads).toBe(1));
    release({ items: [1] });
    expect(await one).toEqual({ items: [1] });
    expect(await two).toEqual({ items: [1] });
    await test.flush();
    expect(test.stored.size).toBe(1);
    await expect(cachedSharedRead(test.context(), "campus-places", "tenant:r1", 60, async () => {
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
    expect(await cachedSharedRead(test.context(), "campus-places", "tenant:campus:r1", 60, async () => ({ places: 5 }), failingCache)).toEqual({ places: 5 });
    await test.flush();
  });

  it("uses the authoritative source without caching when running locally", async () => {
    const test = setup();
    const context = test.context();
    (context.env as { ENVIRONMENT: string }).ENVIRONMENT = "local";
    let reads = 0;
    for (let i = 0; i < 2; i++) await cachedSharedRead(context, "campus-places", "tenant:campus:r1", 60, async () => ++reads, test.cache);
    expect(reads).toBe(2);
    expect(test.stored.size).toBe(0);
  });
});
