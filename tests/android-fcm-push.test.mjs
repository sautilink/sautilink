import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformAndroidPushSource } from '../scripts/android-push-source-transform.mjs';

const pushSource = fs.readFileSync(new URL('../src/android-push-notifications.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260913011500_enable_android_push_devices.sql', import.meta.url), 'utf8');
const buildApp = fs.readFileSync(new URL('../scripts/build-app.mjs', import.meta.url), 'utf8');
const buildProduction = fs.readFileSync(new URL('../scripts/build-production-release.mjs', import.meta.url), 'utf8');

test('Android push source registers FCM only on native Android after permission', () => {
  assert.match(pushSource, /registerPlugin\('PushNotifications'\)/);
  assert.match(pushSource, /checkPermissions\(\)/);
  assert.match(pushSource, /permission\?\.receive !== 'granted'/);
  assert.match(pushSource, /plugin\.register\(\)/);
  assert.match(pushSource, /register_push_device_token_v1/);
  assert.match(pushSource, /unregister_push_device_token_v1/);
  assert.match(pushSource, /pushNotificationActionPerformed/);
  assert.match(pushSource, /sautilink_updates/);
});

test('Push device registry is hidden behind authenticated RPCs', () => {
  assert.match(migration, /alter table public\.push_device_tokens force row level security/i);
  assert.match(migration, /revoke all on table public\.push_device_tokens from public, anon, authenticated/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /current_uid uuid := auth\.uid\(\)/i);
  assert.match(migration, /grant execute on function public\.register_push_device_token_v1\(uuid, text\)\s+to authenticated/i);
  assert.match(migration, /grant execute on function public\.unregister_push_device_token_v1\(uuid\)\s+to authenticated/i);
});

test('Browser and production builds include the Android push source', () => {
  for (const source of [buildApp, buildProduction]) {
    assert.match(source, /transformAndroidPushSource/);
    assert.match(source, /android-push-notifications\.js/);
  }
});

test('Android push transform exposes the narrow Supabase bridge and cleans up before logout', () => {
  const input = `
const supabase = createClient('url', 'key');
const byId = (id) => document.getElementById(id);
async function signOut() {
  const { error } = await supabase.auth.signOut();
  return error;
}
`;
  const output = transformAndroidPushSource('/repo/src/app.js', input);
  assert.match(output, /__sautilinkPushBridge/);
  assert.match(output, /supabase\.rpc\(name, args\)/);
  assert.match(output, /__sautilinkPushCleanupHooks/);
  assert.ok(output.indexOf('__sautilinkPushCleanupHooks') < output.indexOf('supabase.auth.signOut'));
});
