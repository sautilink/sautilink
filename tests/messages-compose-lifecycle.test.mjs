import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformMessagesReplySource } from '../scripts/messages-reply-source-transform.mjs';

const mediaSource = await readFile(new URL('../src/messages-media-ui.js', import.meta.url), 'utf8');
const appSource = transformMessagesReplySource('/repo/src/app.js', await readFile(new URL('../src/app.js', import.meta.url), 'utf8'));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const photo = () => ({ name: 'photo.png', type: 'image/png', size: 100 });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };

function node() {
  const attributes = new Map();
  return {
    hidden: false, disabled: false, value: '', textContent: '', dataset: {}, children: [{}],
    getAttribute: (key) => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
    dispatchEvent() {},
  };
}

function mediaHarness({ microphone } = {}) {
  const nodes = Object.fromEntries([
    'messages-surface', 'message-thread', 'message-composer', 'message-body',
    'message-send', 'message-thread-feed', 'message-composer-message',
  ].map((id) => [id, node()]));
  const live = { memberId: 'member', conversationId: A };
  const window = {
    location: { pathname: `/messages/${A}` },
    __sautilinkDmRealtimeContext: () => live,
    __sautilinkMessagesAuthorizationHeaders: async () => ({ Authorization: 'Bearer fixture' }),
    clearInterval() {}, clearTimeout() {},
  };
  const requests = [];
  const revoked = [];
  const errors = [];
  const previews = [];
  let urlCount = 0;
  const api = runInNewContext(`${mediaSource.replace(/\ninitializeMessagesMediaUi\(\);\s*$/, '')}
    createPendingPreview = () => { previews.push(pendingMessageAttachment); updateAttachmentControls(); };
    setMessagesMediaMessage = (text = '') => { errors.push(text); };
    ({ upload: uploadMessageAttachment, send: sendPendingAttachment, sync: syncMessageMediaContext,
      clear: clearPendingAttachment, voice: startVoiceRecording,
      pending: () => pendingMessageAttachment,
      recording: () => activeVoiceRecording,
    });
  `, {
    window, document: { getElementById: (id) => nodes[id] || null },
    Headers, Event, previews, errors,
    URL: { createObjectURL: () => `blob:fixture-${++urlCount}`, revokeObjectURL: (url) => revoked.push(url) },
    navigator: { mediaDevices: microphone ? { getUserMedia: microphone } : undefined },
    MediaRecorder: microphone ? class {
      static isTypeSupported() { return true; }
      constructor() { throw new Error('A stale permission request must not start a recorder'); }
    } : undefined,
    fetch: (url, options) => {
      const result = deferred();
      requests.push({ url, options, resolve: result.resolve });
      if (options.method === 'DELETE') result.resolve({ ok: true });
      return result.promise;
    },
  });
  function switchTo(conversationId, memberId = 'member') {
    live.conversationId = conversationId;
    live.memberId = memberId;
    window.location.pathname = `/messages/${conversationId}`;
    api.sync();
  }
  function reply(request, { id, ok = true } = {}) {
    request.resolve({ ok, json: async () => ok ? { data: { id } } : { error: { message: 'Request failed' } } });
  }
  async function ready(id = 'attachment') {
    const upload = api.upload(photo(), 'photo');
    await flush();
    reply(requests.findLast((request) => request.url === '/api/dm-media/upload'), { id });
    await upload;
    return api.pending();
  }
  const submit = () => api.send({ preventDefault() {}, stopImmediatePropagation() {} });
  return { ...api, nodes, live, window, requests, revoked, errors, previews, switchTo, reply, ready, submit };
}

test('pending preview is bound to its member and conversation, with local and remote cleanup on exit', async () => {
  const h = mediaHarness();
  const item = await h.ready('old-ready');
  h.nodes['message-body'].value = 'Keep this draft';
  h.sync();
  assert.equal(h.pending(), item, 'same-context mutations must not clear a ready attachment');
  h.nodes['messages-surface'].hidden = true;
  h.sync();
  await flush();
  assert.equal(h.pending(), null);
  assert.deepEqual(h.revoked, [item.localUrl]);
  assert.ok(h.requests.some((request) => request.url === '/api/dm-media/old-ready' && request.options.method === 'DELETE'));
  assert.equal(h.nodes['message-body'].value, 'Keep this draft');

  h.nodes['messages-surface'].hidden = false;
  const next = await h.ready('account-ready');
  h.switchTo(A, 'another-member');
  assert.equal(h.pending(), null, 'changing accounts on the same route must invalidate the pending item');
  assert.ok(h.revoked.includes(next.localUrl));
});

