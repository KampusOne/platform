# Website blog cover uploads — 18 October 2026

The Website & journal editor now chooses a cover image from the administrator's device instead of requiring a URL. It shows the selected image, allows replacement/removal, validates JPG/PNG/WebP files up to 4 MiB, and uploads through the existing authenticated public post-media route before saving the article. The limit fits the web portal's request-size boundary.

Saving disables editor controls, explains upload progress, and preserves both the article and selected image on an upload failure. If the image uploads but the article save fails, retry reuses the stored image. Object URLs are released when a selection changes or the editor unmounts. Global content-management authorization and server-side media validation, storage, and upload quotas remain in use. No schema migration or backend boundary change is required.

The corresponding public website change lives in warriorpikin/kampusone-landing: Download links lead to /download without a pinned version or direct release URL. Decorative logo filters and movement no longer apply to blog photographs. The verified download API already serves Android 0.3.44 with SHA-256 dcd5a9bcdd68d0a6b648a9301b1541805d97f1b80b0ec4afcbe0b87b4af03a4e.

Validation: website and portal TypeScript checks, ESLint, production builds, and diff checks passed. A live browser inspection confirmed the original image loaded at 547 pixels wide while the inherited brightness/invert filter and logo animation hid it. Successful authenticated publication of a personal blog article is not part of this verification.
