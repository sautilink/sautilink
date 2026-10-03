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

test('thread hydrates replies without a schema-cache-dependent embedded join and send retains its icon', async () => {
  const transformed = transformMessagesReplySource('/repo/src/app.js', await read('src/app.js'));
  assert.match(transformed, /async function hydrateDmReplyTargets/);
  assert.match(transformed, /return hydrateDmReplyTargets\(conversationId, \(data \|\| \[\]\)\.reverse\(\)\)/);
  assert.match(transformed, /await hydrateDmReplyTargets\(conversation\.id, messages\)/);
  assert.match(transformed, /\.eq\('conversation_id', conversationId\)\s*\.in\('id', missingIds\)/);
  assert.doesNotMatch(transformed, /reply:dm_messages!dm_messages_reply_to_message_id_fkey/);
  assert.match(transformed, /dataset\.replyDmMessage/);
  assert.match(transformed, /insertPayload\.reply_to_message_id = replyToMessageId/);
  assert.match(transformed, /window\.__sautilinkClearMessageReply\?\.\(\)/);
  const send = transformed.match(/async function sendDirectMessage\(\)[\s\S]*?async function deleteDirectMessage/)?.[0];
  assert.ok(send);
  assert.doesNotMatch(send, /submit\.textContent\s*=/);
  assert.match(send, /delete submit\.dataset\.sending/);
});

test('reply context resolves from the thread and fetches older originals only within its conversation', async () => {
  const transformed = transformMessagesReplySource('/repo/src/app.js', await read('src/app.js'));
  const helper = transformed.match(/async function hydrateDmReplyTargets\([\s\S]*?\n}\n\nfunction dmReplyPreview/)?.[0]
    .replace(/\n\nfunction dmReplyPreview$/, '');
  assert.ok(helper);
  const requests = [];
  const supabase = { from(table) {
    assert.equal(table, 'dm_messages');
    const request = { select() { return this; }, eq(key, value) {
      assert.equal(key, 'conversation_id');
      requests.push(value);
      return this;
    }, async in(key, ids) {
      assert.equal(key, 'id');
      assert.deepEqual(Array.from(ids), ['7']);
      return { data: [{ id: 7, body: 'Older message', sender_id: 'peer' }] };
    } };
    return request;
  } };
  const hydrate = runInNewContext(`${helper}\nhydrateDmReplyTargets`, { supabase });
  const messages = [
    { id: 8, body: 'Recent message', reply_to_message_id: 7 },
    { id: 9, body: 'Reply to recent', reply_to_message_id: 8 },
  ];
  const resolved = await hydrate('conversation-123', messages);
  assert.equal(resolved[0].reply.body, 'Older message');
  assert.equal(resolved[1].reply.body, 'Recent message');
  assert.deepEqual(requests, ['conversation-123']);
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
    addEventListener() {},
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

test('message actions open on hold while scrolling cancels the hold and swipe still replies', async () => {
  const source = await read('src/messages-reply-ui.js');
  const css = await read('app/assets/messages-reply.css');
  const helper = source.match(/function cancelMessageActionHold\([\s\S]*?\n}\n\nfunction handleReplyAction/)?.[0]
    .replace(/\n\nfunction handleReplyAction$/, '');
  assert.ok(helper);
  const timers = new Map();
  let nextTimer = 0;
  let replies = 0;
  class Element {
    constructor() {
      this.dataset = {};
      this.isConnected = true;
      this.classList = { contains: () => false, add() {} };
      this.style = { setProperty() {} };
    }
    closest() { return this; }
    querySelector() { return {}; }
    removeAttribute(name) { if (name === 'data-dm-actions-open') delete this.dataset.dmActionsOpen; }
  }
  const window = {
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  };
  const actions = runInNewContext(`
    let messageReplyGesture = null;
    let messageActionHoldTimer = 0;
    let messageActionsOpenCard = null;
    let messageActionsOpenedAt = 0;
    const MESSAGE_ACTION_HOLD_MS = 500;
    const MESSAGE_REPLY_SWIPE_TRIGGER = 52;
    const MESSAGE_REPLY_SWIPE_MAX = 76;
    const messagesReplyFeed = {};
    const messagesReplyThread = { hidden: false };
    const pointerTargetIsInteractive = () => false;
    const resetReplySwipe = () => {};
    const setMessageReply = () => { replies(); };
    ${helper}
    ({ startReplySwipe, moveReplySwipe, finishReplySwipe });
  `, { Element, window, replies: () => { replies++; }, Date });
  const first = new Element();
  const down = (target, pointerId) => ({ target, pointerId, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });

  actions.startReplySwipe(down(first, 1));
  assert.equal(first.dataset.dmActionsOpen, undefined);
  const hold = timers.get(nextTimer);
  timers.delete(nextTimer);
  hold();
  assert.equal(first.dataset.dmActionsOpen, 'true');
  actions.finishReplySwipe({ pointerId: 1 });
  assert.equal(replies, 0);

  const second = new Element();
  actions.startReplySwipe(down(second, 2));
  actions.moveReplySwipe({ pointerId: 2, clientX: 98, clientY: 120 });
  assert.equal(timers.size, 0, 'vertical scroll must cancel the hold');
  actions.finishReplySwipe({ pointerId: 2 });
  assert.equal(second.dataset.dmActionsOpen, undefined);

  actions.startReplySwipe(down(second, 3));
  actions.moveReplySwipe({ pointerId: 3, clientX: 42, clientY: 100, preventDefault() {} });
  actions.finishReplySwipe({ pointerId: 3 });
  assert.equal(replies, 1);
  assert.equal(first.dataset.dmActionsOpen, undefined);
  assert.match(css, /\.dm-message \.dm-message-action\s*\{\s*display: none;/);
  assert.match(css, /\[data-dm-actions-open="true"\] \.dm-message-action\s*\{\s*display: inline-flex;/);
  assert.match(source, /addEventListener\('contextmenu'/);
  assert.match(source, /addEventListener\('keydown'/);
});
