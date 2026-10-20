import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { disposeDmTimeline, reconcileDmTimeline } from '../src/messages-timeline-ui.js';

// A small layout-aware DOM harness. Explicit heights let these tests exercise reader
// anchoring as well as node identity without a new runtime/browser dependency.
function timelineHarness({ resizeObserver = true } = {}) {
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.nodes = new Set(); observers.push(this); }
    observe(node) { assert.ok(node); this.nodes.add(node); }
    unobserve(node) { assert.ok(node); this.nodes.delete(node); }
    disconnect() { this.nodes.clear(); this.disconnected = true; }
    resize() { if (!this.disconnected) this.callback(); }
  }
  const document = { defaultView: { ResizeObserver: resizeObserver ? Observer : undefined }, activeElement: null };
  class Node {
    constructor(tag = 'div') {
      this.tag = tag;
      this.children = [];
      this.parentNode = null;
      this.ownerDocument = document;
      this.style = { overflowAnchor: 'auto' };
      this.dataset = {};
      this.className = '';
      this.textContent = '';
      this.height = 0;
      this.listeners = new Map();
      this.mutations = 0;
      this._scrollTop = 0;
    }
    get isConnected() { return this === feed || Boolean(this.parentNode?.isConnected); }
    get scrollHeight() { return this.children.reduce((sum, child) => sum + child.layoutHeight, 0); }
    get layoutHeight() { return this.className === 'dm-day-separator' ? 24 : this.height; }
    get scrollTop() { return this._scrollTop; }
    set scrollTop(value) { this._scrollTop = Math.max(0, Math.min(value, this.scrollHeight - (this.clientHeight || 0))); }
    getBoundingClientRect() {
      const top = this.parentNode
        ? this.parentNode.getBoundingClientRect().top - this.parentNode.scrollTop
          + this.parentNode.children.slice(0, this.parentNode.children.indexOf(this))
            .reduce((sum, child) => sum + child.layoutHeight, 0)
        : 0;
      return { top, bottom: top + (this.clientHeight || this.layoutHeight) };
    }
    insertBefore(node, reference) {
      if (node === reference) return node;
      node.remove();
      const index = reference ? this.children.indexOf(reference) : this.children.length;
      assert.notEqual(index, -1);
      this.children.splice(index, 0, node);
      node.parentNode = this;
      this.mutations += 1;
      return node;
    }
    append(...nodes) { nodes.forEach((node) => this.insertBefore(node, null)); }
    remove() {
      if (!this.parentNode) return;
      const parent = this.parentNode;
      parent.children.splice(parent.children.indexOf(this), 1);
      parent.mutations += 1;
      this.parentNode = null;
      if (document.activeElement === this) document.activeElement = null;
    }
    querySelector(selector) {
      if (selector === '.dm-message-meta time') {
        return this.children.find((node) => node.className === 'dm-message-meta')?.children.find((node) => node.tag === 'time') || null;
      }
      const className = selector.slice(1);
      return this.children.find((node) => node.className.split(' ').includes(className)) || null;
    }
    addEventListener(type, callback) {
      const listeners = this.listeners.get(type) || new Set();
      listeners.add(callback);
      this.listeners.set(type, listeners);
    }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    dispatch(type) { this.listeners.get(type)?.forEach((callback) => callback()); }
  }
  document.createElement = (tag) => new Node(tag);
  const feed = new Node();
  feed.clientHeight = 250;
  let renders = 0;
  const renderMessage = (message) => {
    renders += 1;
    const row = new Node('article');
    row.height = message.height || 100;
    row.className = 'dm-message';
    row.dataset.messageId = String(message.id);
    row.textContent = message.deleted_at ? 'Message deleted.' : message.body;
    row.replyBody = message.reply?.body;
    const meta = new Node('span');
    meta.className = 'dm-message-meta';
    meta.append(new Node('time'));
    row.append(meta);
    return row;
  };
  const options = {
    renderMessage,
    dayKey: (value) => value.split('T')[0],
    dayLabel: (value) => value.split('T')[0],
    formatTime: (value) => value.split('T')[1],
  };
  const reconcile = (messages, overrides = {}) => reconcileDmTimeline(feed, messages, { ...options, ...overrides });
  const row = (id) => feed.children.find((node) => node.dataset.messageId === String(id));
  const resize = () => resizeObserver ? observers.forEach((observer) => observer.resize()) : feed.dispatch('load');
  return { feed, document, Node, reconcile, row, resize, observers, get renders() { return renders; } };
}

