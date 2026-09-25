# KampusOne repair handoff — 25 September 2026

## Current state

The repair branch reconciles the original 241-item TXT, both academic PDFs, the latest user requests, and the owner's newer manual work through main commit `50e452647b418d92077561a72fc68b23fbadc7f1`. Existing Hugging Face AI, storage, photo cropping, comments, reports and profile/repost changes are retained.

This is an implementation and test checkpoint, not a claim that all 241 requirements are complete or the live app is error-free. `register.json` retains all 241 IDs: **174 implemented but awaiting full acceptance, 62 in progress, and 5 blocked**. Automated checks cover specific behaviour; they do not replace the master brief's fourteen complete acceptance journeys.

The production Worker and new schema migrations have not been released. The user's specifically requested, audited UNIBEN programme/profile corrections below are the only production data maintenance performed in this tranche. The TXT requires separate approval for production deployment, destructive cleanup, financial execution and mass messages.

## Latest requests: implementation and limits

| Request | Change | Remaining acceptance or limit |
| --- | --- | --- |
| Open profiles from comments and replies | Server returns an eligible author ID; avatar/name navigate to the public profile. Deleted/unavailable authors do not expose a stale target. | Test on the matching deployed mobile and Worker versions. |
| Explain fluid mechanics and other broad subjects | Tutor instructions answer with a useful explanation, formulas/examples and optional deeper material. Ordinary academic questions avoid unrelated campus commerce tools. Current HF-only provider is retained. | Representative authenticated inference on the configured model is still required; changing a prompt is not model training. |
| Remember follow-up questions | Preserve current thread/history integration and send bounded prior turns, including short replies such as “why?”. History remains owner-scoped with retention controls. | Reopen a real thread and test model responses. Provider tests use controlled responses, not a live quality benchmark. |
| YouTube help with thumbnails | Verified MIT fluid-mechanics video cards, validated YouTube URLs and thumbnails. | This is not a live search service guaranteeing a best video for every topic. |
| Timetable image/PDF/text import | Classify weekly class schedules separately from dated academic calendars; validate complete dates and class fields; editable review before saving; preview/remove selected input and retry safely. | Scanned or mixed image-only PDF pages need readable image uploads. Bounded text extraction does not provide PDF OCR. |
| Supplied FUE Zaria calendar | Both semesters and the proposed next session are represented as dated calendar events. Calendar headings and day-of-month numbers cannot become “First Semester, 05:00–17:00” classes. | The regression fixture covers 16 readable activity rows; live vision extraction from the original photo is still pending. A separate lecture timetable is needed for hourly classes. |
| Simple import screen | Compact upload/paste choices, previews, day names, time inputs and concise review rows; new academic-calendar screen supports reopening and confirmed removal. | Small-screen and keyboard visual acceptance remains to be done. |
| Composer and video | Camera/gallery toolbar, attachment previews/removal, preserved draft/retry behaviour, MP4 upload and playback; image compression; actual media type; HTTP byte ranges for video seeking. | MP4 up to 10 MB; no transcoding. Native playback and real R2 upload need acceptance on the target deployment. |
| Hide internal student IDs | Campus update attribution uses display names or a neutral label, without `student:UUID`. Internal IDs remain available to authorized services. | Check existing records through the new API and frontend together. |
| Engineering award and Mechatronics | B.Eng corrections and a UNIBEN Mechatronics programme; academic editor supports programme award/duration/source records. | Official catalogue normalization remains an ongoing editorial task. |
| 200 level and profile corrections | `@warrior`: Computer Engineering, 200 level. `@peace`: Mechatronics Engineering, 200 level. Both changes are applied and audited. | Joshua's username was not identified. `@storm_x` is named Anibe David and was not guessed to be Joshua. |
| Optional public CGPA | Calculate weighted saved-term CGPA and return it publicly only after explicit opt-in. Default is private. | Existing saved terms and explicit preferences are preserved; a public profile must use the matching endpoint. |
| Follow feedback | Branded outline/transparent “Following” state with a check mark and motion that respects reduced-motion settings. | Real-device visual check pending. |
| Class community notifications | Course-rep updates retain in-app notices; push jobs use device/recipient opt-in, current campus, durable claims and receipts. | Real native build, permissions and selected-device delivery remain unverified. No live test or mass notification was sent. |
| Alarm reliability | Native schedule reconciliation on session/foreground, Lagos-time conversion, permission handling, bounded slots, snooze/retry protection and logout cancellation. Browser reminders use an open-page timer, notification permission, tone and vibration where supported. | A closed browser cannot be promised a native-style alarm. Native exact alarms, permissions and background behaviour need a supported build/device test. |
| Admin notification sounds | Authorized MP3/WAV uploads, preview, sound catalogue and audited default selection. Web reminders can use the chosen sound. | Arbitrary uploaded sounds are not automatically installed as native notification-channel sounds; native custom sounds need a build update. |
| Streak journey | Real daily activity calendar, milestone roadmap, flame changes, achieved/locked states and historical best. | Streak policy is one deliberate check-in per Lagos day; opening/refreshing a page does not invent activity. |
| Settings, focus and responsiveness | Branded switches/focus, responsive shared layouts, explicit privacy choices and loading/error states across changed screens. | Full dark-mode, contrast, navigation and keyboard audit remains incomplete; see IDs 98, 102, 109–110 and 239–241. |
| Speed and data use | Preserve current caching/performance work; compress images, avoid video autoplay and full downloads before play, bound API lists and AI inputs, retain route-level web bundles. | No claim that every session uses under 100 MB, or that production latency has been measured on Nigerian mobile networks. |
| Next map phase | Multi-university campuses and campus-specific buildings/offices, aliases, floor/room details, scoped admin editing and draft UNIBEN Ugbowo/Ekehuan records. | Custom vector styling, verified campus geometry and navigation remain the next phase. No invented coordinates or new map key requested. |
| University/faculty/department guidelines | Scoped article/version/source and image support, university/faculty/department selectors and catalogue editing. | Neither PDF provides every current rule in every Nigerian department. Unverified dress/hair/attendance rules are not published as official policy. |
| Substantial admin | Grouped searchable navigation, permissions/university context, actual record workspaces, source review, academic catalogue, applications, broadcasts, sounds, campuses and reporting. | Planned domain workflows remain identified in the register; an operational list is not proof of a complete finance/support/marketplace workflow. |
| Admin analytics | Scoped daily activity chart/tables, screen use, university comparison, observed return rate, AI request states and CSV exports. | Only recorded events are shown. Full funnels, measured provider latency/billing and entitlement editing remain incomplete. Private AI prompts and answers are not analytics fields. |

