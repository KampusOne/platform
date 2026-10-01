# Native authentication timeout diagnosis and source correction

Investigated from the released source `c1256d552a5643b0d1d5979ed17d4e870d91e1be`
after a reported login timeout followed by successful sign in after a password
reset. Existing release work and account credentials were preserved.

## Confirmed defects

- Native sign in had a 35-second request deadline. On a stalled primary route,
  the request failed and selected the alternate origin only for the next
  request. Authentication POSTs were deliberately not replayed because session
  rotation and one-time codes can already have been consumed on the server.
- Ordinary GET/HEAD reads spent the entire request budget on their first
  attempt. After a timeout, the alternate-origin guard had no remaining budget
  and never attempted the available backup.
- A native fetch that ignored cancellation and returned late could mark its
  failed origin healthy again after another request recovered on the backup.

Two controlled tests against the unmodified release reproduced the first two
defects. The first test signed in with exactly the same password on a manual
retry using the backup; no password reset endpoint was called.

Live synthetic invalid-credential requests to the Worker and the Vercel proxy
both returned the proper JSON 401 response. Read-only credential-format checks
found supported PBKDF2 formatting in the available pre-reset snapshot and the
current account state. This does not prove that the previously entered password
matched its stored hash. The screenshot's error is the client's timeout, not a
server password-rejection response. The failing device request's original
network path and server trace were not available, so its precise trigger is not
claimed as proven. Password-reset success alone does not establish a hashing
failure.

## Correction

Native authentication with a configured alternate API now selects a reachable
origin before sending credentials. Only credential-free `/health/live` reads
race. Successful origins are reused for 60 seconds; ordinary product reads do
not acquire a health-probe waterfall. Route selection and the request share the
existing total deadline. A fresh native install with no saved refresh token
performs no session-restoration network calls.

Read requests reserve half of their total deadline for the alternate route.
Late responses from cancelled attempts cannot change the active origin. An
authentication POST, refresh rotation, or ordinary product mutation is still
sent once; a lost response remains an explicit failure that can be retried by
the user. Wrong-password responses keep their distinct 401 error.

## Validation and rollout

- 11 new native transport tests cover route recovery, read-budget reservation,
  wrong passwords, lost POST responses, cancellation, secure session restore,
  fresh installs, recent-origin reuse, and late aborted responses.
- All 527 server tests and 126 root regressions pass, including the existing
  browser session tests and password-security tests.
- Server and mobile type checks and the server build pass. The mobile production
  web export succeeds with 91 static routes. The patch has no schema migration.

This is a verified source checkpoint, not an APK publication. The installed
release still contains the old native transport until a matching Android build
is released. The investigation does not change the account password or make a
claim of physical-device verification.
