# KampusOne product analytics

KampusOne uses one GA4 property with separate Android, iOS, and Web streams.

```
Android app -> Firebase Analytics SDK -> Android GA4 stream
iOS app     -> Firebase Analytics SDK -> iOS GA4 stream
Web app     -> local bounded queue -> /v1/analytics/events -> Worker -> Web GA4 stream
                                               |
                                               +-- no Neon/PostgreSQL dependency
```

The Android and iOS builds use their platform Firebase configuration files and native
Firebase Analytics. Web product events use Measurement Protocol through the Worker.
If a native development shell does not contain the Firebase module, the client falls
back to the Worker queue instead of breaking the app.

The existing `/v1/student/events` store remains in place for internal/admin reporting.
It is intentionally separate from Google Analytics so a database outage does not stop
product analytics.

## What is tracked

The event vocabulary stays small and stable. Product detail belongs in structured
parameters instead of creating a new event name for every button.

| Event | Purpose | Common parameters |
| --- | --- | --- |
| `page_view` | Known KampusOne screen viewed | `screen`, `app_platform`, `app_version` |
| `ui_interaction` | Navigation and shared UI control interaction | `screen`, `action`, `component` |
| `feature_started` | A product mutation begins | `feature`, `action`, `component` |
| `feature_completed` | A product mutation succeeds | `feature`, `action`, `duration_ms` |
| `feature_failed` | A product mutation fails | `feature`, `action`, `error_code`, `duration_ms` |
| `content_action` | Social/content interaction | `screen`, `action`, `component` |
| `media_action` | Media-specific interaction | structured product tokens only |
| `notification_action` | Notification interaction | structured product tokens only |
| `auth_action` | Authentication interaction | `screen`, `action`, `component` |
| `performance_timing` | Product timing that matters to UX | `feature`, `duration_ms` |

Feature lifecycle tracking is also generated at the API boundary for mutations in:
authentication, social feed, timetable, GPA, campus map, store, Kira, messaging,
media, learning/tutorials, academic calendar, communities, notifications, agents,
payments, payouts, account, people, applications, and student features.

## Privacy boundary

Do not send any of the following to Google Analytics:

- email addresses, phone numbers, matriculation numbers, names, usernames, or IDs;
- Kira prompts or responses;
- chat/message bodies, comments, post text, search text, or form text;
- filenames, document contents, timetable contents, grades, or notes;
- exact latitude/longitude or temporary friend locations;
- raw URLs that contain record identifiers or query strings;
- database IDs, order IDs, post IDs, message IDs, or notification IDs.

Only controlled product taxonomy values matching `[a-z0-9_-]` are accepted by the
Worker. The analytics route rejects free-form fields.

## Delivery behavior

### Android and iOS

- Native events are logged to Google Analytics for Firebase.
- Screen events use the native `screen_view` event.
- Product events use the same small KampusOne event vocabulary across platforms.
- Firebase handles native app sessions, app versions, device metadata, and offline delivery.
- The iOS Analytics package is configured without Ad ID support.
- Analytics failures never interrupt navigation or feature completion.

### Web and native fallback

- Web events are queued outside the render path.
- Up to 25 events are sent in one batch.
- The queue is capped at 250 events per installation.
- The queue is persisted in AsyncStorage so temporary network loss does not block UX.
- Normal batches wait briefly so several taps can share one request.
- A queue of 10 or more events flushes quickly.
- Failed delivery retries later instead of interrupting the user.
- The Worker has a kill switch and a per-install safety fuse.
- Analytics delivery never clears or invalidates normal screen/API caches.

## GA4 setup

Use one **KampusOne GA4 property** with three streams:

- Android: Firebase app `app.kampusone.mobile`
- iOS: Firebase app `app.kampusone.mobile`
- Web: `https://kampusone.app`

The Worker uses the Web stream only for web/fallback Measurement Protocol events.

1. In Google Analytics, open the KampusOne property.
2. Go to **Admin -> Data streams** and create/select a Web stream for the app product
   analytics pipeline.
3. Copy its Measurement ID (`G-...`).
4. In that stream, open **Measurement Protocol API secrets** and create a secret.
5. Put the API secret in Cloudflare as a secret. Never place it in Expo config,
   JavaScript bundles, GitHub, Vercel public variables, or `EXPO_PUBLIC_*`.

Production setup:

```sh
cd server
npx wrangler secret put GA4_API_SECRET
```

Then set these Worker vars:

```
GA4_ANALYTICS_ENABLED=true
GA4_MEASUREMENT_ID=G-GWFL9R95B8
```

Deploy the Worker after the secret and Measurement ID are present. Keep
`GA4_ANALYTICS_ENABLED=false` in any environment that should discard analytics.

## GA4 custom dimensions

Register these event-scoped custom dimensions first:

- `screen`
- `feature`
- `action`
- `component`
- `target`
- `app_platform`
- `app_build`
- `error_code`

`app_version`, `duration_ms`, `session_id`, `engagement_time_msec`, page title,
and page location can be used directly where GA4 already exposes them or through
Explorations as appropriate.

## Suggested product funnels

Useful funnels once data is live:

1. Sign up -> verification -> onboarding -> Today.
2. Today -> timetable -> timetable import -> import completed.
3. Today -> GPA -> grade entry/import -> GPA update completed.
4. Feed view -> open post -> like/reply/repost/share.
5. Store view -> product/store action -> order mutation completed.
6. Kira view -> AI mutation started -> completed/failed.
7. Notification view -> related destination -> feature action.
8. Learning/tutorial view -> booking/checkout mutation completed.

Do not mark every interaction as a key event. Reserve key events for outcomes such as
completed onboarding, completed timetable import, completed booking/order, or another
business/product success state.

## Validation

Before enabling production collection:

1. Deploy with a test Measurement ID and secret.
2. Open GA4 Realtime and use one test device.
3. Visit several screens and perform a few safe interactions.
4. Confirm no dynamic record IDs or user-entered text appear in event parameters.
5. Force an offline period, generate events, reconnect, and verify the queue drains.
6. Confirm a database outage does not stop `/v1/analytics/events`.
7. Confirm analytics failures do not block navigation or feature requests.
