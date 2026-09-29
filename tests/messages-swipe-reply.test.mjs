import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformMessagesReplySource } from '../scripts/messages-reply-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('direct message replies are persisted only inside the same conversation', async () => {
  const migration = await read('supabase/migrations/20260929111500_enable_dm_message_replies.sql');
  assert.match(migration, /add column if not exists reply_to_message_id bigint/i);
  assert.match(migration, /dm_messages_reply_to_message_id_fkey/i);
  assert.match(migration, /references public\.dm_messages\(id\)/i);
  assert.match(migration, /target\.conversation_id = new\.conversation_id/i);
  assert.match(migration, /target\.deleted_at is null/i);
  assert.match(migration, /DM_REPLY_UNAVAILABLE/i);
  assert.match(migration, /grant select \(reply_to_message_id\)/i);
  assert.match(migration, /grant insert \(reply_to_message_id\)/i);
});

test('Messages thread hydrates reply context and text sends preserve the paper-plane icon', async () => {
  const source = await read('src/app.js');
  const transformed = transformMessagesReplySource('/repo/src/app.js', source);
  assert.match(transformed, /reply_to_message_id/);
  assert.match(transformed, /dm_messages_reply_to_message_id_fkey/);
  assert.match(transformed, /data\.replyDmMessage|dataset\.replyDmMessage/);
  assert.match(transformed, /insertPayload\.reply_to_message_id = replyToMessageId/);
  assert.match(transformed, /window\.__sautilinkClearMessageReply\?\.\(\)/);

  const sendBlock = transformed.match(/async function sendDirectMessage\(\)[\s\S]*?async function deleteDirectMessage/)?.[0] || '';
  assert.ok(sendBlock, 'transformed direct-message send block missing');
  assert.doesNotMatch(sendBlock, /submit\.textContent\s*=/);
  assert.match(sendBlock, /submit\.dataset\.sending = 'true'/);
  assert.match(sendBlock, /submit\.setAttribute\('aria-label', 'Sending message'\)/);
});

test('Messages reply UI uses left swipe, cancel, accessible reply action and jump-to-original', async () => {
  const ui = await read('src/messages-reply-ui.js');
  assert.match(ui, /MESSAGE_REPLY_SWIPE_TRIGGER = 52/);
  assert.match(ui, /gesture\.deltaX <= -MESSAGE_REPLY_SWIPE_TRIGGER/);
  assert.match(ui, /if \(dx >= 0/);
  assert.match(ui, /data-reply-dm-message|replyDmMessage/);
  assert.match(ui, /data-jump-to-dm-message|jumpToDmMessage/);
  assert.match(ui, /message-reply-preview/);
  assert.match(ui, /Cancel reply/);
  assert.match(ui, /touch|pointer/i);
});

test('Messages reply styling is feature-scoped and keeps vertical scrolling available during swipe', async () => {
  const css = await read('app/assets/messages-reply.css');
  assert.match(css, /\.messages-whatsapp-ui \.dm-message/);
  assert.match(css, /touch-action:\s*pan-y/);
  assert.match(css, /--dm-reply-swipe-x/);
  assert.match(css, /\.message-reply-preview/);
  assert.match(css, /\.dm-reply-context/);
  assert.doesNotMatch(css, /^body\s*\{/m);
  assert.doesNotMatch(css, /^\.dm-message\s*\{/m);
});

test('normal and production builds include the Messages reply transform and UI', async () => {
  const [appBuild, productionBuild] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);
  for (const source of [appBuild, productionBuild]) {
    assert.match(source, /transformMessagesReplySource/);
    assert.match(source, /messages-reply-ui\.js/);
  }
});
