import fs from "node:fs";
import path from "node:path";

const versionPath = path.resolve("android-version.json");
const gradlePath = path.resolve("android/app/build.gradle");
const manifestPath = path.resolve("android/app/src/main/AndroidManifest.xml");

const version = JSON.parse(fs.readFileSync(versionPath, "utf8"));
const versionCode = Number(version.versionCode);
const versionName = String(version.versionName || "").trim();

if (!Number.isInteger(versionCode) || versionCode < 1) {
  throw new Error("android-version.json versionCode must be a positive integer");
}
if (!/^[0-9A-Za-z._-]+$/.test(versionName)) {
  throw new Error("android-version.json versionName contains unsupported characters");
}
if (!fs.existsSync(gradlePath)) {
  throw new Error(`Android Gradle file not found: ${gradlePath}`);
}
if (!fs.existsSync(manifestPath)) {
  throw new Error(`Android manifest not found: ${manifestPath}`);
}

const signingEnabled = process.env.SAUTILINK_SIGN_RELEASE === "true";
const requiredSigningEnv = [
  "SAUTILINK_KEYSTORE_PATH",
  "SAUTILINK_KEYSTORE_PASSWORD",
  "SAUTILINK_KEY_ALIAS",
  "SAUTILINK_KEY_PASSWORD",
];

if (signingEnabled) {
  for (const key of requiredSigningEnv) {
    if (!process.env[key]) throw new Error(`Missing signing environment variable: ${key}`);
  }
}

let gradle = fs.readFileSync(gradlePath, "utf8");
const marker = "// SAUTILINK_PHASE2_RELEASE_CONFIG";
if (gradle.includes(marker)) {
  throw new Error("SautiLink release configuration was already applied");
}

gradle += `\n\n${marker}\nandroid {\n    defaultConfig {\n        versionCode ${versionCode}\n        versionName \"${versionName}\"\n    }\n}\n`;

if (signingEnabled) {
  gradle += `\nandroid {\n    signingConfigs {\n        sautilinkRelease {\n            storeFile file(System.getenv(\"SAUTILINK_KEYSTORE_PATH\"))\n            storePassword System.getenv(\"SAUTILINK_KEYSTORE_PASSWORD\")\n            keyAlias System.getenv(\"SAUTILINK_KEY_ALIAS\")\n            keyPassword System.getenv(\"SAUTILINK_KEY_PASSWORD\")\n        }\n    }\n    buildTypes {\n        release {\n            signingConfig signingConfigs.sautilinkRelease\n        }\n    }\n}\n`;
}

fs.writeFileSync(gradlePath, gradle);

let manifest = fs.readFileSync(manifestPath, "utf8");
const audioPermissions = [
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
  '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
];
const missingAudioPermissions = audioPermissions.filter((permission) => !manifest.includes(permission));
if (missingAudioPermissions.length) {
  const applicationMarker = '<application';
  const applicationIndex = manifest.indexOf(applicationMarker);
  if (applicationIndex < 0) throw new Error("Android manifest application marker not found");
  const beforeApplication = manifest.slice(0, applicationIndex);
  const applicationAndAfter = manifest.slice(applicationIndex);
  manifest = `${beforeApplication}${missingAudioPermissions.join("\n")}\n\n    ${applicationAndAfter}`;
  fs.writeFileSync(manifestPath, manifest);
}

console.log(
  `Configured Android ${versionName} (${versionCode}); signing=${signingEnabled ? "enabled" : "disabled"}; microphone=enabled`,
);