const message = (id, updates = {}) => ({
  id, sender_id: 'peer', body: `Message ${id}`, message_kind: 'text', sent_at: '2026-10-20T10:00', ...updates,
});
const list = (count) => Array.from({ length: count }, (_, index) => message(index + 1));

test('identical snapshots keep hydrated media, focused controls, read receipts and day DOM untouched', () => {
  const h = timelineHarness();
  const messages = list(5);
  h.reconcile(messages);
  const first = h.row(1);
  const separator = h.feed.children[0];
  const audio = new h.Node('audio');
  audio.currentTime = 19;
  audio.paused = false;
  first.append(audio);
  const receipt = new h.Node();
  receipt.className = 'dm-read-receipt';
  first.querySelector('.dm-message-meta time').parentNode.append(receipt);
  h.document.activeElement = audio;
  const mutations = h.feed.mutations;

  h.reconcile(messages.map((item) => ({ ...item })));

  assert.equal(h.renders, 5);
  assert.equal(h.row(1), first);
  assert.equal(h.feed.children[0], separator);
  assert.equal(h.feed.mutations, mutations, 'unchanged rows must never detach or move');
  assert.equal(h.document.activeElement, audio);
  assert.equal(audio.currentTime, 19);
  assert.equal(audio.paused, false);
  assert.equal(receipt.isConnected, true);
});

test('edits, deletion, reply-source edits and profile context update only affected rows', () => {
  const h = timelineHarness();
  const messages = [message(1), message(2), message(3, { reply_to_message_id: 1, reply: message(1) })];
  h.reconcile(messages);
  const untouched = h.row(2);
  const original = h.row(1);
  const oldReply = h.row(3);
  const changed = [
    message(1, { body: 'Edited', edited_at: '2026-10-20T11:00' }),
    messages[1],
    { ...messages[2], reply: message(1, { body: 'Edited' }) },
  ];
  h.reconcile(changed);
  assert.notEqual(h.row(1), original);
  assert.notEqual(h.row(3), oldReply);
  assert.equal(h.row(3).replyBody, 'Edited');
  assert.equal(h.row(2), untouched);
  assert.equal(h.renders, 5);

  h.reconcile([message(1, { deleted_at: '2026-10-20T12:00' }), changed[2]]);
  assert.equal(h.row(1).textContent, 'Message deleted.');
  assert.equal(h.row(2), undefined, 'genuinely missing rows must be removed');
  const replyBeforeProfile = h.row(3);
  h.reconcile([message(1, { deleted_at: '2026-10-20T12:00' }), changed[2]], { contextKey: 'Updated peer name' });
  assert.notEqual(h.row(3), replyBeforeProfile);
});

test('an in-progress edit survives realtime changes until closed; server deletion overrides it', () => {
  const h = timelineHarness();
  h.reconcile([message(1)]);
  const card = h.row(1);
  const editor = new h.Node('form');
  editor.className = 'dm-message-edit-form';
  editor.value = 'Unsent edit';
  card.append(editor);
  h.document.activeElement = editor;
  const edited = message(1, { body: 'Remote edit', edited_at: '2026-10-20T11:00' });
  h.reconcile([edited, message(2)]);
  assert.equal(h.row(1), card);
  assert.equal(h.document.activeElement, editor);
  assert.equal(editor.value, 'Unsent edit');
  editor.remove();
  h.reconcile([edited, message(2)]);
  assert.notEqual(h.row(1), card, 'deferred content must be retried after edit ends');
  const secondEditor = new h.Node('form');
  secondEditor.className = 'dm-message-edit-form';
  h.row(1).append(secondEditor);
  h.reconcile([{ ...edited, deleted_at: '2026-10-20T12:00' }, message(2)]);
  assert.equal(secondEditor.isConnected, false);
  assert.equal(h.row(1).textContent, 'Message deleted.');
});

test('reader anchor survives prepending, removing earlier rows and arrival of new messages', () => {
  const h = timelineHarness();
  const messages = list(10);
  h.reconcile(messages);
  h.feed.scrollTop = 374;
  h.feed.dispatch('scroll');
  const anchor = h.row(4);
  const anchorTop = anchor.getBoundingClientRect().top;

  h.reconcile([message(0), ...messages, message(11)]);
  assert.equal(h.row(4), anchor);
  assert.equal(anchor.getBoundingClientRect().top, anchorTop);
  assert.equal(h.feed.scrollTop, 474);
  h.reconcile([...messages.slice(1), message(11)]);
  assert.equal(anchor.getBoundingClientRect().top, anchorTop);
  assert.equal(h.feed.scrollTop, 274);
  assert.notEqual(h.feed.scrollTop, h.feed.scrollHeight - h.feed.clientHeight);
});

