import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { byteRange } from "../lib/http-range";
import { currentUser, requireAuth } from "../middleware/auth";
import { id } from "../lib/input";
import { adminAccess, resolveAdminScope } from "../lib/admin-access";
import { recordAudit } from "../lib/audit";
import type { Bindings, Variables } from "../types";
import { SignJWT, jwtVerify } from "jose";
import { findUserById, toAuthenticatedUser } from "../services/sessions";
import type { AuthenticatedUser } from "../types";
type Media = {
  id: string;
  owner_user_id: string;
  institution_id: string | null;
  kind: string;
  object_key: string;
  content_type: string;
};
function mediaKey(env: Bindings) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32)
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Secure file access is unavailable.",
    );
  return new TextEncoder().encode(env.JWT_SECRET);
}
async function canRead(env: Bindings, user: AuthenticatedUser, media: Media) {
  if (user.id === media.owner_user_id) return;
  const permission=media.kind==='kyc'?'agents.verify':media.kind==='support'?'support.view':'content.view';
  const access=await adminAccess(env,user);
  if(access.permissions.includes(permission)){
    try {
      const scope=await resolveAdminScope(env,user,media.institution_id??undefined,permission);
      if(scope===null||scope===media.institution_id)return;
    } catch(error) {if(!(error instanceof AppError)||error.status!==403)throw error;}
  }
  if (media.kind === "resource" && user.universityId === media.institution_id) {
    const resource = firstRow(
      await database(env).execute(
        sql`select r.id from public.tutorial_resources r where r.media_object_id=${media.id}::uuid and r.university_id=${user.universityId}::uuid and r.deleted_at is null and r.status='PUBLISHED' and (r.access_model='FREE' or(r.access_model='BOOKING_INCLUDED' and r.listing_id is not null and exists(select 1 from public.tutorial_bookings b where b.listing_id=r.listing_id and b.student_user_id=${user.id}::uuid and b.status in ('CONFIRMED','COMPLETED')))) limit 1`,
      ),
    );
    if (resource) return;
  }
  throw new AppError(403, "FORBIDDEN", "You do not have access to this file.");
}
export const mediaRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
const privateKinds = new Set(["kyc", "support", "resource"]);
export function detectedMime(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return "image/png";
  const head = new TextDecoder().decode(bytes.slice(0, 16));
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP")
    return "image/webp";
  if (head.startsWith("RIFF") && head.slice(8,12) === "WAVE") return "audio/wav";
  if (head.startsWith("ID3") || (bytes[0] === 0xff && ((bytes[1]??0) & 0xe0) === 0xe0)) return "audio/mpeg";
  if (head.startsWith("%PDF-")) return "application/pdf";
  // ISO Base Media container: accept MP4 brands, not arbitrary ftyp/HEIC files.
  if (head.slice(4, 8) === "ftyp" && ["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(head.slice(8, 12))) return "video/mp4";
  return null;
}
mediaRoutes.post("/", requireAuth, async (c) => {
  const user = currentUser(c);
  if (Number(c.req.header("Content-Length") ?? 0) > 10 * 1024 * 1024 + 4096)
    throw new AppError(413, "BAD_REQUEST", "Choose a file smaller than 10 MB.");
  const form = await c.req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind"));
  if (
    !(file instanceof File) ||
    ![
      "avatar",
      "cover",
      "product",
      "post",
      "resource",
      "kyc",
      "support",
      "notification-sound",
    ].includes(kind)
  )
    throw new AppError(400, "BAD_REQUEST", "Choose a file from your device.");
  if (file.size < 1 || file.size > 10 * 1024 * 1024)
    throw new AppError(400, "BAD_REQUEST", "Choose a file smaller than 10 MB.");
  const recent = await database(c.env).execute<{ allowed: boolean }>(
    sql`select app_private.consume_request_rate_limit('MEDIA_UPLOAD',${user.id},30,3600,3600) allowed`,
  );
  if (!firstRow(recent)?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Upload limit reached. Try again later.",
    );
  if(kind === "notification-sound") {
    await resolveAdminScope(c.env,user,user.universityId??undefined,"notifications.manage");
    if(file.size>2*1024*1024) throw new AppError(400,"BAD_REQUEST","Use a notification sound smaller than 2 MB.");
  }
  const bytes = await file.arrayBuffer();
  let mime = detectedMime(new Uint8Array(bytes));
  if(!mime && kind === "resource" && file.type === "text/plain") {
    try { const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);if(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) mime="text/plain"; } catch { /* Not a UTF-8 source. */ }
  }
  if (!mime || (kind === "notification-sound" ? !["audio/mpeg","audio/wav"].includes(mime) : mime.startsWith("audio/") || (mime === "video/mp4" ? kind !== "post" : !privateKinds.has(kind) && !mime.startsWith("image/"))))
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Use a JPG, PNG or WebP image, a PDF document, or an MP4 video for a post.",
    );
  const bucket = privateKinds.has(kind)
    ? c.env.PRIVATE_BUCKET
    : c.env.MEDIA_BUCKET;
  if (!bucket)
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "File storage is not connected yet.",
    );
  const mediaId = crypto.randomUUID();
  const key = `${user.id}/${kind}/${mediaId}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
  try {
  await database(c.env).execute(
    sql`insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values(${mediaId}::uuid,${user.id}::uuid,${user.universityId}::uuid,${kind},${key},${mime},${file.size},${file.name.slice(0, 180)})`,
  );
  } catch (error) {
    await bucket.delete(key);
    throw error;
  }
  const origin = (c.env.PUBLIC_API_ORIGIN ?? new URL(c.req.url).origin).replace(
    /\/$/,
    "",
  );
  const url = `${origin}/v1/media/${mediaId}`;
  if (kind === "avatar")
    await database(c.env).execute(
      sql`update public.profiles set profile_image_url=${url},updated_at=now() where user_id=${user.id}::uuid`,
    );
  if (kind === "cover")
    await database(c.env).execute(
      sql`update public.profiles set cover_image_url=${url},updated_at=now() where user_id=${user.id}::uuid`,
    );
  return c.json(
    { id: mediaId, url, kind, content_type: mime, private: privateKinds.has(kind) },
    201,
  );
});
mediaRoutes.post("/:id/access", requireAuth, async (c) => {
  const user = currentUser(c);
  const media = firstRow(
    await database(c.env).execute<Media>(
      sql`select id,owner_user_id,institution_id,kind,object_key,content_type from public.media_objects where id=${id(c.req.param("id"))}::uuid and deleted_at is null`,
    ),
  );
  if (!media) throw new AppError(404, "NOT_FOUND", "File not found.");
  await canRead(c.env, user, media);
  const token = await new SignJWT({ viewer: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(media.id)
    .setIssuer("kampusone-api")
    .setAudience("kampusone-private-file")
    .setIssuedAt()
    .setExpirationTime("90s")
    .sign(mediaKey(c.env));
  const origin = (c.env.PUBLIC_API_ORIGIN ?? new URL(c.req.url).origin).replace(
    /\/$/,
    "",
  );
  c.header("Cache-Control", "private, no-store");
  return c.json({
    url:
      origin + "/v1/media/" + media.id + "?access=" + encodeURIComponent(token),
    expiresIn: 90,
  });
});
mediaRoutes.get("/:id", async (c) => {
  const result = await database(c.env).execute<{
    id: string;
    owner_user_id: string;
    institution_id: string | null;
    kind: string;
    object_key: string;
    content_type: string;
    size_bytes: number;
  }>(
    sql`select id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes from public.media_objects where id=${id(c.req.param("id"))}::uuid and deleted_at is null`,
  );
  const media = firstRow(result);
  if (!media) throw new AppError(404, "NOT_FOUND", "File not found.");
  if (privateKinds.has(media.kind)) {
    let user: AuthenticatedUser;
    const signed = c.req.query("access");
    if (signed) {
      let viewer: string;
      try {
        const { payload } = await jwtVerify(signed, mediaKey(c.env), {
          issuer: "kampusone-api",
          audience: "kampusone-private-file",
          algorithms: ["HS256"],
        });
        if (
          payload.sub !== media.id ||
          typeof payload.viewer !== "string" ||
          !/^[0-9a-f-]{36}$/.test(payload.viewer)
        )
          throw new Error("Invalid viewer");
        viewer = payload.viewer;
      } catch {
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "This file link has expired. Open the file again.",
        );
      }
      const record = await findUserById(c.env, viewer);
      if (!record)
        throw new AppError(403, "FORBIDDEN", "File access was revoked.");
      const restricted = firstRow(
        await database(c.env).execute(
          sql`select id from public.account_restrictions where user_id=${viewer}::uuid and revoked_at is null and starts_at<=now() and(ends_at is null or ends_at>now()) limit 1`,
        ),
      );
      if (restricted)
        throw new AppError(403, "FORBIDDEN", "File access was revoked.");
      user = toAuthenticatedUser(record);
    } else {
      await requireAuth(c, async () => {});
      user = currentUser(c);
    }
    await canRead(c.env, user, media);
    await recordAudit(c.env, {
      actorUserId: user.id,
      action: "private.file.read",
      targetType: "media",
      targetId: media.id,
      requestId: c.get("requestId"),
    });
  }
  const bucket = privateKinds.has(media.kind)
    ? c.env.PRIVATE_BUCKET
    : c.env.MEDIA_BUCKET;
  const range=c.req.header("Range");
  const selected=range?byteRange(range,Number(media.size_bytes)):null;
  if(range && !selected) { c.header("Content-Range",`bytes */${media.size_bytes}`);return c.body(null,416); }
  const object = await bucket?.get(media.object_key, selected ? {range:selected} : undefined);
  if (!object) throw new AppError(404, "NOT_FOUND", "File not found.");
  c.header("Content-Type", media.content_type);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header(
    "Cache-Control",
    privateKinds.has(media.kind)
      ? "private, no-store"
      : "public, max-age=86400, immutable",
  );
  if (media.content_type === "application/pdf")
    c.header("Content-Disposition", 'attachment; filename="document.pdf"');
  c.header("Accept-Ranges","bytes");
  if(object.httpEtag)c.header("ETag",object.httpEtag);
  if(selected) {
    const {offset,length}=selected;
    c.header("Content-Range",`bytes ${offset}-${offset+length-1}/${object.size}`);
    c.header("Content-Length",String(length));return c.body(object.body,206);
  }
  c.header("Content-Length",String(object.size));
  return c.body(object.body);
});
