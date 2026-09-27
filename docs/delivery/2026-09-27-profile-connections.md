# Profile connections fix — 2026-09-27

## Problem

The profile dashboard and public student profile displayed follower and following counts as plain text. There was no navigation target or API for opening the people behind those counts.

## Delivered

- Made **Followers** and **Following** tappable on the signed-in profile.
- Made the same counts tappable on public student profiles.
- Added a shared mobile connections screen with Followers/Following tabs, pull-to-refresh, pagination, loading, empty, error and retry states.
- Every row opens the corresponding public student profile.
- Added authenticated paginated API routes:
  - `GET /v1/people/:id/followers`
  - `GET /v1/people/:id/following`
- Connection lists only include active accounts with non-deleted profiles.
- Pagination is stable on relationship `created_at` plus the related user ID, with 40 visible rows per page.
- Added route-level tests plus a source regression that locks the count-to-list navigation.

## Verification notes

No database migration is required because `public.profile_follows` and its supporting indexes already exist.

The fix is isolated on `fix/profile-connections-20260927`. It has not been merged to `main` and no Vercel deployment was started.