for (const resizeObserver of [true, false]) {
  test(`new messages and delayed media follow the end only while the reader stays there (${resizeObserver ? 'ResizeObserver' : 'load fallback'})`, () => {
    const h = timelineHarness({ resizeObserver });
    const messages = list(10);
    h.reconcile(messages);
    assert.equal(h.feed.scrollTop, h.feed.scrollHeight - h.feed.clientHeight);
    h.reconcile([...messages, message(11)]);
    assert.equal(h.feed.scrollTop, h.feed.scrollHeight - h.feed.clientHeight);
    h.row(11).height += 200;
    h.resize();
    assert.equal(h.feed.scrollTop, h.feed.scrollHeight - h.feed.clientHeight);

    h.feed.scrollTop = 374;
    h.feed.dispatch('scroll');
    const anchor = h.row(4);
    const offset = anchor.getBoundingClientRect().top;
    h.row(1).height += 180;
    h.resize();
    assert.equal(anchor.getBoundingClientRect().top, offset);
    assert.equal(h.feed.scrollTop, 554);
    assert.notEqual(h.feed.scrollTop, h.feed.scrollHeight - h.feed.clientHeight);
  });
}

test('external notification jump before its scroll event is respected by delayed hydration', () => {
  const h = timelineHarness();
  h.reconcile(list(10));
  h.feed.scrollTop = 250;
  h.resize();
  assert.equal(h.feed.scrollTop, 250);
  h.row(1).height += 100;
  h.resize();
  assert.equal(h.feed.scrollTop, 350);
});

test('feed resize holds its end or its reading anchor without losing the reader', () => {
  const h = timelineHarness();
  h.reconcile(list(10));
  h.feed.clientHeight = 180;
  h.resize();
  assert.equal(h.feed.scrollTop, h.feed.scrollHeight - 180);
  h.feed.scrollTop = 350;
  h.feed.dispatch('scroll');
  const before = h.row(4).getBoundingClientRect().top;
  h.feed.clientHeight = 120;
  h.resize();
  assert.equal(h.row(4).getBoundingClientRect().top, before);
});

test('conversation disposal disconnects observers/listeners and does not retain the previous feed', () => {
  const h = timelineHarness();
  h.reconcile(list(10));
  assert.equal(h.feed.style.overflowAnchor, 'none');
  disposeDmTimeline(h.feed);
  assert.equal(h.feed.style.overflowAnchor, 'auto');
  assert.equal(h.observers[0].disconnected, true);
  assert.ok([...h.feed.listeners.values()].every((listeners) => listeners.size === 0));
  h.feed.scrollTop = 200;
  h.row(1).height += 100;
  h.resize();
  assert.equal(h.feed.scrollTop, 200);
  disposeDmTimeline(h.feed);
  h.reconcile([message('new')]);
  assert.equal(h.observers.length, 2);
  assert.equal(h.feed.children.filter((node) => node.dataset.messageId).length, 1);
  assert.equal(h.row('new').textContent, 'Message new');
});

const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const realtimeSource = appSource.slice(
  appSource.indexOf('async function syncActiveMessageThreadRealtime('),
  appSource.indexOf('function queueDmRealtimeSync('),
);

function realtimeHarness() {
  const pending = [];
  const rendered = [];
  const nodes = {
    'message-thread-feed': {}, 'message-thread-empty': { hidden: true },
    'message-thread': { hidden: false }, 'message-thread-loading': { hidden: true },
  };
  const surface = { hidden: false };
  const context = {
    byId: (id) => nodes[id],
    messagesSurface: surface,
    document: { visibilityState: 'visible' },
    fetchActiveConversationMessages: () => new Promise((resolve) => pending.push(resolve)),
    renderDmTimeline: (_feed, messages) => rendered.push(messages),
    markActiveConversationRead: async () => {},
    renderPeerReadReceipt: async () => {},
  };
  const api = runInNewContext(`
    let activeConversation = { id: 'one' };
    let currentMemberId = 'member';
    let messagesRequest = 1;
    let dmThreadSyncRequest = 0;
    ${realtimeSource}
    ({ sync: syncActiveMessageThreadRealtime,
      switchThread() { activeConversation = { id: 'two' }; messagesRequest += 1; },
      endSession() { currentMemberId = ''; },
    });
  `, context);
  return { ...api, nodes, surface, pending, rendered };
}

