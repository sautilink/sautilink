import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('PWA manifest supports routed launches and app shortcuts', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.launch_handler.client_mode, 'navigate-existing');
  assert.deepEqual(manifest.shortcuts.map(({ url }) => url), ['/home', '/messages', '/notifications']);
});

test('service worker receives push and safely opens supported links', async () => {
  const worker = await read('sw.js');
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /registration\.showNotification/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /clients\.matchAll/);
  assert.match(worker, /clients\.openWindow/);
  assert.match(worker, /safeNotificationRoute/);
  assert.match(worker, /sautilink-shell-v75/);
});

test('device notification permission is user initiated and persists through narrow RPCs', async () => {
  const source = await read('src/web-push-notifications.js');
  const html = await read('app/index.html');
  assert.match(html, /id="settings-web-push-action"/);
  assert.match(source, /button\?\.addEventListener\('click'/);
  assert.match(source, /Notification\.requestPermission\(\)/);
  assert.match(source, /pushManager\.subscribe/);
  assert.match(source, /register_web_push_subscription_v1/);
  assert.match(source, /unregister_web_push_subscription_v1/);
  assert.match(source, /__sautilinkPushCleanupHooks/);
  assert.match(source, /__sautilinkSetAppBadge/);
});

test('installed PWA offers a respectful notification opt-in after sign-in', async () => {
  const source = await read('src/web-push-notifications.js');
  const css = await read('app/assets/app.css');
  assert.match(source, /matchMedia\?\.\('\(display-mode: standalone\)'\)/);
  assert.match(source, /navigator\?\.standalone === true/);
  assert.match(source, /session\?\.user\?\.id/);
  assert.match(source, /WEB_PUSH_PROMPT_COOLDOWN_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /data-web-push-prompt-later/);
  assert.match(source, /Turn on notifications/);
  assert.match(source, /addEventListener\('click', async \(event\) =>/);
  assert.match(css, /\.sautilink-web-push-prompt/);
});

test('already granted permission repairs a missing subscription without reopening permission UI', async () => {
  const source = await read('src/web-push-notifications.js');
  assert.match(source, /Notification\.permission === 'granted'\) return enableWebPush\(\{ allowPermissionPrompt: false \}\)/);
  assert.match(source, /if \(Notification\.permission !== 'granted' && !allowPermissionPrompt\)/);
});

test('web push subscriptions are private and VAPID secret access is server only', async () => {
  const migration = await read('supabase/migrations/20260923184238_enable_pwa_web_push.sql');
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /web_push_subscriptions_no_direct_client_access/i);
  assert.match(migration, /revoke all on table public\.web_push_subscriptions from public, anon, authenticated/i);
  assert.match(migration, /security definer/gi);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /grant execute on function public\.get_web_push_vapid_private_key_server_v1\(\) to service_role/i);
});

test('push dispatcher delivers through Android FCM and standards Web Push', async () => {
  const dispatcher = await read('supabase/functions/sautilink-push-dispatch/index.ts');
  assert.match(dispatcher, /@block65\/webcrypto-web-push/);
  assert.match(dispatcher, /sendFcm/);
  assert.match(dispatcher, /sendWebPush/);
  assert.match(dispatcher, /WEB_PUSH_ENDPOINT_HOSTS/);
  assert.match(dispatcher, /web_push_subscriptions/);
  assert.match(dispatcher, /status === 404 \|\| result\.status === 410/);
});
