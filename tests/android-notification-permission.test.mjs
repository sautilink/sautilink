import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Android beta declares and requests notification permission safely', () => {
  const source = read('scripts/configure-android-release.mjs');

  assert.match(source, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(source, /Build\.VERSION_CODES\.TIRAMISU/);
  assert.match(source, /checkSelfPermission\(Manifest\.permission\.POST_NOTIFICATIONS\)/);
  assert.match(source, /requestPermissions\(/);
  assert.match(source, /notification_permission_requested_v1/);
  assert.match(source, /getBoolean\(NOTIFICATION_PERMISSION_REQUESTED, false\)/);
  assert.match(source, /putBoolean\(NOTIFICATION_PERMISSION_REQUESTED, true\)/);
});

test('Android notification channel is stable and narrowly scoped', () => {
  const source = read('scripts/configure-android-release.mjs');

  assert.match(source, /NOTIFICATION_CHANNEL_ID = "sautilink_updates"/);
  assert.match(source, /NotificationManager\.IMPORTANCE_DEFAULT/);
  assert.match(source, /Likes, replies, follows, mentions and important SautiLink updates\./);

  for (const sensitivePermission of [
    'android.permission.CAMERA',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.READ_CONTACTS',
    'android.permission.READ_SMS',
    'android.permission.READ_CALL_LOG',
  ]) {
    assert.doesNotMatch(source, new RegExp(sensitivePermission.replaceAll('.', '\\.')));
  }
});

test('existing microphone permissions remain intact', () => {
  const source = read('scripts/configure-android-release.mjs');
  assert.match(source, /android\.permission\.RECORD_AUDIO/);
  assert.match(source, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
});

test('OAuth session handoff fix advances the Android beta package version', () => {
  const version = JSON.parse(read('android-version.json'));
  assert.equal(version.versionCode, 8);
  assert.equal(version.versionName, '1.0.0-beta.8');
});

test('Android workflow applies permission patch after Capacitor project generation', () => {
  const workflow = read('.github/workflows/android-apk.yml');
  const generateIndex = workflow.indexOf('name: Generate Android project');
  const configureIndex = workflow.indexOf('name: Configure Android version and signing');

  assert.ok(generateIndex >= 0, 'Android project generation step is missing');
  assert.ok(configureIndex > generateIndex, 'Android configuration must run after Capacitor project generation');
  assert.match(workflow, /node scripts\/configure-android-release\.mjs/);
});

test('Android workflow makes the FCM plugin discoverable and verifies native registration', () => {
  const workflow = read('.github/workflows/android-apk.yml');
  const registerIndex = workflow.indexOf('name: Register push plugin for Capacitor discovery');
  const generateIndex = workflow.indexOf('name: Generate Android project');
  const verifyIndex = workflow.indexOf('name: Verify native push plugin registration');

  assert.ok(registerIndex >= 0, 'Capacitor push plugin discovery step is missing');
  assert.ok(registerIndex < generateIndex, 'Push plugin must be declared before Capacitor sync');
  assert.ok(verifyIndex > generateIndex, 'Native push plugin verification must run after Capacitor sync');
  assert.match(workflow, /@capacitor\/push-notifications/);
  assert.match(workflow, /capacitor\.plugins\.json/);
  assert.match(workflow, /PushNotificationsPlugin/);
});

test('browser package remains free of native-only push dependencies outside Android CI', () => {
  const packageJson = read('package.json');
  const capacitorConfig = read('capacitor.config.json');

  assert.doesNotMatch(packageJson, /@capacitor\/push-notifications/);
  assert.doesNotMatch(capacitorConfig, /PushNotifications/);
});
