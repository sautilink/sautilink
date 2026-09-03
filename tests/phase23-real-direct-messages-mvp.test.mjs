import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 23 activates live one-to-one Messages inside the accepted app shell', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const marker of [
    'data-member-view="messages"',
    'data-message-badge',
    'id="messages-surface"',
    'id="messages-inbox-list"',
    'id="message-thread"',
    'id="message-composer"',
    'id="profile-message-button"',
  ]) {
    assert.ok(html.includes(marker), `missing Phase 23 UI marker: ${marker}`);
  }

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 23, `app milestone regressed below Phase 23: ${phase}`);
  const cssVersion = Number(html.match(/app\.css\?v=([0-9]+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=([0-9]+)/)?.[1] || 0);
  assert.ok(cssVersion >= 23, `app CSS version regressed below Phase 23: ${cssVersion}`);
  assert.equal(jsVersion, cssVersion);
  assert.match(css, /\.messages-surface/);
  assert.match(css, /\.message-inbox-item/);
  assert.match(css, /\.dm-message/);
  assert.match(css, /@media \(max-width: 680px\)/);
});

test('Phase 23 database contract enforces participant privacy, block-aware sends and server-owned fields', async () => {
  const base = await read('supabase/migrations/20260901174500_enable_phase23_real_direct_messages_mvp.sql');
  const hardening = await read('supabase/migrations/20260901175000_harden_phase23_dm_server_owned_fields.sql');
  const inbox = await read('supabase/migrations/20260901175500_hide_empty_recipient_dm_conversations.sql');
  const stateHardening = await read('supabase/migrations/20260901180000_server_create_phase23_dm_states.sql');
  const sql = [base, hardening, inbox, stateHardening].join('\n');

  assert.match(sql, /force row level security/i);
  assert.match(sql, /dm_conversations_select_participant_phase23/i);
  assert.match(sql, /dm_messages_insert_participant_phase23/i);
  assert.match(sql, /social_blocks/i);
  assert.match(sql, /DM_RATE_LIMITED/i);
  assert.match(sql, /clock_timestamp\(\)/i);
  assert.match(sql, /grant insert \(member_one_id, member_two_id, created_by\)/i);
  assert.match(sql, /grant insert \(conversation_id, sender_id, body\)/i);
  assert.match(sql, /grant update \(deleted_at\)/i);
  assert.match(stateHardening, /revoke insert on table public\.dm_conversation_states from authenticated/i);
  assert.match(sql, /Message deleted\./i);
  assert.match(sql, /open_dm_conversation_phase23/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /dm_inbox_phase23/i);
  assert.match(sql, /latest\.id is not null or conversation\.created_by = auth\.uid\(\)/i);
  assert.match(sql, /new\.target_type = 'message'/i);
  assert.match(sql, /public\.dm_messages message/i);
});

test('Phase 23 browser source supports inbox, thread, unread, hide, block, report and soft delete without privileged keys', async () => {
  const source = await read('src/app.js');
  const router = await read('src/asset-router.js');
  const safety = await read('src/trust-safety-api.js');

  for (const marker of [
    'loadMessagesInbox',
    'loadMessageThread',
    'openDirectConversation',
    'sendDirectMessage',
    'deleteDirectMessage',
    'hideActiveConversation',
    'toggleMessageThreadBlock',
    'refreshMessageBadge',
    "rpc('dm_inbox_phase23')",
    "rpc('open_dm_conversation_phase23'",
    "from('dm_messages')",
    "from('dm_conversation_states')",
  ]) {
    assert.ok(source.includes(marker), `source missing Phase 23 marker: ${marker}`);
  }

  assert.match(source, /openReportDialog\('message'/);
  assert.match(safety, /REPORT_TARGETS = new Set\(\['profile', 'post', 'comment', 'message'\]\)/);
  assert.match(safety, /targetType === 'message' \? numericId/);
  assert.match(router, /MESSAGE_ROUTE/);
  assert.match(router, /\/app\\\/messages/);
  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SECRET/i);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('Phase 23 remains explicit about non-E2EE privacy and deferred advanced messaging', async () => {
  const html = await read('app/index.html');
  assert.match(html, /Private messages are not end-to-end encrypted/);
  assert.match(html, /Text only/);
  assert.doesNotMatch(html, /End-to-end encrypted|Group chat|Voice call|Video call|Disappearing message/);
});

test('Phase 23 rotates the service worker cache beyond Phase 22', async () => {
  const sw = await read('sw.js');
  const version = Number(sw.match(/sautilink-shell-v([0-9]+)/)?.[1] || 0);
  assert.ok(version >= 13, `service worker cache regressed below Phase 23: ${version}`);
});
