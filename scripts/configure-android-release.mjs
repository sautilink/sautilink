import fs from "node:fs";
import path from "node:path";

const versionPath = path.resolve("android-version.json");
const gradlePath = path.resolve("android/app/build.gradle");
const manifestPath = path.resolve("android/app/src/main/AndroidManifest.xml");
const mainActivityPath = path.resolve("android/app/src/main/java/com/sautilink/app/MainActivity.java");

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
  throw new Error(`Android manifest file not found: ${manifestPath}`);
}
if (!fs.existsSync(mainActivityPath)) {
  throw new Error(`Android MainActivity not found: ${mainActivityPath}`);
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
const nativePermissions = [
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
  '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
];
const missingNativePermissions = nativePermissions.filter((permission) => !manifest.includes(permission));
if (missingNativePermissions.length) {
  const applicationMarker = '<application';
  const applicationIndex = manifest.indexOf(applicationMarker);
  if (applicationIndex < 0) throw new Error("Android manifest application marker not found");
  const beforeApplication = manifest.slice(0, applicationIndex);
  const applicationAndAfter = manifest.slice(applicationIndex);
  manifest = `${beforeApplication}${missingNativePermissions.join("\n")}\n\n    ${applicationAndAfter}`;
}

const appLinkMarker = 'android:autoVerify="true"';
if (!manifest.includes(appLinkMarker)) {
  const activityClose = '</activity>';
  if (!manifest.includes(activityClose)) {
    throw new Error("Generated Android activity marker not found; refusing to patch App Links unsafely");
  }

  const appLinkFilter = `        <!-- SAUTILINK_ANDROID_APP_LINKS -->\n        <intent-filter android:autoVerify="true">\n            <action android:name="android.intent.action.VIEW" />\n            <category android:name="android.intent.category.DEFAULT" />\n            <category android:name="android.intent.category.BROWSABLE" />\n            <data\n                android:scheme="https"\n                android:host="sautilink.com"\n                android:pathPrefix="/home" />\n            <data\n                android:scheme="https"\n                android:host="www.sautilink.com"\n                android:pathPrefix="/home" />\n        </intent-filter>\n`;
  manifest = manifest.replace(activityClose, `${appLinkFilter}        ${activityClose}`);
}

fs.writeFileSync(manifestPath, manifest);

const mainActivityMarker = "// SAUTILINK_NOTIFICATION_PERMISSION";
const oauthAppLinkMarker = "// SAUTILINK_OAUTH_APP_LINK";
let mainActivity = fs.readFileSync(mainActivityPath, "utf8");
if (!mainActivity.includes(mainActivityMarker)) {
  const expectedClass = "public class MainActivity extends BridgeActivity {}";
  if (!mainActivity.includes(expectedClass)) {
    throw new Error("Generated MainActivity shape changed; refusing to patch notification permission unsafely");
  }

  mainActivity = mainActivity
    .replace(
      "import com.getcapacitor.BridgeActivity;",
      `import android.Manifest;\nimport android.app.NotificationChannel;\nimport android.app.NotificationManager;\nimport android.content.Context;\nimport android.content.Intent;\nimport android.content.SharedPreferences;\nimport android.content.pm.PackageManager;\nimport android.net.Uri;\nimport android.os.Build;\nimport android.os.Bundle;\n\nimport com.getcapacitor.BridgeActivity;`,
    )
    .replace(
      expectedClass,
      `public class MainActivity extends BridgeActivity {\n    ${mainActivityMarker}\n    ${oauthAppLinkMarker}\n    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 4102;\n    private static final String NOTIFICATION_CHANNEL_ID = "sautilink_updates";\n    private static final String PERMISSION_PREFS = "sautilink_native_permissions";\n    private static final String NOTIFICATION_PERMISSION_REQUESTED = "notification_permission_requested_v1";\n    private static final String APP_LINK_SCHEME = "https";\n    private static final String APP_LINK_HOST = "sautilink.com";\n    private static final String APP_LINK_WWW_HOST = "www.sautilink.com";\n    private static final String OAUTH_CALLBACK_PATH = "/home";\n\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        ensureNotificationChannel();\n        maybeRequestNotificationPermission();\n        handleOAuthAppLink(getIntent());\n    }\n\n    @Override\n    protected void onNewIntent(Intent intent) {\n        super.onNewIntent(intent);\n        setIntent(intent);\n        handleOAuthAppLink(intent);\n    }\n\n    private void handleOAuthAppLink(Intent intent) {\n        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;\n        Uri uri = intent.getData();\n        if (!isTrustedOAuthAppLink(uri)) return;\n        if (getBridge() == null || getBridge().getWebView() == null) return;\n\n        final String target = uri.toString();\n        getBridge().getWebView().post(() -> {\n            if (getBridge() != null && getBridge().getWebView() != null) {\n                getBridge().getWebView().loadUrl(target);\n            }\n        });\n    }\n\n    private boolean isTrustedOAuthAppLink(Uri uri) {\n        if (uri == null) return false;\n        if (!APP_LINK_SCHEME.equalsIgnoreCase(uri.getScheme())) return false;\n\n        String host = uri.getHost();\n        if (!APP_LINK_HOST.equalsIgnoreCase(host) && !APP_LINK_WWW_HOST.equalsIgnoreCase(host)) return false;\n\n        String callbackPath = uri.getPath();\n        if (!OAUTH_CALLBACK_PATH.equals(callbackPath) && !"/home/".equals(callbackPath)) return false;\n\n        return uri.getQueryParameter("code") != null\n            || uri.getQueryParameter("error") != null\n            || uri.getQueryParameter("error_code") != null\n            || hasFragmentParameter(uri, "access_token")\n            || hasFragmentParameter(uri, "error")\n            || hasFragmentParameter(uri, "error_code");\n    }\n\n    private boolean hasFragmentParameter(Uri uri, String expectedName) {\n        String fragment = uri.getEncodedFragment();\n        if (fragment == null || fragment.isEmpty()) return false;\n\n        for (String pair : fragment.split("&")) {\n            int separator = pair.indexOf('=');\n            String encodedName = separator >= 0 ? pair.substring(0, separator) : pair;\n            if (expectedName.equals(Uri.decode(encodedName))) return true;\n        }\n        return false;\n    }\n\n    private void ensureNotificationChannel() {\n        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;\n\n        NotificationManager manager = getSystemService(NotificationManager.class);\n        if (manager == null || manager.getNotificationChannel(NOTIFICATION_CHANNEL_ID) != null) return;\n\n        NotificationChannel channel = new NotificationChannel(\n            NOTIFICATION_CHANNEL_ID,\n            "SautiLink notifications",\n            NotificationManager.IMPORTANCE_DEFAULT\n        );\n        channel.setDescription(\"Likes, replies, follows, mentions and important SautiLink updates.\");\n        manager.createNotificationChannel(channel);\n    }\n\n    private void maybeRequestNotificationPermission() {\n        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;\n        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;\n\n        SharedPreferences preferences = getSharedPreferences(PERMISSION_PREFS, Context.MODE_PRIVATE);\n        if (preferences.getBoolean(NOTIFICATION_PERMISSION_REQUESTED, false)) return;\n\n        preferences.edit().putBoolean(NOTIFICATION_PERMISSION_REQUESTED, true).apply();\n        requestPermissions(\n            new String[] { Manifest.permission.POST_NOTIFICATIONS },\n            NOTIFICATION_PERMISSION_REQUEST_CODE\n        );\n    }\n}`,
    );

  fs.writeFileSync(mainActivityPath, mainActivity);
}

const configuredManifest = fs.readFileSync(manifestPath, "utf8");
for (const permission of nativePermissions) {
  if (!configuredManifest.includes(permission)) {
    throw new Error(`Android permission configuration failed: ${permission}`);
  }
}
for (const appLinkRequirement of [
  'android:autoVerify="true"',
  'android:scheme="https"',
  'android:host="sautilink.com"',
  'android:host="www.sautilink.com"',
  'android:pathPrefix="/home"',
]) {
  if (!configuredManifest.includes(appLinkRequirement)) {
    throw new Error(`Android App Links configuration failed: ${appLinkRequirement}`);
  }
}

const configuredMainActivity = fs.readFileSync(mainActivityPath, "utf8");
for (const requiredMarker of [
  mainActivityMarker,
  oauthAppLinkMarker,
  'Manifest.permission.POST_NOTIFICATIONS',
  'Build.VERSION_CODES.TIRAMISU',
  'NOTIFICATION_CHANNEL_ID = "sautilink_updates"',
  'notification_permission_requested_v1',
  'Intent.ACTION_VIEW',
  'APP_LINK_HOST = "sautilink.com"',
  'APP_LINK_WWW_HOST = "www.sautilink.com"',
  'OAUTH_CALLBACK_PATH = "/home"',
  'handleOAuthAppLink(getIntent())',
  'getBridge().getWebView().loadUrl(target)',
]) {
  if (!configuredMainActivity.includes(requiredMarker)) {
    throw new Error(`Android native configuration failed: ${requiredMarker}`);
  }
}

console.log(
  `Configured Android ${versionName} (${versionCode}); signing=${signingEnabled ? "enabled" : "disabled"}; microphone=enabled; notifications=permission-ready; app-links=enabled`,
);
