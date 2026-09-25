# Notification implementation and verification

Requirement IDs 160–165. Registration is explicit from Settings in an Android/iOS development or release build. Web preview must not claim native push support. Existing local timetable reminders remain separate.

Server stores device tokens privately and never includes them in owner/admin list responses. Registration binds the device to the current account and session family. Revoked/expired sessions cannot be targeted. Logout unregisters the installation; re-registration can move a shared physical device to its current signed-in account.

Authorized staff with `notifications.test` can select one device within permitted university scope. A fixed test message is sent only after an explicit action. UUID idempotency prevents retrying the same action from creating duplicate provider sends. Ten tests per staff account per hour bound accidental use. Timeout is stored as UNKNOWN; it is not automatically retried and called delivered.

States: SENDING -> ACCEPTED -> RECEIPT_OK or FAILED. UNKNOWN means the network result is uncertain. ACCEPTED is only an Expo ticket. RECEIPT_OK is only handoff evidence from the push provider. Recipient acknowledgement is separately recorded in `observed_at`. DeviceNotRegistered retires the token until re-registration.

Current verified evidence: local HTTP/database tests cover private token handling, owner boundaries, cross-university denial, selected-target-only send, idempotency, timeout ambiguity, token retirement and revoked-session blocking with a mocked provider. No live push was sent and no physical device receipt was observed.

Release prerequisites: apply reviewed notification migration, configure the actual EAS project ID under Expo app `extra.eas.projectId`, configure FCM/APNs credentials, build/install native app, explicitly register one selected test device. `EXPO_ACCESS_TOKEN` is needed only if Expo enhanced push access security is enabled; no public client variable should contain it.

Official references: [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) and [ticket/receipt semantics](https://docs.expo.dev/push-notifications/sending-notifications/).
