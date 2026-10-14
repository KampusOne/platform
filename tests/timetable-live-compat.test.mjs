import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const uploads = readFileSync(new URL("../mobile/src/lib/uploads.ts", import.meta.url), "utf8");
const timetable = readFileSync(new URL("../mobile/app/timetable-import.tsx", import.meta.url), "utf8");

test("media uploads retain raw transport with a bounded legacy multipart fallback", () => {
  assert.match(uploads, /\/v1\/media\?kind=/);
  assert.match(uploads, /caught instanceof ApiError && caught\.status === 500 && caught\.code === "INTERNAL_ERROR"/);
  assert.match(uploads, /form\.append\("file",body as Blob,file\.name\)/);
  assert.match(uploads, /uri:file\.uri,name:file\.name,type:file\.type/);
  assert.match(uploads, /api<UploadedFile>\("\/v1\/media", \{ method: "POST", body: form, timeoutMs \}\)/);
});
