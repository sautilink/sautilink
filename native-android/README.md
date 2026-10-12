# SautiLink native Android

Jetpack Compose client for the existing SautiLink production backend. Android package identities:

- `previewDebug`: `com.sautilink.preview.nativeapp` for physical-device QA.
- `productionRelease`: `com.sautilink.app` for the existing Play listing. A higher versionCode and the same registered upload key are required for an update.

The app includes native authentication, profiles, posting and media upload, short videos, search, rooms, messaging, notifications, settings, safety controls and deep links. Recent-session feed caching and offline handling are implemented. It uses the existing Supabase production project; do not place a service role key in this app.

## Local build

Use JDK 21, Android SDK 36 and Gradle 8.13. The project supports both Windows and Unix; generate wrapper scripts with `gradle wrapper --gradle-version 8.13` if they are absent. Then run:

```text
./gradlew :app:assemblePreviewDebug :app:lintPreviewDebug
```

`app/google-services.json` must come from Firebase project `sautilink` and contain the exact Android package for the variant being built. The build is allowed without this file for source-level CI checks, but FCM is disabled. Keep the file out of Git; CI restores it from the existing `FIREBASE_GOOGLE_SERVICES_JSON_BASE64` repository secret.

For a signed Play bundle, set `SAUTILINK_KEYSTORE_PATH`, `SAUTILINK_KEYSTORE_PASSWORD`, `SAUTILINK_KEY_ALIAS` and `SAUTILINK_KEY_PASSWORD` in the build environment, then run `./gradlew :app:bundleProductionRelease`. The bundle is at `app/build/outputs/bundle/productionRelease/app-production-release.aab`. Never commit the keystore or passwords. The GitHub workflow restores the existing repository signing secrets only on `main` and verifies the signed bundle.

## Current verification

The preview build compiles and Android lint passes with zero errors. On Samsung SM-A057F (API 35), the production Home/Notifications screens opened, notification permission was granted, and token registration reported `Device alerts on`. Remote FCM delivery to this device, Android 26–27 media upload, broader compatibility/crash testing, Play data safety and store listing remain release gates. See the per-phase QA reports generated alongside the debug APK.

The launcher icon comes from the existing SautiLink brand asset; the old Capacitor Android workflow in the web repository is separate until the native release is approved.
