# Android Notification Permission Foundation — 2026-09-12

## Scope

This checkpoint adds the native Android permission foundation required before SautiLink can deliver remote push notifications.

It does **not** add Firebase Cloud Messaging credentials or claim that background remote delivery is live yet.

## Android behavior

- `POST_NOTIFICATIONS` is added to the generated Android manifest.
- Android 13+ requests notification permission once on first native launch when permission has not already been granted.
- A local SharedPreferences flag prevents repeated permission prompts after the first request.
- Android 12 and below do not show this runtime permission prompt.
- A stable `sautilink_updates` notification channel is created on Android 8+ with normal importance.
- Existing microphone permissions for Messages voice recording remain unchanged.
- No camera, location, contacts, SMS or call-log permission is added.

## Release

Android package version advances to `1.0.0-beta.3` / versionCode `3` so the permission-enabled APK can be distinguished and upgraded safely.

## Existing notification system

The current Supabase-backed in-app `social_notifications` flow remains the canonical notification event/history system. This change does not modify its RLS, triggers, read state or UI.

## Remote push follow-up

Remote push while the app is backgrounded or closed requires Firebase Cloud Messaging on Android. The next phase should:

1. Register `com.sautilink.app` in the SautiLink Firebase project.
2. Supply `google-services.json` to Android builds through a protected GitHub secret/build step rather than committing credentials to the repository.
3. Add the official Capacitor Push Notifications plugin.
4. Register FCM device tokens only after the user grants notification permission.
5. Store device tokens per authenticated user/device behind a narrow authenticated API and RLS boundary.
6. Deliver selected existing `social_notifications` events through a server-side FCM sender using protected Firebase credentials.
7. Revoke/disable stale tokens on logout, token rotation and delivery errors.

Firebase service credentials must never be exposed to browser JavaScript, committed to GitHub or stored in the Android web bundle.

## Rollback

Revert the Android configuration script and Android version bump. No Supabase migration, Worker API or production web behavior is changed by this checkpoint.
