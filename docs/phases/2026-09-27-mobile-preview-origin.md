# Mobile web preview authentication

The Android repair checkpoint `40f7b28` deployed successfully as Vercel preview `dpl_Jzp8xt69P6zRdc2UEYLmTpbUhz1o`. Browser verification exposed a separate session-restoration failure: its direct API rewrite preserved the generated preview Origin, while the live API trusts the canonical mobile hostname.

This web-only branch retains all parent fixes and leaves the in-progress APK 33 build untouched. Vercel Routing Middleware reuses the existing portal boundary checks with the fixed canonical **mobile** origin: exact server-owned deployment/branch host, exact same-origin browser request, and rejection of foreign/null/missing-write origins and cross-site metadata. Only KampusOne session cookies reach auth; hosting protection headers and cookies are removed. Session validation and authorization remain on the existing Worker.

The middleware matches `/api/v1/auth/:path*` only. Native apps continue to contact the Worker directly, and media uploads keep the existing external rewrite rather than entering a middleware request-body limit. No production schema, Worker version, origin allowlist, credentials or feature flags change.

Validation passed: eight mobile preview regression cases against the actual Vercel `next()` response, eight existing portal boundary tests, mobile type checking and a 77-route web export. After deployment, open the new preview and verify that an unauthenticated launch reaches Welcome rather than a session error, and that sign-in/create-account screens open. These checks do not imply a real user's credentials or verification email were tested.

Reference: https://vercel.com/docs/routing-middleware/api
