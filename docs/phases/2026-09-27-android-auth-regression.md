# Android authentication regression — 27 September 2026

## User-visible failure

KampusOne Android 0.3.3/build 33 could show **“The request took too long. Check your connection and try again.”** when a user tried to sign in. The branded launch transition could also disappear too quickly to be noticeable even though the component was still present.

## Root cause

The mobile app restores an existing refresh session during cold start. When an older APK/install leaves a refresh token in Android SecureStore, that restore can still be in flight when the user opens Sign in.

Interactive authentication was serialized behind the active refresh request. On a slow or unreliable mobile network, Sign in could therefore spend several seconds waiting for stale restoration before its own HTTP request began. The interactive request then had the generic 15-second transport deadline, which made a recoverable network delay appear as a failed authentication flow.

Production account inspection also confirmed that the reported account uses the current PBKDF2 password format, not the legacy Argon2 path. No password value was read or used during diagnosis.

## Repair

- Interactive session mutations now abort an in-flight cold-start refresh before proceeding.
- Sign in, registration, email verification and social completion receive a 35-second interactive network budget.
- The same native-safe AbortController transport remains in place; no unsupported `AbortSignal.timeout()` call is reintroduced.
- Existing session-generation checks continue to prevent an older refresh response from replacing a newly authenticated session.
- The **KampusOne / Already Ready for School** intro is restored as a deliberate local animation: about 1.8 seconds normally, with a 2.4-second safety deadline. It never waits for the API or profile data.
- Android release version is 0.3.4, build 34.

## Release acceptance

Before distributing build 34:
1. mobile TypeScript check must pass;
2. platform CI/auth regressions must pass;
3. Android release APK workflow must pass;
4. the resulting APK must be published from the exact build-34 commit.

The live unauthenticated auth boundary can be checked without a real account, but a successful production sign-in cannot be claimed without using a real user's credentials on a device.