## Verification

Local checks on the combined branch:

| Check | Result |
| --- | --- |
| `cd server && npm test -- --maxWorkers=2` | 33 files, 359 tests passed |
| `node --experimental-strip-types --test tests/*.test.mjs database/imports/academic-importer.test.mjs` | 101 tests passed |
| Contracts typecheck and tests | Passed; 9 tests |
| Worker typecheck/build and Wrangler dry run | Passed; no deployment performed |
| Mobile TypeScript and production web export | Passed; 66 HTML routes |
| Portal TypeScript, ESLint with zero warnings, production build | Passed |
| Academic importer dry run | 2 documents, 530 claims, no database access or published records |
| Production schema-proof gate | Correctly blocked: the new approved production attestation does not exist |
| Local interactive browser acceptance | Unavailable: localhost navigation was blocked in this execution environment |
| Native Worker local runtime probe | Unavailable here: network-interface initialization failed; the CI runtime check remains enabled |

The first broad Node command incorrectly included a Vitest-only file and revealed a missing prerequisite in the isolated importer fixture. The fixture was corrected, Node and Vitest suites were run with their proper runners, and the final results above passed. A reports query's reserved alias and a badge middleware route-parameter issue were also fixed and covered by passing regressions.

Important automated coverage includes anonymous/finance-only/suspended staff denial, university scope, public badge independence from KYC, calendar ownership and idempotency, all-semester date validation, weighted CGPA privacy, owned media and valid/invalid video ranges, community push opt-out/old-campus/uncertain-send handling, source-import rerun/rollback, and provider adapters with history. These tests use isolated schema fixtures and controlled providers.

