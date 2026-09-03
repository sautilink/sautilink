import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 34 uses private participant-scoped Realtime authorization', async () => {
  const migration = await read('supabase/migrations/20260903002000_enable_phase34_advanced_realtime_messaging.sql');

  assert.match(migration, /on realtime\.messages[\s\S]*for select[\s\S]*to authenticated/i);
  assert.match(migration, /on realtime\.messages[\s\S]*for insert[\s\S]*to authenticated/i);
  assert.match(migration, /dm-user:/);
  assert.match(migration, /'dm:' \|\| conversation\.id::text/);
  assert.match(migration, /activity_status = true/);
  assert.match(migration, /public\.social_blocks/);
  assert.match(migration, /realtime\.send\(/);
  assert.match(migration, /'message_changed'/);
  assert.match(migration, /'conversation_state_changed'/);
  assert.match(migration, /'read_state_changed'/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /revoke all on function private\.broadcast_dm_message_phase34\(\) from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /alter\s+table\s+realtime\.messages/i);
  assert.doesNotMatch(migration, /message.*body.*realtime\.send/i);
});

test('Phase 34 browser keeps persistent messages behind RLS and uses private channels for transient state', async () => {
  const source = await read('src/app.js');

  for (const marker of [
    'ensureDmInboxRealtime',
    'startDmConversationRealtime',
    'stopDmConversationRealtime',
    'syncActiveMessageThreadRealtime',
    'broadcastDmTyping',
    'syncDmPresenceState',
    "config: { private: true",
    "event: 'message_changed'",
    "event: 'read_state_changed'",
    "event: 'typing'",
    "event: 'sync'",
    'activity_status',
    'supabase.realtime.setAuth()',
    'supabase.removeChannel',
  ]) assert.ok(source.includes(marker), `missing Phase 34 source marker: ${marker}`);

  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SECRET/i);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('Phase 34 adds restrained live activity indicators without changing the DM privacy statement', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  assert.match(html, /id="message-thread-activity"/);
  assert.match(html, /id="message-typing-status"/);
  assert.match(html, /Private messages are not end-to-end encrypted/);
  assert.match(css, /\.message-thread-activity/);
  assert.match(css, /\.message-typing-status/);
  assert.doesNotMatch(html, /End-to-end encrypted|Group chat|Voice call|Video call/);
});

test('Phase 34 rotates the service worker cache beyond Phase 33', async () => {
  const sw = await read('sw.js');
  const version = Number(sw.match(/sautilink-shell-v([0-9]+)/)?.[1] || 0);
  assert.ok(version >= 23, `service worker cache regressed below Phase 34: ${version}`);
});