test('out-of-order realtime responses cannot roll the timeline back to an older snapshot', async () => {
  const h = realtimeHarness();
  const older = h.sync();
  const newer = h.sync();
  h.pending[1]([message(1), message(2)]);
  await newer;
  h.pending[0]([message(1)]);
  await older;
  assert.equal(h.rendered.length, 1);
  assert.equal(h.rendered[0].length, 2);
});

test('realtime ignores a loading thread and responses arriving after a switch, exit or signout', async () => {
  for (const invalidate of [
    (h) => h.switchThread(),
    (h) => { h.surface.hidden = true; },
    (h) => h.endSession(),
  ]) {
    const h = realtimeHarness();
    h.nodes['message-thread-loading'].hidden = false;
    await h.sync();
    assert.equal(h.pending.length, 0);
    h.nodes['message-thread-loading'].hidden = true;
    const response = h.sync();
    invalidate(h);
    h.pending[0]([message(1)]);
    await response;
    assert.equal(h.rendered.length, 0);
  }
});

test('timeline wiring leaves full replacement only at conversation resets and clears stale headers', () => {
  assert.doesNotMatch(realtimeSource, /replaceChildren|setTimeout|scrollTop/);
  assert.match(appSource, /import \{ disposeDmTimeline, reconcileDmTimeline \} from '.\/messages-timeline-ui\.js'/);
  const open = appSource.slice(appSource.indexOf('async function loadMessageThread('), appSource.indexOf('async function openDirectConversation('));
  assert.ok(open.indexOf('disposeDmTimeline(feed)') < open.indexOf('feed.replaceChildren()'));
  assert.ok(open.indexOf("document.createTextNode('Conversation')") < open.indexOf(".from('dm_conversations')"));
  assert.match(open, /threadName\.classList\.remove\('verified'\)/);
  assert.match(open, /Loading conversation…/);
  assert.ok(open.indexOf('scrollToDmMessage(feed') < open.indexOf('await markActiveConversationRead()'), 'initial positioning cannot wait for unrelated network requests');
});

test('a slow old typing stop cannot detach the newly opened conversation channel', async () => {
  const stopSource = appSource.slice(
    appSource.indexOf('async function stopDmConversationRealtime()'),
    appSource.indexOf('async function stopDmRealtime()'),
  );
  for (const fails of [false, true]) {
    let finishOldSend;
    const oldSend = new Promise((resolve, reject) => { finishOldSend = () => fails ? reject(new Error('offline')) : resolve(); });
    const removed = [];
    const oldChannel = { send(payload) {
      assert.equal(payload.event, 'typing');
      assert.equal(payload.payload.typing, false);
      return oldSend;
    } };
    const nextChannel = { send() { throw new Error('The previous stop must never use the next channel'); } };
    let activityResets = 0;
    const api = runInNewContext(`
      let dmConversationRealtimeChannel = oldChannel;
      let dmConversationRealtimeId = 'old';
      let dmTypingSent = true;
      let dmTypingStopTimer = 7;
      const currentMemberId = 'member';
      ${stopSource}
      ({ stop: stopDmConversationRealtime,
        current: () => ({ channel: dmConversationRealtimeChannel, id: dmConversationRealtimeId, typing: dmTypingSent }),
        openNext() { dmConversationRealtimeChannel = nextChannel; dmConversationRealtimeId = 'next'; dmTypingSent = true; },
      });
    `, {
      oldChannel, nextChannel,
      window: { clearTimeout() {} },
      resetDmActivityUI: () => { activityResets += 1; },
      supabase: { removeChannel: async (channel) => { removed.push(channel); } },
    });
    const stopped = api.stop();
    assert.equal(api.current().channel, null, 'the old transport must detach before awaiting its final typing send');
    assert.equal(api.current().id, '');
    api.openNext();
    finishOldSend();
    await stopped;
    assert.equal(api.current().channel, nextChannel);
    assert.equal(api.current().id, 'next');
    assert.equal(api.current().typing, true);
    assert.deepEqual(removed, [oldChannel]);
    assert.equal(activityResets, 1, 'a late stop must not reset the new peer’s presence');
  }
});
