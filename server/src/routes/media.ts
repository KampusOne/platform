import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { byteRange } from "../lib/http-range";
import { currentUser, requireAuth } from "../middleware/auth";
import { id, input } from "../lib/input";
import {z} from '@kampusone/contracts';
import { adminAccess, resolveAdminScope } from "../lib/admin-access";
import { recordAudit } from "../lib/audit";
import {requireAdminWorkspace}from'../lib/admin-workspace';
import { purchasedMaterialAccess } from '../lib/material-commerce';
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
  if(media.kind==='operations-document'){
    await requireAdminWorkspace(env);
    const scope=await resolveAdminScope(env,user,media.institution_id??undefined,'documents.view');
    if(scope!==null&&scope!==media.institution_id)throw new AppError(403,'FORBIDDEN','This document is outside your university scope.');
    if(!firstRow(await database(env).execute(sql`select id from app_private.operations_documents where media_id=${media.id}::uuid and institution_id is not distinct from ${media.institution_id}::uuid and archived_at is null`)))throw new AppError(404,'NOT_FOUND','This operations document is unavailable.');
    return;
  }
  if (user.id === media.owner_user_id) return;
  if(media.kind==='map-capture'){
    if(user.universityId===media.institution_id&&firstRow(await database(env).execute(sql`select id from public.campus_place_media where media_id=${media.id}::uuid and institution_id=${user.universityId}::uuid and moderation_state='APPROVED'`)))return;
    try{await resolveAdminScope(env,user,media.institution_id??undefined,'universities.manage');return;}catch{throw new AppError(403,'FORBIDDEN','This map capture is awaiting review or belongs to another campus.');}
  }
  if (media.kind === "message") {
    const allowed = firstRow(
      await database(env).execute(sql`
        select m.id
        from public.direct_messages m
        join public.direct_threads t on t.id=m.thread_id
        where m.media_id=${media.id}::uuid
          and t.status='ACCEPTED'
          and ${user.id}::uuid in(t.initiator_id,t.recipient_id)
          and not exists(
            select 1 from public.user_blocks b
            where (b.blocker_id=t.initiator_id and b.blocked_id=t.recipient_id)
               or (b.blocker_id=t.recipient_id and b.blocked_id=t.initiator_id)
          )
        limit 1
      `),
    );
    if (allowed) return;
    throw new AppError(
      403,
      "FORBIDDEN",
      "This conversation file is unavailable.",
    );
  }
  const permission=media.kind==='kyc'?'agents.verify':media.kind==='support'?'support.view':'content.view';
  const access=await adminAccess(env,user);
  if(access.permissions.includes(permission)){
    try {
      const scope=await resolveAdminScope(env,user,media.institution_id??undefined,permission);
      if(scope===null||scope===media.institution_id)return;
    } catch(error) {if(!(error instanceof AppError)||error.status!==403)throw error;}
  }
  if (media.kind === "resource" && user.universityId === media.institution_id) {
    if(await purchasedMaterialAccess(env,user,media.id))return;
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
const privateKinds = new Set(["kyc", "support", "resource", "message","operations-document","map-capture"]);
const uploadKinds = new Set(["avatar", "cover", "product", "post", "resource", "kyc", "support", "notification-sound", "message","operations-document","map-capture"]);
const standardUploadLimit = 10 * 1024 * 1024;
const postVideoUploadLimit = 50 * 1024 * 1024;
type StreamableMedia = Media & { size_bytes: number };
const publicRangeMetadata = new Map<string, { expires: number; media: StreamableMedia }>();
const publicRangeMetadataTtl = 5 * 60_000;
function readPublicRangeMetadata(mediaId: string): StreamableMedia | undefined {
  const cached = publicRangeMetadata.get(mediaId);
  if (!cached) return undefined;
  if (cached.expires <= Date.now()) {
    publicRangeMetadata.delete(mediaId);
    return undefined;
  }
  return cached.media;
}
function rememberPublicRangeMetadata(media: StreamableMedia) {
  publicRangeMetadata.delete(media.id);
  publicRangeMetadata.set(media.id, { expires: Date.now() + publicRangeMetadataTtl, media });
  while (publicRangeMetadata.size > 256) {
    const oldest = publicRangeMetadata.keys().next().value as string | undefined;
    if (!oldest) break;
    publicRangeMetadata.delete(oldest);
  }
}
function uploadTooLargeMessage(kind: string, mime: string | null | undefined) {
  if (mime?.startsWith("video/") && ["post", "message"].includes(kind)) {
    return "Videos can be up to 50 MB. Trim or choose a smaller video.";
  }
  return "Choose a file smaller than 10 MB.";
}

const openXmlDocumentMimes = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);
const legacyDocumentMimes = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);
const textDocumentMimes = new Set(["text/plain", "text/csv", "application/rtf", "text/rtf"]);

function documentMimeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".odt")) return "application/vnd.oasis.opendocument.text";
  if (lower.endsWith(".ods")) return "application/vnd.oasis.opendocument.spreadsheet";
  if (lower.endsWith(".odp")) return "application/vnd.oasis.opendocument.presentation";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".rtf")) return "application/rtf";
  return "";
}

function looksLikeUtf8Text(bytes: Uint8Array) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes,{stream:true});
    return !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text);
  } catch {
    return false;
  }
}
export function verifiedMessageMime(bytes:Uint8Array,declaredMime:string,originalName:string){
 const detected=detectedMime(bytes);if(detected)return detected;
 const inferred=openXmlDocumentMimes.has(declaredMime)||legacyDocumentMimes.has(declaredMime)||textDocumentMimes.has(declaredMime)?declaredMime:documentMimeFromName(originalName);
 const zip=bytes[0]===0x50&&bytes[1]===0x4b&&[0x03,0x05,0x07].includes(bytes[2]??-1);
 const compound=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((v,i)=>bytes[i]===v);
 if(openXmlDocumentMimes.has(inferred)&&zip)return inferred;
 if(legacyDocumentMimes.has(inferred)&&compound)return inferred;
 if(inferred==='application/rtf'||inferred==='text/rtf')return new TextDecoder().decode(bytes.slice(0,64)).trimStart().startsWith('{\\rtf')?inferred:null;
 if(textDocumentMimes.has(inferred)&&looksLikeUtf8Text(bytes))return inferred;
 return null;
}
const messageChunkBytes=5*1024*1024;
type UploadSession={id:string;object_key:string;multipart_id:string;original_name:string;declared_type:string;content_type:string|null;expected_bytes:number;parts:Record<string,{etag:string;size:number}>;status:string;media_id:string|null;institution_id:string|null};
async function uploadSession(env:Bindings,userId:string,sessionId:string){const session=firstRow(await database(env).execute<UploadSession>(sql`select * from app_private.media_upload_sessions where id=${sessionId}::uuid and owner_user_id=${userId}::uuid and (expires_at>now() or status='COMPLETE')`));if(!session)throw new AppError(404,'NOT_FOUND','This upload expired. Choose the file again.');if(!env.PRIVATE_BUCKET)throw new AppError(503,'PROVIDER_UNAVAILABLE','Private uploads are temporarily unavailable.');return session;}
mediaRoutes.post('/message-uploads',requireAuth,async c=>{
 const user=currentUser(c),data=await input(c,z.object({uploadId:z.string().uuid(),name:z.string().trim().min(1).max(180),type:z.string().max(180),size:z.number().int().min(1).max(500*1024*1024)}).strict()),db=database(c.env);
 const existing=firstRow(await db.execute<UploadSession>(sql`select * from app_private.media_upload_sessions where id=${data.uploadId}::uuid and owner_user_id=${user.id}::uuid and expires_at>now()`));if(existing){if(Number(existing.expected_bytes)!==data.size||existing.original_name!==data.name)throw new AppError(409,'CONFLICT','This upload belongs to another file.');return c.json({id:existing.id,parts:existing.parts,status:existing.status,mediaId:existing.media_id,chunkBytes:messageChunkBytes});}
 if(!c.env.PRIVATE_BUCKET)throw new AppError(503,'PROVIDER_UNAVAILABLE','Private uploads are temporarily unavailable.');
 const allowance=firstRow(await db.execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('MESSAGE_LARGE_UPLOAD',${user.id},12,3600,3600) and (select coalesce(sum(expected_bytes),0)<2147483648 from app_private.media_upload_sessions where owner_user_id=${user.id}::uuid and created_at>now()-interval '24 hours' and status<>'ABORTED') allowed`));if(!allowance?.allowed)throw new AppError(429,'RATE_LIMITED','Your upload allowance is reached. Retry later; your message is saved.');
 const key=`message/${user.id}/${data.uploadId}`,multipart=await c.env.PRIVATE_BUCKET.createMultipartUpload(key,{customMetadata:{owner:user.id,uploadId:data.uploadId}});
 try{await db.execute(sql`insert into app_private.media_upload_sessions(id,owner_user_id,institution_id,object_key,multipart_id,original_name,declared_type,expected_bytes) values(${data.uploadId}::uuid,${user.id}::uuid,${user.universityId}::uuid,${key},${multipart.uploadId},${data.name},${data.type},${data.size})`);}catch(error){await multipart.abort();throw error;}
 return c.json({id:data.uploadId,parts:{},status:'OPEN',mediaId:null,chunkBytes:messageChunkBytes},201);
});
mediaRoutes.put('/message-uploads/:id/parts/:part',requireAuth,async c=>{
 const user=currentUser(c),session=await uploadSession(c.env,user.id,id(c.req.param('id'))),part=Number(c.req.param('part')),count=Math.ceil(Number(session.expected_bytes)/messageChunkBytes);
 if(session.status!=='OPEN'||!Number.isInteger(part)||part<1||part>count)throw new AppError(409,'CONFLICT','Refresh this upload before retrying.');
 const expected=part===count?Number(session.expected_bytes)-(part-1)*messageChunkBytes:messageChunkBytes;
 if(Number(c.req.header('Content-Length')??expected)!==expected)throw new AppError(400,'BAD_REQUEST','Upload chunk has the wrong size.');
 const reader=c.req.raw.body?.getReader();if(!reader)throw new AppError(400,'BAD_REQUEST','Choose the file again.');const chunks:Uint8Array[]=[];let size=0;while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>expected){await reader.cancel();throw new AppError(413,'BAD_REQUEST','Upload chunk is too large.');}chunks.push(next.value);}if(size!==expected)throw new AppError(400,'BAD_REQUEST','Upload chunk is incomplete. Retry this file.');
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const mime=part===1?verifiedMessageMime(bytes,session.declared_type,session.original_name):session.content_type;if(!mime)throw new AppError(400,'BAD_REQUEST','Use a supported picture, video, voice note or document.');
 const multipart=c.env.PRIVATE_BUCKET!.resumeMultipartUpload(session.object_key,session.multipart_id),uploaded=await multipart.uploadPart(part,bytes);
 await database(c.env).execute(sql`update app_private.media_upload_sessions set parts=parts||jsonb_build_object(${String(part)},${JSON.stringify({etag:uploaded.etag,size})}::jsonb),content_type=coalesce(content_type,${mime}) where id=${session.id}::uuid and status='OPEN'`);return c.json({part,etag:uploaded.etag,size});
});
mediaRoutes.post('/message-uploads/:id/complete',requireAuth,async c=>{
 const user=currentUser(c),session=await uploadSession(c.env,user.id,id(c.req.param('id'))),origin=(c.env.PUBLIC_API_ORIGIN??new URL(c.req.url).origin).replace(/\/$/,'');
 if(session.status==='COMPLETE')return c.json({id:session.media_id,url:`${origin}/v1/media/${session.media_id}`,kind:'message',private:true});
 if(!['OPEN','COMPLETING'].includes(session.status))throw new AppError(409,'CONFLICT','This upload was cancelled.');
 const count=Math.ceil(Number(session.expected_bytes)/messageChunkBytes),parts=[];let total=0;for(let part=1;part<=count;part++){const saved=session.parts[String(part)];if(!saved)throw new AppError(409,'CONFLICT','Some chunks are missing. Retry the upload to resume.');parts.push({partNumber:part,etag:saved.etag});total+=saved.size;}if(total!==Number(session.expected_bytes)||!session.content_type)throw new AppError(409,'CONFLICT','The file is incomplete. Retry to resume.');
 await database(c.env).execute(sql`update app_private.media_upload_sessions set status='COMPLETING' where id=${session.id}::uuid and status='OPEN'`);
 try{await c.env.PRIVATE_BUCKET!.resumeMultipartUpload(session.object_key,session.multipart_id).complete(parts);}catch(error){const head=await c.env.PRIVATE_BUCKET!.head(session.object_key);if(!head||head.size!==total)throw error;}
 // Deterministic media ID plus a single SQL statement makes completion safe to retry.
 await database(c.env).execute(sql`with media as(insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values(${session.id}::uuid,${user.id}::uuid,${session.institution_id}::uuid,'message',${session.object_key},${session.content_type},${total},${session.original_name}) on conflict(id) do nothing) update app_private.media_upload_sessions set status='COMPLETE',media_id=${session.id}::uuid where id=${session.id}::uuid`);
 return c.json({id:session.id,url:`${origin}/v1/media/${session.id}`,kind:'message',private:true},201);
});
mediaRoutes.delete('/message-uploads/:id',requireAuth,async c=>{const session=await uploadSession(c.env,currentUser(c).id,id(c.req.param('id')));if(session.status==='COMPLETE')throw new AppError(409,'CONFLICT','This file has already been uploaded.');await c.env.PRIVATE_BUCKET!.resumeMultipartUpload(session.object_key,session.multipart_id).abort();await database(c.env).execute(sql`update app_private.media_upload_sessions set status='ABORTED' where id=${session.id}::uuid`);return c.json({cancelled:true});});
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
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    const ebml = new TextDecoder().decode(bytes.slice(0, 256)).toLowerCase();
    if (ebml.includes("webm")) return "video/webm";
  }
  // ISO Base Media container: accept MP4 brands, not arbitrary ftyp/HEIC files.
  if (head.slice(4, 8) === "ftyp" && ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "M4A "].includes(head.slice(8, 12))) return "video/mp4";
  return null;
}
mediaRoutes.post("/", requireAuth, async (c) => {
  const user = currentUser(c);
  const contentType = c.req.header("Content-Type") ?? "";
  const requestMime = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  const rawLargeVideoUpload =
    ["post", "message"].includes(String(c.req.query("kind") ?? "")) &&
    requestMime.startsWith("video/");
  const requestLimit = rawLargeVideoUpload
    ? postVideoUploadLimit
    : standardUploadLimit;
  if (Number(c.req.header("Content-Length") ?? 0) > requestLimit + 4096)
    throw new AppError(
      413,
      "BAD_REQUEST",
      uploadTooLargeMessage(String(c.req.query("kind") ?? ""), requestMime),
    );
  let kind = "";
  let originalName = "upload";
  let declaredMime = "";
  let bytes: ArrayBuffer;

  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new AppError(400, "BAD_REQUEST", "Choose the file again and retry the upload.");
    }
    const file = form.get("file");
    kind = String(form.get("kind") ?? "");
    if (!(file instanceof File))
      throw new AppError(400, "BAD_REQUEST", "Choose a file from your device.");
    originalName = file.name || "upload";
    declaredMime = (file.type.split(";")[0] ?? "").trim().toLowerCase();
    bytes = await file.arrayBuffer();
  } else {
    // Current native/web clients upload the original bytes directly to avoid
    // incompatible FormData implementations and unnecessary media copies.
    kind = String(c.req.query("kind") ?? "");
    originalName = String(c.req.query("name") ?? "upload").trim() || "upload";
    declaredMime = (contentType.split(";")[0] ?? "").trim().toLowerCase();
    bytes = await c.req.arrayBuffer();
  }

  if (!uploadKinds.has(kind))
    throw new AppError(400, "BAD_REQUEST", "Choose a file from your device.");
  let institution=user.universityId;
  if(kind==='map-capture'&&!firstRow(await database(c.env).execute(sql`select id from public.agent_profiles where user_id=${user.id}::uuid and university_id=${user.universityId}::uuid and status='ACTIVE' limit 1`)))throw new AppError(403,'FORBIDDEN','Map capture requires an approved campus agent account.');
  if(kind==='operations-document'){
    await requireAdminWorkspace(c.env);
    institution=await resolveAdminScope(c.env,user,c.req.query('universityId'),'documents.manage');
  }
  if (bytes.byteLength < 1)
    throw new AppError(400, "BAD_REQUEST", "Choose a file from your device.");

  const recent = await database(c.env).execute<{ allowed: boolean }>(
    sql`select app_private.consume_request_rate_limit('MEDIA_UPLOAD',${user.id},30,3600,3600) allowed`,
  );
  if (!firstRow(recent)?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Upload limit reached. Try again later.",
    );

  if (kind === "notification-sound") {
    // The same verified MP3/WAV media type is used by the admin catalogue and
    // by a student's private alarm choices. Publishing a sound to the campus
    // catalogue still requires notifications.manage in the notifications route.
    if (bytes.byteLength > 2 * 1024 * 1024)
      throw new AppError(400, "BAD_REQUEST", "Use an alarm sound smaller than 2 MB.");
  }

  const byteView = new Uint8Array(bytes);
  let mime = detectedMime(byteView);
  if (!mime && ["message","operations-document"].includes(kind)) {
    const inferredDocumentMime =
      openXmlDocumentMimes.has(declaredMime) || legacyDocumentMimes.has(declaredMime) || textDocumentMimes.has(declaredMime)
        ? declaredMime
        : documentMimeFromName(originalName);
    const zipSignature = byteView[0] === 0x50 && byteView[1] === 0x4b && [0x03, 0x05, 0x07].includes(byteView[2] ?? -1);
    const compoundSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => byteView[index] === value);
    const headText = new TextDecoder().decode(byteView.slice(0, Math.min(byteView.length, 64)));

    if (openXmlDocumentMimes.has(inferredDocumentMime) && zipSignature) {
      mime = inferredDocumentMime;
    } else if (legacyDocumentMimes.has(inferredDocumentMime) && compoundSignature) {
      mime = inferredDocumentMime;
    } else if (textDocumentMimes.has(inferredDocumentMime)) {
      if ((inferredDocumentMime === "application/rtf" || inferredDocumentMime === "text/rtf") && headText.startsWith("{\\rtf")) {
        mime = "application/rtf";
      } else if (["text/plain", "text/csv"].includes(inferredDocumentMime) && looksLikeUtf8Text(byteView)) {
        mime = inferredDocumentMime;
      }
    }
  }
  if (!mime && kind === "resource" && declaredMime === "text/plain") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) mime = "text/plain";
    } catch {
      /* Not a UTF-8 source. */
    }
  }
  if (
    kind === "message" &&
    declaredMime.startsWith("audio/") &&
    ["video/webm", "video/mp4"].includes(mime ?? "")
  ) {
    mime = mime === "video/webm" ? "audio/webm" : "audio/mp4";
  }
  if(kind==='map-capture'&&!mime?.startsWith('image/'))throw new AppError(400,'BAD_REQUEST','Capture a JPG, PNG or WebP campus photo.');
  const finalLimit =
    ["post", "message"].includes(kind) && mime?.startsWith("video/")
      ? postVideoUploadLimit
      : standardUploadLimit;
  if (bytes.byteLength > finalLimit)
    throw new AppError(
      413,
      "BAD_REQUEST",
      uploadTooLargeMessage(kind, mime ?? declaredMime),
    );
  if (!mime || (kind === "notification-sound" ? !["audio/mpeg", "audio/wav"].includes(mime) : (mime.startsWith("audio/") && kind !== "message") || (["video/mp4", "video/webm"].includes(mime) ? !["post", "message"].includes(kind) : !privateKinds.has(kind) && !mime.startsWith("image/"))))
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Use a JPG, PNG or WebP picture, an MP4/WebM video, audio, PDF, Word, Excel, PowerPoint, OpenDocument, text or CSV file.",
    );

  const bucket = privateKinds.has(kind) ? c.env.PRIVATE_BUCKET : c.env.MEDIA_BUCKET;
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
      sql`insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values(${mediaId}::uuid,${user.id}::uuid,${institution}::uuid,${kind},${key},${mime},${bytes.byteLength},${originalName.slice(0, 180)})`,
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
  const mediaId = id(c.req.param("id"));
  const range = c.req.header("Range");
  let media = range ? readPublicRangeMetadata(mediaId) : undefined;
  if (!media) {
    const result = await database(c.env).execute<StreamableMedia>(
      sql`select id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes from public.media_objects where id=${mediaId}::uuid and deleted_at is null`,
    );
    media = firstRow(result);
    if (media && range && !privateKinds.has(media.kind)) rememberPublicRangeMetadata(media);
  }
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
