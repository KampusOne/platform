import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { mediaRoutes } from "./media";
import { mediaAwareSecureHeaders } from "../middleware/security-headers";
import { AppError } from "../lib/errors";
import type { Bindings, Variables } from "../types";

const state = vi.hoisted(() => ({ execute: vi.fn(), get: vi.fn(), put: vi.fn(), findUser: vi.fn(), audit: vi.fn() }));
const ownerId = "00000000-0000-4000-8000-000000000001";
const mediaId = "00000000-0000-4000-8000-000000000002";
const campusId = "00000000-0000-4000-8000-000000000003";
const actor = { id: ownerId, email: "fixture@example.test", roles: ["STUDENT"], universityId: campusId, operatorRoles: [] };
vi.mock("../lib/database", () => ({ database: () => ({ execute: state.execute }), firstRow: (result: { rows: unknown[] }) => result.rows[0] }));
vi.mock("../lib/audit", () => ({ recordAudit: (...args: unknown[]) => state.audit(...args) }));
vi.mock("../services/sessions", () => ({ findUserById: (...args: unknown[]) => state.findUser(...args), toAuthenticatedUser: (user: unknown) => user }));
vi.mock("../middleware/auth", async () => {
  const { AppError } = await import("../lib/errors");
  return {
    currentUser: () => actor,
    requireAuth: async (c: { req: { header: (name: string) => string | undefined } }, next: () => Promise<void>) => {
      if (c.req.header("Authorization") !== "Bearer fixture") throw new AppError(401, "UNAUTHENTICATED", "Sign in first.");
      await next();
    },
  };
});
const env = { JWT_SECRET: "fixture-signing-key-not-a-real-secret-1234567890", MEDIA_BUCKET: { get: state.get, put: state.put }, PRIVATE_BUCKET: { get: state.get, put: state.put } } as unknown as Bindings;
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
app.use("*", mediaAwareSecureHeaders);
app.route("/v1/media", mediaRoutes);
app.get("/v1/other", (c) => c.json({ ok: true }));
app.onError((error, c) => c.json({ error: { message: error.message } }, error instanceof AppError ? error.status : 500));
const auth = { Authorization: "Bearer fixture" };
function media(kind = "avatar") {
  return { id: mediaId, owner_user_id: ownerId, institution_id: campusId, kind, object_key: `${ownerId}/${kind}/${mediaId}`, content_type: kind === "resource" ? "application/pdf" : "image/png", size_bytes: 8 };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.execute.mockReset();
  state.execute.mockResolvedValue({ rows: [media()] });
  state.get.mockImplementation(async () => ({ body: new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])).body, size: 8, httpEtag: '"fixture"' }));
  state.put.mockResolvedValue({}); state.findUser.mockResolvedValue(actor); state.audit.mockResolvedValue(undefined);
});
describe("media upload and delivery regression", () => {
  it("saves an avatar and returns a persisted media URL", async () => {
    state.execute.mockResolvedValueOnce({ rows: [{ allowed: true }] }).mockResolvedValue({ rows: [] });
    const form = new FormData();
    form.append("kind", "avatar");
    form.append("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "avatar.png", { type: "image/png" }));
    const response = await app.request("https://api.example/v1/media", { method: "POST", headers: auth, body: form }, env);
    expect(response.status).toBe(201);
    const result = await response.json() as { id: string; url: string; kind: string; private: boolean };
    expect(result.url).toBe(`https://api.example/v1/media/${result.id}`);
    expect(result.kind).toBe("avatar"); expect(result.private).toBe(false);
    expect(state.put).toHaveBeenCalledOnce(); expect(state.execute).toHaveBeenCalledTimes(3);
  });
  it("accepts an MP4 post upload without changing the media schema", async () => {
    state.execute.mockResolvedValueOnce({ rows: [{ allowed: true }] }).mockResolvedValue({ rows: [] });
    const form = new FormData();
    form.append("kind", "post");
    form.append("file", new File([
      new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]),
    ], "post.mp4", { type: "video/mp4" }));
    const response = await app.request("https://api.example/v1/media", { method: "POST", headers: auth, body: form }, env);
    expect(response.status).toBe(201);
    expect(state.put).toHaveBeenCalledOnce();
  });
  it.each(["avatar", "cover", "post", "product"])("serves %s images across app and Worker origins without disabling secure headers", async (kind) => {
    state.execute.mockResolvedValue({ rows: [media(kind)] });
    const response = await app.request(`https://api.example/v1/media/${mediaId}`, {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
  it("streams public MP4 byte ranges with browser-safe headers", async () => {
    const size = 12;
    state.execute.mockResolvedValue({ rows: [{ ...media("post"), content_type: "video/mp4", size_bytes: size }] });
    state.get.mockResolvedValue({
      body: new Response(new Uint8Array([1, 2, 3, 4])).body,
      size,
      httpEtag: '"video-fixture"',
    });
    const response = await app.request(
      `https://api.example/v1/media/${mediaId}`,
      { headers: { Range: "bytes=2-5" } },
      env,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/12");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(state.get).toHaveBeenCalledWith(
      `${ownerId}/post/${mediaId}`,
      { range: { offset: 2, length: 4 } },
    );
  });
  it("keeps private documents inaccessible without an authenticated or signed request", async () => {
    state.execute.mockResolvedValue({ rows: [media("resource")] });
    const response = await app.request(`https://api.example/v1/media/${mediaId}`, {}, env);
    expect(response.status).toBe(401);
    expect(state.get).not.toHaveBeenCalled();
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });
  it("denies another user's private document without the required role", async () => {
    state.execute.mockResolvedValueOnce({ rows: [{ ...media("kyc"), owner_user_id: "00000000-0000-4000-8000-000000000009" }] }).mockResolvedValue({ rows: [] });
    const response = await app.request(`https://api.example/v1/media/${mediaId}`, { headers: auth }, env);
    expect(response.status).toBe(403); expect(state.get).not.toHaveBeenCalled();
  });
  it("issues a scoped short-lived link, opens an authorized PDF inline, and keeps it uncacheable", async () => {
    state.execute.mockResolvedValueOnce({ rows: [media("resource")] });
    const response = await app.request(`https://api.example/v1/media/${mediaId}/access`, { method: "POST", headers: auth }, env);
    expect(response.status).toBe(200);
    const link = await response.json() as { url: string; expiresIn: number };
    expect(link.expiresIn).toBe(90);
    state.execute.mockResolvedValueOnce({ rows: [media("resource")] }).mockResolvedValueOnce({ rows: [] });
    const file = await app.request(link.url, {}, env);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("application/pdf");
    expect(file.headers.get("Content-Disposition")).toContain("inline");
    expect(file.headers.get("Cache-Control")).toBe("private, no-store");
    expect(file.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(state.audit).toHaveBeenCalledOnce();
  });
  it("retains explicit PDF downloads", async () => {
    state.execute.mockResolvedValue({ rows: [media("resource")] });
    const response = await app.request(`https://api.example/v1/media/${mediaId}?download=1`, { headers: auth }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });
  it("rejects expired signed links before reading any bucket bytes", async () => {
    state.execute.mockResolvedValue({ rows: [media("resource")] });
    const token = await new SignJWT({ viewer: ownerId }).setProtectedHeader({ alg: "HS256" }).setSubject(mediaId).setIssuer("kampusone-api").setAudience("kampusone-private-file").setExpirationTime(1).sign(new TextEncoder().encode(env.JWT_SECRET));
    const response = await app.request(`https://api.example/v1/media/${mediaId}?access=${token}`, {}, env);
    expect(response.status).toBe(401); expect(state.get).not.toHaveBeenCalled();
  });
  it("does not relax JSON or missing-file responses", async () => {
    const json = await app.request("https://api.example/v1/other", {}, env);
    expect(json.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    state.execute.mockResolvedValue({ rows: [] });
    const missing = await app.request(`https://api.example/v1/media/${mediaId}`, {}, env);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });
});
