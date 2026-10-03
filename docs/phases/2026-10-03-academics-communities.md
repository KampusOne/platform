# Academic tools, communities and study groups · 3 October 2026

Academic screens now have a top right three dot action that opens selection mode. Users can select individual records, select all, cancel, and confirm deletion. Timetable selection includes every day rather than only the selected day. GPA selection includes semester history and a separate course planner / unsaved grades row. Calendar selection also handles dates stored on the device while offline. API batch mutations scope every affected row to the authenticated owner. Clearing linked alarms disables the corresponding timetable reminder, and archiving timetable entries removes their linked alarms. Device alarm schedules are refreshed after successful mutation.

Class creation, editing and reviewed import force a fifteen minute reminder. Existing live timetable reminders are normalized by migration, preserving whether each reminder is enabled. The notification import endpoint is coordinated with backend reliability to use the same offset. A class at 00:10 on Monday correctly schedules 23:55 on Sunday.

Calendar responses expose exam periods derived from imported examination rows. Adjacent faculty, general, GST and CED examination rows merge within a semester; distant semesters remain separate. `GET /v1/calendar/exam-periods` returns `{examPeriods:[{semester,startsOn,endsOn,status}],progressionRequiresConfirmation:true}`. Profiles can display these windows. Importing a calendar does not promote a student when exams begin. Existing manual academic profile confirmation remains the progression authority.

Shared AI upload usage is displayed on calendar, timetable and import screens using `/v1/ai/status.imports`. The AI agent owns atomic weekly reservations and the 5 Standard / 30 Pro shared allowance with the Standard calendar sublimit of 3. Parsing reserves an attempt; saving reviewed data and manual entries do not reserve again. Grade calculations and course planner transfer are excluded.

Students can create a community or study group, becoming its admin, and search communities by names, descriptions and keywords. Class communities and elections remain available. New groups use separate group tables and routes under `/v1/communities/groups`. Community admins publish updates, venue changes and polls. All study group members can post. Members can comment, delete their own comments, vote, follow/join, and leave. Admins can add a student by university scoped username. Group feed and study insight endpoints require membership and university scope; no group content enters the general feed. New community posts and urgent study group admin updates enqueue eligible member pushes and in app notifications; ordinary study group posts enqueue in app notifications only. Queue keys prevent duplicate delivery when publishing retries.

Study sessions start and stop through the server, support idempotent retries and survive leaving the screen. One active session per student prevents overlapping timers. Focus goals offer a countdown alongside elapsed time. Member insights show today, week and month totals, who is studying, and daily history. Sessions crossing midnight are split across campus days. Abandoned sessions expire after twelve hours. Former members cannot open the private group feed or study insights.

## Migrations

- `20261003091000_student_groups_and_academic_management.sql`: group data, comments, polls, study time, tenant foreign keys, indexes, revoked public table access and fifteen minute reminder normalization.
- `20261003092000_student_group_notification_queue.sql`: eligible member notification queue trigger and idempotent outbox keys.
- Weekly import allowance migration is owned by the AI agent.

## Verification

`npm run test -- --run tests/student-groups.test.ts tests/calendar-api.test.ts` passes 8 tests. Coverage includes creator administration; idempotent creation with conflicting retry rejection; university and membership privacy; member posting and admin only publishing; polls; comment ownership; timer retry/start/stop and insight persistence; exactly one urgent outbox item on replay; midnight alarm rollover; alarm/timetable batch ownership; selected GPA cleanup and course planner cleanup; exam window merging; personal calendar owner scoped deletion and calendar import retries.

`npm run check` passes in both mobile and server after the integrated workstreams. Root owns final repository checks, migration execution, deployment and device validation.

Real device notification reception and background alarm playback require the release build and configured push credentials. No production deployment or financial migration was run by this workstream.

## Follow up visual evidence and grade import validation

The supplied A03 login screenshot was opened again and compared with current auth components. Replaced the four clipped icon glyphs with the original approved Google G image, bundled locally with proportional rendering. Authentication errors and notices now render inline rather than creating a toast over the heading. Social errors use the same inline state. The auth scroll viewport has an explicit flexible height and safe bottom spacing; the login illustration scales down on shorter screens. Autofill remains enabled, fields now span the complete rounded input area, and scoped web autofill colors match the form surface. Apple still follows configured provider availability. Session handling was not changed.

A20 grade evidence has no separate AI grade parser in this source. The combined BIO192, PHY291 record entered through Grade Planner transfer, which previously accepted any string of two characters. Server planner and GPA saves now reject combined course codes and duplicate formatting aliases. Mobile transfer leaves combined records and all duplicate aliases out of the GPA preview, flags them for correction, and never invents a split for shared units. The inverse GPA to planner transfer also flags omitted ambiguous rows.

`grade-import-validation.test.ts` covers valid BIO192, PHY291 and spaced/hyphenated departmental codes; comma, slash and newline combinations; duplicate aliases; unknown grades and invalid units; unchanged storage after rejected saves; and a real valid GPA calculation of 4.6 over five units. Alongside calendar, group and campus activity tests, all 18 focused tests pass. Mobile and server type checks pass.
