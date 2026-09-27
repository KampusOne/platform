import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const uploads = readFileSync(new URL("../mobile/src/lib/uploads.ts", import.meta.url), "utf8");
const timetable = readFileSync(new URL("../mobile/app/timetable-import.tsx", import.meta.url), "utf8");

test("media uploads retain raw transport with a bounded legacy multipart fallback", () => {
  assert.match(uploads, /\/v1\/media\?kind=/);
  assert.match(uploads, /caught instanceof ApiError && caught\.status === 500 && caught\.code === "INTERNAL_ERROR"/);
  assert.match(uploads, /form\.append\("file", body, file\.name\)/);
  assert.match(uploads, /api<UploadedFile>\("\/v1\/media", \{ method: "POST", body: form, timeoutMs \}\)/);
});

test("timetable import retries without the notes field only for the legacy strict-schema error", () => {
  assert.match(timetable, /legacyNotesRejected=Boolean\(notes\.trim\(\)\).*caught\.status===400.*caught\.code==="BAD_REQUEST"/);
  assert.match(timetable, /Student timetable preferences \(filter the visible timetable only; do not invent classes\)/);
  assert.match(timetable, /prompt:legacyPrompt,mediaId:file\?\.mediaId/);
});
