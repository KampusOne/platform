# Media display and photo editing repair — 2026-09-23

## Scope

Repair uploaded image display across the separately hosted Worker, mobile web app and native app. Keep R2 bucket bindings and all private-file authorization unchanged. Add a shared avatar/cover crop editor and local-first post attachments.

## Implementation

- Preserve the original API transport and authentication in api-transport.ts. Normalize exact media URL fields through the active client API base; retain signed-link parameters and use a stable cache version to avoid previously blocked responses.
- Apply media-specific security headers after Hono's secure defaults, only to successful image/PDF GET or HEAD responses. Authentication, tenant/role checks, no-store on private files and MIME protection are unchanged. Authorized PDFs open inline where supported; download=1 retains attachment behavior.
- Photo selection and crop run locally. Save exports the visible crop; Cancel sends no upload. A circular 1:1 preview serves avatars and a 3:1 preview serves covers. Drag, zoom, reset and accessible positioning controls work through React Native on web and native targets.
- Post attachments show a local preview before upload finishes. Failed uploads retain the draft. Failed delivery checks retain the uploaded ID and retry without duplicating the successful upload.
- Verify returned image URLs can load before declaring them ready; invalidate profile cache after successful writes.

## Verification

- Eight dependency-free client regression tests passed locally: crop geometry and bounds, invalid dimensions, web/native URLs, signed parameters, preserved content, Save/Cancel/stale edit sessions.
- New Worker integration tests exercise image delivery headers, avatar upload, private access denial, signed PDF access, expiry and explicit downloads using mocked storage/database and the real media route.
- Existing full CI must pass type checks, unit tests and production builds before release.
- No production credentials, real private documents or signed-in user session were used for local tests. A real profile/cover/post upload and authorized admin document opening remain release acceptance checks; native-device gestures require device validation.