for (const success of [true, false]) {
  test(`late upload ${success ? 'success' : 'failure'} cannot replace a new chat attachment`, async () => {
    const h = mediaHarness();
    const old = h.upload(photo(), 'photo');
    await flush();
    const oldRequest = h.requests[0];
    h.switchTo(B);
    const next = await h.ready('new-upload');
    h.nodes['message-body'].value = 'New chat draft';
    h.reply(oldRequest, { id: 'old-upload', ok: success });
    await old;
    await flush();
    assert.equal(h.pending(), next);
    assert.equal(next.id, 'new-upload');
    assert.equal(h.nodes['message-body'].value, 'New chat draft');
    assert.ok(!h.errors.includes('Request failed'));
    if (success) assert.ok(h.requests.some((request) => request.url === '/api/dm-media/old-upload' && request.options.method === 'DELETE'));
  });
}

test('replacing an upload with the exact same File object still keeps the newer pending item', async () => {
  const h = mediaHarness();
  const file = photo();
  const old = h.upload(file, 'photo');
  await flush();
  const oldRequest = h.requests[0];
  const nextUpload = h.upload(file, 'photo');
  await flush();
  h.reply(h.requests[1], { id: 'new-same-file' });
  await nextUpload;
  const next = h.pending();
  h.reply(oldRequest, { id: 'old-same-file' });
  await old;
  assert.equal(h.pending(), next);
  assert.equal(next.id, 'new-same-file');
});

test('a stale attachment submit is consumed and never falls through to sending the new chat draft as text', async () => {
  const h = mediaHarness();
  await h.ready('old-submit');
  h.live.conversationId = B;
  h.window.location.pathname = `/messages/${B}`;
  h.nodes['message-body'].value = 'Unsent new chat draft';
  let prevented = 0;
  let stopped = 0;
  await h.send({ preventDefault: () => { prevented += 1; }, stopImmediatePropagation: () => { stopped += 1; } });
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(h.pending(), null);
  assert.equal(h.nodes['message-body'].value, 'Unsent new chat draft');
  assert.equal(h.requests.filter((request) => request.url.includes('/send/')).length, 0);
});

for (const success of [true, false]) {
  test(`an old media send ${success ? 'success' : 'failure'} cannot clear a new chat draft, pending item or busy state`, async () => {
    const h = mediaHarness();
    await h.ready('old-send');
    h.nodes['message-body'].value = 'Old caption';
    const oldSend = h.submit();
    await flush();
    const oldRequest = h.requests.findLast((request) => request.url.includes('/send/'));
    assert.equal(JSON.parse(oldRequest.options.body).conversation_id, A);
    h.switchTo(B);
    const next = await h.ready('new-send');
    h.nodes['message-body'].value = 'New caption';
    const nextSend = h.submit();
    await flush();
    const nextRequest = h.requests.findLast((request) => request.url.includes('/send/'));
    h.reply(oldRequest, { ok: success });
    await oldSend;
    assert.equal(h.pending(), next);
    assert.equal(h.nodes['message-body'].value, 'New caption');
    assert.equal(h.nodes['message-send'].getAttribute('aria-busy'), 'true');
    assert.equal(h.nodes['message-send'].disabled, true);
    assert.ok(!h.errors.includes('Request failed'));
    h.reply(nextRequest);
    await nextSend;
    assert.equal(h.pending(), null);
    assert.equal(h.nodes['message-body'].value, '');
    assert.equal(h.nodes['message-send'].getAttribute('aria-busy'), null);
  });
}

test('a current media send failure preserves retry state; success preserves a newly typed draft', async () => {
  const h = mediaHarness();
  const item = await h.ready('retry');
  h.nodes['message-body'].value = '  Original caption  ';
  const failed = h.submit();
  await flush();
  h.reply(h.requests.findLast((request) => request.url.includes('/send/')), { ok: false });
  await failed;
  assert.equal(h.pending(), item);
  assert.equal(item.status, 'ready');
  assert.equal(h.nodes['message-body'].value, '  Original caption  ');
  assert.equal(h.nodes['message-send'].getAttribute('aria-busy'), null);
  assert.equal(h.nodes['message-send'].disabled, false);
  const retried = h.submit();
  await flush();
  const request = h.requests.findLast((entry) => entry.url.includes('/send/'));
  assert.equal(JSON.parse(request.options.body).body, 'Original caption');
  h.nodes['message-body'].value = 'My next message';
  h.reply(request);
  await retried;
  assert.equal(h.pending(), null);
  assert.equal(h.nodes['message-body'].value, 'My next message');
  assert.ok(h.revoked.includes(item.localUrl));
});

