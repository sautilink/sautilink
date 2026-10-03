import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformMessagesReplySource } from '../scripts/messages-reply-source-transform.mjs';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const productionSource = transformMessagesReplySource('/repo/src/app.js', source);

test('latest messages are loaded in chronological display order and reply context survives production', async () => {
  const calls = [];
  const supabase = { from(table) {
    assert.equal(table, 'dm_messages');
    return {
      select() { return this; },
      eq(key) { assert.equal(key, 'conversation_id'); return this; },
      order(key, options) { calls.push([key, options.ascending]); return this; },
      limit(count) {
        assert.equal(count, 200);
        return { data: [{ id: 3 }, { id: 2 }, { id: 1 }], error: null };
      },
    };
  } };
  const helper = source.match(/async function fetchActiveConversationMessages\([\s\S]*?\n}\n\nfunction dmCalendarKey/)?.[0]
    .replace(/\n\nfunction dmCalendarKey$/, '');
  assert.ok(helper);
  const fetchMessages = runInNewContext(`${helper}\nfetchActiveConversationMessages`, { supabase });
  const result = await fetchMessages('conversation');
  assert.deepEqual(calls, [['sent_at', false], ['id', false]]);
  assert.deepEqual(Array.from(result, ({ id }) => id), [1, 2, 3]);
  assert.match(productionSource, /return hydrateDmReplyTargets\(conversationId, \(data \|\| \[\]\)\.reverse\(\)\)/);
  assert.match(productionSource, /messages = await hydrateDmReplyTargets\(conversation\.id, messages\)/);
});

test('notification route selects its message and older target is fetched within the same conversation', () => {
  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\('message'\)/);
  assert.match(source, /loadMessageThread\(messageRoute\.conversationId, messageRoute\.messageId\)/);
  assert.match(source, /fetchDmNotificationWindow\(conversation\.id, notificationMessageId\)/);
  assert.match(source, /\.eq\('conversation_id', conversationId\)\.eq\('id', messageId\)/);
  assert.match(source, /target\.classList\.add\('dm-notification-target'\)/);
  assert.doesNotMatch(source.match(/async function sendDirectMessage\([\s\S]*?async function deleteDirectMessage/)?.[0] || '', /showToast\('Message sent\.'\)/);
});

test('timeline groups messages by local day and displays a clock time', () => {
  assert.match(source, /dmDayLabel\(message\.sent_at\)/);
  assert.match(source, /day: 'numeric', month: 'short', year: 'numeric'/);
  assert.match(source, /hour: 'numeric', minute: '2-digit'/);
  assert.match(source, /return 'Today'/);
  assert.match(source, /return 'Yesterday'/);
  assert.match(productionSource, /renderDmTimeline\(feed, messages\)/);
});