Web export measurement: 17,386,222 bytes for the entire exported directory; the two largest shared JavaScript files gzip to 287,628 and 228,560 bytes. This is an artifact measurement, not initial-route transfer, Android install size, or a live speed/data benchmark. A native rebuild is required for the added video module and alarm settings.

## Only new environment settings

Use `example.env.txt` as the new-only template. Existing storage, auth, database, Hugging Face model/token, frontend origins and feature settings are not reissued.

| Setting | Consumer | Classification | Owner action / feature |
| --- | --- | --- | --- |
| `RESEND_WEBHOOK_SECRET` | Matching Worker environment | Secret | Configure the Resend webhook for `/v1/email/webhooks/resend`, subscribe to the events in the template, and store that endpoint's signing secret as a Worker secret. Enables signature-verified delivery events. |
| `EXPO_ACCESS_TOKEN` | Matching Worker environment | Optional secret | Only needed if enhanced push security is enabled for the existing Expo project. Otherwise leave the commented line out. |

Do not paste secrets into the repository or chat. Configure each environment with its own provider endpoint/secret. The example endpoint is the currently observed production Worker. Environment values alone do not apply schema changes, install native modules, enable Google/Apple in Supabase, or publish reviewed university data.

## Production maintenance performed

`database/maintenance/20260925-uniben-profile-corrections.sql` was tested for rerun safety and applied atomically with audit records. It updates the identified two accounts, corrects UNIBEN Computer/Electrical award labels and adds Mechatronics. It does not change roles, public badges, KYC state or other students' levels. The three verified account identities were inspected to avoid applying a name-based guess to Joshua.

Official references used for the academic correction and learning links:

- [UNIBEN Computer Engineering B.Eng structure](https://eng.uniben.edu/course-structure-bachelor-of-engineering-computer-engineering/)
- [UNIBEN Mechanical department / Mechatronics listing](https://eng.uniben.edu/mechanical-2/)
- [MIT OpenCourseWare Advanced Fluid Mechanics](https://ocw.mit.edu/courses/2-25-advanced-fluid-mechanics-fall-2013/)
- [Expo notification configuration](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Cloudflare R2 Worker object/range API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)

## Release and remaining work

Follow `release-runbook.md`. Review the 20 correction migration files against the actual production schema, apply only missing versions/explicitly revised functions to an isolated staging target, run acceptance, then obtain the TXT's required production approval. Existing Neon branch slots are full; no existing branch was repurposed or deleted. Local PGlite migration tests are not a live Neon rehearsal. The production deployment gate intentionally requires a target-specific, approved schema attestation.

Before calling the app ready, complete the fourteen master-brief journeys on matching frontend/backend versions, including a non-UNIBEN student, real image/video storage, resumed AI conversation and uploaded timetable/calendar, selected native alarms/push, consent/preferences, session expiry and slow/offline recovery. Preview frontend readiness cannot establish backend compatibility.

Remaining implementation scope is explicit in all 241 register entries. It includes secure staff invitations, fuller domain operations and funnels, all-national reviewed academic coverage, document OCR/readability automation, managed persona governance, entitlement administration, comprehensive dark-mode/route acceptance, genuine commerce/settlement verification, and record-specific demo cleanup review. Google/Apple provider setup, the admin hostname, physical device delivery and unidentified visual references are blocked dependencies. No provider account creation, mass delivery, financial execution or destructive cleanup was performed.

The two PDFs were fully extracted and audited: the 77-page compilation lists 328 institutions and 47 expanded profiles; the 30-page compilation has 22 profiles. The 530 staging claims retain provenance and conflicting BUK, UNIBEN and Babcock claims for human review. They are not a complete, verified national catalogue and were not automatically published.
