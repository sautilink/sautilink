# SautiLink Android Phase 2 signing

This phase keeps Android release signing material out of the repository and reads it only from GitHub Actions secrets.

Required repository secrets:

- `ANDROID_RELEASE_KEYSTORE_BASE64`
- `ANDROID_RELEASE_STORE_PASSWORD`
- `ANDROID_RELEASE_KEY_ALIAS`
- `ANDROID_RELEASE_KEY_PASSWORD`

The workflow always builds a debug test APK for CI. A signed release APK and AAB are built and published only when all four secrets are present on `main`.

The permanent keystore must be backed up securely. Losing it would prevent future direct-install APK updates from using the same signing identity.

Version metadata lives in `android-version.json`. Increment `versionCode` for every distributed Android release and update `versionName` for the human-readable release version.

The launcher asset pipeline keeps the complete SautiLink logo inside Android's adaptive-icon safe zone to prevent the logo from being cropped by launcher masks.