test('microphone permission completing after a chat switch closes its tracks without recording in the new chat', async () => {
  const permission = deferred();
  const h = mediaHarness({ microphone: () => permission.promise });
  let stopped = 0;
  const starting = h.voice();
  h.switchTo(B);
  permission.resolve({ getTracks: () => [{ stop: () => { stopped += 1; } }] });
  await starting;
  assert.equal(stopped, 1);
  assert.equal(h.recording(), null);
  assert.equal(h.pending(), null);
  assert.ok(h.errors.every((error) => !error));
});

function textHarness() {
  const source = appSource.slice(appSource.indexOf('async function sendDirectMessage()'), appSource.indexOf('async function editDirectMessage('));
  const nodes = Object.fromEntries(['message-body', 'message-send', 'message-composer-message', 'message-composer'].map((id) => [id, node()]));
  const requests = [];
  const errors = [];
  let replyClears = 0;
  const api = runInNewContext(`
    let activeConversation = { id: 'one' };
    let currentMemberId = 'member';
    let messagesRequest = 1;
    ${source}
    ({ send: sendDirectMessage, switchThread() { activeConversation = { id: 'two' }; messagesRequest += 1; } });
  `, {
    byId: (id) => nodes[id],
    setMessage: (_node, text) => errors.push(text),
    updateMessageComposerState() {}, broadcastDmTyping: async () => {}, syncActiveMessageThreadRealtime: async () => {},
    supabase: { from: () => ({ insert: (payload) => { const result = deferred(); requests.push({ ...result, payload }); return result.promise; } }) },
    window: { __sautilinkClearMessageReply: () => { replyClears += 1; delete nodes['message-composer'].dataset.replyToMessageId; } },
  });
  return { ...api, nodes, requests, errors, get replyClears() { return replyClears; } };
}

test('text send keeps a draft and reply chosen while its original request is in flight', async () => {
  const h = textHarness();
  h.nodes['message-body'].value = '  Original message  ';
  h.nodes['message-composer'].dataset.replyToMessageId = '10';
  const sent = h.send();
  h.nodes['message-body'].value = 'Next draft';
  h.nodes['message-composer'].dataset.replyToMessageId = '11';
  h.requests[0].resolve({ error: null });
  await sent;
  assert.equal(h.requests[0].payload.body, 'Original message');
  assert.equal(h.requests[0].payload.reply_to_message_id, 10);
  assert.equal(h.nodes['message-body'].value, 'Next draft');
  assert.equal(h.nodes['message-composer'].dataset.replyToMessageId, '11');
  assert.equal(h.replyClears, 0);
});

test('text send clears only its unchanged draft and its unchanged reply context', async () => {
  const h = textHarness();
  h.nodes['message-body'].value = 'Original message';
  h.nodes['message-composer'].dataset.replyToMessageId = '10';
  const sent = h.send();
  h.nodes['message-composer'].dataset.replyToMessageId = '11';
  h.requests[0].resolve({ error: null });
  await sent;
  assert.equal(h.nodes['message-body'].value, '');
  assert.equal(h.nodes['message-composer'].dataset.replyToMessageId, '11');
  assert.equal(h.replyClears, 0);
});

test('old text send failure cannot replace a new chat draft, error or busy state', async () => {
  const h = textHarness();
  h.nodes['message-body'].value = 'Old draft';
  const sent = h.send();
  h.switchThread();
  h.nodes['message-body'].value = 'New draft';
  h.nodes['message-send'].setAttribute('aria-busy', 'true');
  h.nodes['message-composer-message'].textContent = 'New chat status';
  h.requests[0].resolve({ error: new Error('offline') });
  await sent;
  assert.equal(h.nodes['message-body'].value, 'New draft');
  assert.equal(h.nodes['message-send'].getAttribute('aria-busy'), 'true');
  assert.equal(h.nodes['message-composer-message'].textContent, 'New chat status');
  assert.deepEqual(h.errors, ['']);
});
