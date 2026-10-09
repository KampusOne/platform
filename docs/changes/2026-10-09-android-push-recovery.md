# KampusOne Android push restoration — 2026-10-09

## Evidence and cause

Production read-only inspection of the KampusOne Neon project showed 12 registered Android devices, 10 with an active refresh-token session, and 39 provider delivery attempts with `InvalidCredentials` within the preceding seven days. Failures affected newsletter publisher posts, community urgent posts, feed activity, and messages. This is a Firebase/Expo credential failure, **not** a browser preview issue; the database had already queued the push notifications.

The mobile application uses package `app.kampusone.mobile`, and its Android `google-services.json` belongs to Firebase project `kampusone-5064e`. The public client JSON is not the private FCM V1 sending credential. Expo requires a Firebase service-account credential uploaded to the **Expo project associated with the installed Android APK**. Source-only changes cannot repair a revoked Google service account or missing Firebase IAM authorization.

## Recovery workflow (secret-safe)

The GitHub production environment must contain:

- `EXPO_TOKEN`: Expo access token with permission to manage credentials on the same EAS project used to build the APK.
- `EXPO_EAS_PROJECT_ID`: project UUID embedded in `Constants.easConfig.projectId`/Expo extra during Android build.
- `FCM_SERVICE_ACCOUNT_JSON_BASE64`: base64-encoded **private Firebase service-account JSON** for `kampusone-5064e`. It must not be `google-services.json`.
- `GOOGLE_SERVICES_JSON_BASE64`: Android build client's Firebase configuration, already used by APK packaging.

On merge to `main`, the narrowly scoped workflow `.github/workflows/restore-android-push.yml` runs once. It validates that the Android Firebase project and service-account project match, checks Google OAuth credentials (detecting revoked keys), probes FCM V1 API authorization using an *empty* message that cannot target a phone, and updates the exact Expo project's Android FCM V1 credential. It reads back the assigned service-account key identifier. The workflow never prints or uploads keys to GitHub artifacts.

If a key was revoked, generate a **new** private key from Firebase Project Settings > Service accounts; grant that service account the **Firebase Cloud Messaging API Admin** role and enable the Firebase Cloud Messaging API. Replace only the GitHub Actions secret and rerun the workflow. Do not commit private keys or paste them into chats. A linked Expo key does not prove that a notification actually reached a device.

## Application-level fixes

1. `GET /v1/notifications/devices` now reports whether a registered device is deliverable **from the current authenticated session family**; after password changes/logouts the native app can immediately re-register a stale token.
2. The `profilePosts` phone channel is on by default, but only explicitly followed publisher accounts create post notifications. Recipients can mute this phone channel from Settings.
3. New community subscribers still choose their own notifications preference; if it is off, the community page now prominently offers **Enable alerts for new community posts**. A community author does not receive their own alert.
4. The admin notification workspace surfaces real, aggregated seven-day `InvalidCredentials` failures and FCM recovery instructions. This prevents a misleading “sent” assumption.

## End-to-end acceptance — REQUIRED

1. Confirm the FCM recovery workflow is green, including OAuth, FCM API authorization, Expo key assignment and reread.
2. In an installed physical Android APK, sign into a **recipient** account (not the account creating the newsletter/community post). Under Notification Settings, allow phone notifications and confirm the device is registered. The newest Android APK must have been compiled with the matching Expo project UUID and Firebase client configuration.
3. Send a single selected-device test from Admin > Notifications; check Expo ticket acceptance, Expo receipt, and **physical phone observation**.
4. Publish one newsletter post from the browser under the managed newsletter account and verify a subscribed and eligible second account receives the notification (not the publishing account).
5. In an approved community, enable community notifications for a member and publish a normal/urgent admin post as a different account. Confirm notification delivery and tappable deep link. Opt out and confirm further posts are not pushed.
6. Re-login on the phone (or rotate the session) and confirm automatic re-registration before retesting. Also check Android notification channel and system restrictions.
7. Do not resend stale newsletters or urgent alerts just to mask old provider failures; create fresh test events.

Successful CI is **credential linkage**, not verified end-to-end delivery until the recipient's phone actually displays the test. The workflow is reversible by linking a different reviewed FCM V1 key through Expo Credentials.
