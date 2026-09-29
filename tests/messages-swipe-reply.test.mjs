import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformMessagesReplySource } from '../scripts/messages-reply-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('reply targets are constrained to an existing message in the same conversation', async () => {
  const migration = await read('supabase/migrations/20260929111500_enable_dm_message_replies.sql');
  assert.match(migration, /add column if not exists reply_to_message_id bigint/i);
  assert.match(migration, /target\.conversation_id = new\.conversation_id/i);
  assert.match(migration, /target\.deleted_at is null/i);
  assert.match(migration, /DM_REPLY_UNAVAILABLE/i);
  assert.match(migration, /revoke all on function private\.validate_dm_message_reply_phase36/i);
});

test('thread reads replies and send retains the paper-plane button contents', async () => {
  const transformed = transformMessagesReplySource('/repo/src/app.js', await read('src/app.js'));
  assert.match(transformed, /dm_messages_reply_to_message_id_fkey/);
  assert.match(transformed, /dataset\.replyDmMessage/);
  assert.match(transformed, /insertPayload\.reply_to_message_id = replyToMessageId/);
  assert.match(transformed, /window\.__sautilinkClearMessageReply\?\.\(\)/);
  const send = transformed.match(/async function sendDirectMessage\(\)[\s\S]*?async function deleteDirectMessage/)?.[0];
  assert.ok(send);
  assert.doesNotMatch(send, /submit\.textContent\s*=/);
  assert.match(send, /delete submit\.dataset\.sending/);
});

test('swipe-left reply can be cancelled, and visibility observation cannot recurse through its own preview', async () => {
  const ui = await read('src/messages-reply-ui.js');
  assert.match(ui, /gesture\.deltaX <= -MESSAGE_REPLY_SWIPE_TRIGGER/);
  assert.match(ui, /data-reply-dm-message|replyDmMessage/);
  assert.match(ui, /data-jump-to-dm-message|jumpToDmMessage/);
  assert.match(ui, /Cancel reply/);
  assert.match(ui, /if \(!preview\.hidden\) preview\.hidden = true/);
  assert.match(ui, /if \(author\?\.textContent\) author\.textContent = ''/);
  assert.match(ui, /visibilityObserver\.observe\(element, \{ attributes: true, attributeFilter: \['hidden'\] \}\)/);
  assert.doesNotMatch(ui, /observe\(messagesReplySurface,\s*\{[^}]*subtree:\s*true/s);
});

test('clearing reply twice never changes hidden state twice or observes its own preview', async () => {
  const observed = [];
  const ids = new Map();
  class Element {
    constructor() {
      this.dataset = {};
      this.children = [];
      this.listeners = {};
      this.classList = { contains: () => false, remove() {}, add() {} };
      this.hiddenWrites = 0;
      this._hidden = false;
      this.textContent = '';
    }
    get hidden() { return this._hidden; }
    set hidden(value) { this.hiddenWrites++; this._hidden = value; }
    append(...children) { this.children.push(...children); }
    prepend(child) { this.children.unshift(child); if (child.id) ids.set(child.id, child); }
    querySelector(selector) {
      const key = selector.match(/^\[data-([\w-]+)\]$/)?.[1];
      if (!key) return null;
      const dataKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return this.children.find((child) => dataKey in child.dataset)
        || this.children.flatMap((child) => child.children).find((child) => dataKey in child.dataset)
        || null;
    }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    setAttribute() {}
  }
  for (const id of ['messages-surface', 'message-thread', 'message-thread-feed', 'message-composer', 'message-body']) {
    ids.set(id, new Element());
  }
  const window = { addEventListener() {}, setTimeout() { return 1; }, clearTimeout() {} };
  const document = {
    getElementById: (id) => ids.get(id) || null,
    querySelector: () => null,
    createElement: () => new Element(),
    head: { append() {} },
  };
  class MutationObserver {
    observe(element, options) { observed.push({ element, options }); }
  }
  runInNewContext(await read('src/messages-reply-ui.js'), { document, window, Element, MutationObserver });
  const preview = ids.get('message-reply-preview');
  assert.ok(preview);
  assert.equal(preview.hiddenWrites, 1);
  window.__sautilinkClearMessageReply();
  assert.equal(preview.hiddenWrites, 1, 'already-hidden preview must not be written again');
  preview.hidden = false;
  window.__sautilinkClearMessageReply();
  window.__sautilinkClearMessageReply();
  assert.equal(preview.hiddenWrites, 3, 'only one clear may hide the visible preview');
  assert.ok(observed.every(({ options }) => !options.subtree));
  assert.ok(observed.every(({ element }) => element !== preview));
});

test('normal and production builds activate the reply UI and its scoped styling', async () => {
  const [appBuild, productionBuild, css] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
    read('app/assets/messages-reply.css'),
  ]);
  for (const source of [appBuild, productionBuild]) {
    assert.match(source, /transformMessagesReplySource/);
    assert.match(source, /messages-reply-ui\.js/);
  }
  assert.match(css, /\.messages-whatsapp-ui \.dm-message/);
  assert.match(css, /touch-action:\s*pan-y/);
  assert.doesNotMatch(css, /^body\s*\{/m);
});
