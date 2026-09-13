import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20260913023000_enable_fcm_server_delivery.sql', import.meta.url);
const functionPath = new URL('../supabase/functions/sautilink-push-dispatch/index.ts', import.meta.url);

const [migration, dispatcher] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(functionPath, 'utf8'),
]);

test('push delivery queue is private and covers social + message events', () => {
  assert.match(migration, /create table if not exists public\.push_delivery_queue/i);
  assert.match(migration, /revoke all on table public\.push_delivery_queue from public, anon, authenticated/i);
  assert.match(migration, /'follow', 'like', 'reply', 'mention', 'reshare'/);
  assert.match(migration, /tg_table_name = 'dm_messages'/);
  assert.match(migration, /push_delivery_social_notification_v1/);
  assert.match(migration, /push_delivery_dm_message_v1/);
});

test('database dispatch is asynchronous and retryable', () => {
  assert.match(migration, /create extension if not exists pg_net/i);
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /net\.http_post/i);
  assert.match(migration, /sautilink-push-retry-v1/);
  assert.match(migration, /attempt_count < 5/);
});

test('dispatcher reads Firebase credentials only from Supabase secrets', () => {
  assert.match(dispatcher, /FIREBASE_SERVICE_ACCOUNT_JSON_BASE64/);
  assert.match(dispatcher, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(dispatcher, /-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/);
});

test('dispatcher uses FCM HTTP v1 and safe Android routes', () => {
  assert.match(dispatcher, /https:\/\/fcm\.googleapis\.com\/v1\/projects\//);
  assert.match(dispatcher, /firebase\.messaging/);
  assert.match(dispatcher, /channel_id: "sautilink_updates"/);
  assert.match(dispatcher, /`\/post\/\$\{postId\}`/);
  assert.match(dispatcher, /`\/messages\/\$\{conversationId\}`/);
  assert.match(dispatcher, /sent you a message\./);
});
