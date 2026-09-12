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

test('notification permission release increments Android package version', () => {
  const version = JSON.parse(read('android-version.json'));
  assert.equal(version.versionCode, 3);
  assert.equal(version.versionName, '1.0.0-beta.3');
});

test('Android workflow applies permission patch after Capacitor project generation', () => {
  const workflow = read('.github/workflows/android-apk.yml');
  const generateIndex = workflow.indexOf('name: Generate Android project');
  const configureIndex = workflow.indexOf('name: Configure Android version and signing');

  assert.ok(generateIndex >= 0, 'Android project generation step is missing');
  assert.ok(configureIndex > generateIndex, 'Android configuration must run after Capacitor project generation');
  assert.match(workflow, /node scripts\/configure-android-release\.mjs/);
});

test('permission foundation does not pretend FCM delivery is already configured', () => {
  const packageJson = read('package.json');
  const capacitorConfig = read('capacitor.config.json');

  assert.doesNotMatch(packageJson, /@capacitor\/push-notifications/);
  assert.doesNotMatch(capacitorConfig, /PushNotifications/);
});
