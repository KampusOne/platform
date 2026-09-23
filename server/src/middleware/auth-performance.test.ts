import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Bindings, Variables } from "../types";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), verify: vi.fn() }));
vi.mock("../lib/database", () => ({ database: () => ({ execute: mocks.execute }), firstRow: (result: { rows: unknown[] }) => result.rows[0] }));
vi.mock("../lib/security", () => ({ verifyAccessToken: mocks.verify }));
vi.mock("../lib/config", () => ({ allowedOrigins: () => new Set(["https://app.example"]) }));
import { requireAuth, currentUser } from "./auth";
import { AppError } from "../lib/errors";
const env = { UNIFIED_SCHEMA_READY: "true" } as Bindings;
const id = "11111111-1111-4111-8111-111111111111";
function application() {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use("*", requireAuth);
  app.get("/v1/student/example", requireAuth, requireAuth, (c) => c.json({ id: currentUser(c).id }));
  app.post("/v1/student/example", requireAuth, (c) => c.json({ id: currentUser(c).id }));
  app.onError((error, c) => error instanceof AppError ? c.json({ error: error.code }, error.status) : c.json({ error: "unexpected" }, 500));
  return app;
}
beforeEach(() => {
  mocks.verify.mockReset(); mocks.execute.mockReset();
  mocks.verify.mockResolvedValue({ id, sessionFamilyId: "22222222-2222-4222-8222-222222222222" });
  mocks.execute.mockImplementation(async () => ({ rows: mocks.execute.mock.calls.length % 2 ? [{ id, email: "synthetic@example.test", roles: [], operator_roles: [], university_id: null }] : [] }));
});
describe("request-local authorization reuse", () => {
  it("does not repeat JWT, session or restriction checks at each nested route", async () => {
    const result = await application().request("/v1/student/example", { headers: { Authorization: "Bearer synthetic" } }, env);
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ id });
    expect(mocks.verify).toHaveBeenCalledTimes(1); expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it("always validates the next HTTP request instead of caching authorization globally", async () => {
    const app = application();
    for (let n = 0; n < 2; n++) expect((await app.request("/v1/student/example", { headers: { Authorization: "Bearer synthetic" } }, env)).status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledTimes(2); expect(mocks.execute).toHaveBeenCalledTimes(4);
  });
  it("restricted users cannot reach the route or be marked successfully authorized", async () => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce({ rows: [{ id, email: "synthetic@example.test", roles: [], operator_roles: [], university_id: null }] }).mockResolvedValueOnce({ rows: [{ kind: "SUSPENDED", reason: "test", ends_at: null }] });
    const result = await application().request("/v1/student/example", { headers: { Authorization: "Bearer synthetic" } }, env);
    expect(result.status).toBe(403); expect(await result.json()).toEqual({ error: "ACCOUNT_RESTRICTED" });
  });
  it("cookie-authenticated writes still enforce their origin before any reuse", async () => {
    const result = await application().request("/v1/student/example", { method: "POST", headers: { Cookie: "k1_access=synthetic", Origin: "https://not-allowed.example" } }, env);
    expect(result.status).toBe(403); expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
});
