# Profile post notifications — 2026-09-28

- Adds an explicit per-profile post notification subscription instead of relying on follow state.
- `PUT /v1/people/:id/notifications` turns the subscription on or off and returns the saved state.
- Profile reads expose `post_notifications_enabled` so the menu renders **Turn on** / **Turn off** correctly.
- New student posts enqueue an in-app notification and a push outbox record for opted-in users.
- Delivery excludes blocked relationships, inactive/deleted accounts, self-notifications, and campus-ineligible posts.
- Blocking removes notification subscriptions in either direction.
- Mobile clears its API cache after the toggle so the label changes immediately.
- The existing Cloudflare cron processes push outbox records every minute; no Vercel deployment is required for this server-side delivery loop.
