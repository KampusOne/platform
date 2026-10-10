import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { app } from "../src/app";
import { issueAccessToken } from "../src/lib/security";
import { cacheOutcome, beginReadMetrics } from "../src/lib/read-cache-metrics";
import type { Bindings } from "../src/types";

const fixture = vi.hoisted(() => ({
  user: "96000000-0000-4000-8000-000000000001",
  institution: "96000000-0000-4000-8000-000000000002",
  campus: "96000000-0000-4000-8000-000000000003",
  currentInstitution: "", active: true, restricted: false,
  revision: "1", label: "Original", payloadReads: 0,
}));
vi.mock("../src/lib/database", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { measureDatabase } = await import("../src/lib/read-cache-metrics");
  const dialect = new PgDialect();
  return {
    firstRow: (result: { rows: unknown[] }) => result.rows[0],
    database: (env: Bindings) => ({ execute: (statement: SQL) => measureDatabase(env, 1, async () => {
      const query = dialect.sqlToQuery(statement);
      if (query.sql.includes("from public.users users")) return { rows: fixture.active ? [{
        id: fixture.user, email: "private@example.invalid", roles: ["STUDENT"],
        university_id: fixture.currentInstitution, operator_roles: [],
        restriction: fixture.restricted ? { kind: "SUSPENDED", reason: "synthetic", ends_at: null } : null,
      }] : [] };
      if (query.sql.includes("from app_private.cache_resource_revisions"))
        return { rows: [{ revision: fixture.revision }] };
      if (query.sql.includes("from public.campus_map_features")) {
        fixture.payloadReads++;
        return { rows: [{ id: "feature", kind: "BUILDING", tags: { name: fixture.label }, geometry: { type: "Point", coordinates: [5, 6] } }] };
      }
      if (query.sql.includes("from public.institution_campuses")) return { rows:
        query.params[0] === fixture.campus && query.params[2] === fixture.institution ? [{
          id: fixture.campus, institution_id: fixture.institution, status: "PUBLISHED",
          longitude: "5", latitude: "6", map_revision: 1,
        }] : [] };
      throw new Error("Unexpected synthetic query");
    }) }),
  };
});

const env = {
  ENVIRONMENT: "staging", UNIFIED_SCHEMA_READY: "true",
  ALLOWED_ORIGINS: "https://app.example.invalid",
  SHARED_READ_CACHE_ENABLED: "true", VERSIONED_READ_CACHE_ENABLED: "true",
  READ_CACHE_METRICS_ENABLED: "true", JWT_SECRET: "synthetic-test-signing-key-with-32-characters",
} as Bindings;
let token: string;
let logs: string[];
let matches: number;
const url = () => `https://cache-auth.test/v1/maps/campuses/${fixture.campus}/features`;
const request = (headers: Record<string, string> = {}, bindings = env) =>
  app.request(url(), { headers: { Authorization: "Bearer " + token, ...headers } }, bindings);

beforeEach(async () => {
  Object.assign(fixture, { currentInstitution: fixture.institution, active: true, restricted: false, revision: "1", label: "Original", payloadReads: 0 });
  logs = []; matches = 0;
  vi.spyOn(console, "log").mockImplementation((value) => logs.push(String(value)));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const store = new Map<string, Response>();
  vi.stubGlobal("caches", { default: {
    match: async (key: Request) => { matches++; return store.get(key.url)?.clone(); },
    put: async (key: Request, value: Response) => { store.set(key.url, value.clone()); },
  } });
  token = await issueAccessToken(env, {
    id: fixture.user, email: "private@example.invalid", roles: ["STUDENT"],
    universityId: fixture.institution, operatorRoles: [],
    sessionFamilyId: "96000000-0000-4000-8000-000000000004",
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("authorized shared cache boundaries", () => {
  it("saves the geometry query while still checking auth, tenant and revision on every hit", async () => {
    const cold = await request(); expect(cold.status).toBe(200);
    expect(cold.headers.get("Cache-Control")).toBe("private, no-store");
    await cold.json();
    const warm = await request(); expect(warm.status).toBe(200); await warm.json();
    expect(fixture.payloadReads).toBe(1);
    const metrics = logs.map(value => JSON.parse(value)).filter(value => value.event === "read.performance");
    expect(metrics.map(value => value.dbQueries)).toEqual([4, 3]);
    expect(metrics.map(value => value.authQueries)).toEqual([1, 1]);
    expect(metrics[0].cache.miss).toBe(1); expect(metrics[1].cache.hit).toBe(1);
    expect(metrics[1].route).toBe("/v1/maps/campuses/:id/features");
    expect(logs.join()).not.toContain(fixture.campus);
    expect(logs.join()).not.toContain(fixture.user);
    expect(logs.join()).not.toContain(token);
    expect(logs.join()).not.toContain("private@example.invalid");
  });

  it("rejects revoked, restricted and cross-institution requests even with a warm object", async () => {
    await (await request()).json(); const warmMatches = matches;
    fixture.active = false; expect((await request()).status).toBe(401);
    fixture.active = true; fixture.restricted = true; expect((await request()).status).toBe(403);
    fixture.restricted = false; fixture.currentInstitution = "96000000-0000-4000-8000-000000000005";
    expect((await request()).status).toBe(404);
    expect(matches).toBe(warmMatches); expect(fixture.payloadReads).toBe(1);
  });

  it("reads a new revision immediately and both refresh and kill switch bypass warm objects", async () => {
    await (await request()).json();
    fixture.revision = "2"; fixture.label = "Edited";
    const edited = await (await request()).json() as { features: Array<{ properties: { name: string } }> };
    expect(edited.features[0]?.properties.name).toBe("Edited");
    fixture.label = "Refresh";
    await (await request({ "Cache-Control": "no-cache" })).json();
    await (await request({}, { ...env, SHARED_READ_CACHE_ENABLED: "false" })).json();
    expect(fixture.payloadReads).toBe(4);
  });

  it("reports cache write failures that finish after the response without scope or payload", () => {
    const metrics = beginReadMetrics(env);
    metrics.completed = { requestId: "synthetic-request", method: "GET", route: "/v1/maps/campuses/:id/features", status: 200 };
    cacheOutcome(env, "store_failed");
    expect(JSON.parse(logs.at(-1)!)).toEqual({ event: "read.cache.background", ...metrics.completed, outcome: "store_failed" });
  });
});
