import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { roomPublishRequestId, confirmRoomPublishRequest, roomPublishOutcome } from '../src/room-publish-outcome.js';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const images = await readFile(new URL('../src/room-post-images.js', import.meta.url), 'utf8');
const OWNER = '10000000-0000-4000-8000-000000000001';
const ROOM = '20000000-0000-4000-8000-000000000001';
const SUBMISSION = '30000000-0000-4000-8000-000000000001';
const pending = () => ({ ok: true, data: { published: false, submission: { id: SUBMISSION, state: 'pending', author_id: OWNER, room_id: ROOM } } });
function extract(source, from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
function nodes() {
  const map = new Map();
  return (id) => {
    if (!map.has(id)) map.set(id, { value: '', textContent: '', selectedOptions: [{ textContent: 'Fixture Room' }],
      setAttribute() {}, removeAttribute() {}, dispatchEvent() {} });
    return map.get(id);
  };
}
const helpers = { roomPublishRequestId, confirmRoomPublishRequest, roomPublishOutcome, navigator: { onLine: true }, POST_BODY_LIMIT: 10000 };

test('Home composer pending Room acknowledgement clears local draft without a live toast, feed refresh or own-post pin', async () => {
  const byId = nodes(), calls = [], messages = [], toasts = [], requests = [];
  byId('sauti-body').value = 'Pending Room draft';
  byId('sauti-audience').value = `circle:${ROOM}`;
  const context = { ...helpers, byId, currentMember: { id: OWNER }, currentMemberId: OWNER,
    composerMedia: [{ id: '40000000-0000-4000-8000-000000000001', status: 'ready', altText: 'Fixture' }],
    composerHasMention: () => true, setMessage: (_, text) => messages.push(text),
    currentAuthorizationHeader: async () => ({ Authorization: 'Bearer fixture' }),
    clearComposerCurrent: () => calls.push('clear-local'), closeSautiComposer: () => calls.push('close'),
    returnHomeAfterPost: async () => calls.push('publish-home'), showToast: (text) => toasts.push(text),
    updateComposerState() {}, fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, status: 202, json: async () => pending() }; },
  };
  const share = runInNewContext(extract(app, 'async function shareSauti()', 'async function deleteThreadComment(') + '\nshareSauti;', context);
  await share();
  assert.deepEqual(calls, ['clear-local', 'close']);
  assert.equal(messages.at(-1), 'Submitted to Room admins for approval.');
  assert.deepEqual(toasts, ['Room post is awaiting approval.']);
  assert.match(requests[0].client_request_id, /^[a-f0-9-]{36}$/);
});

test('Room text composer retries an unacknowledged draft with the same id and never refreshes a pending submission as published', async () => {
  const byId = nodes(), requests = [], messages = [], calls = [];
  byId('circle-sauti-body').value = 'Retry pending text';
  let lost = true;
  const context = { ...helpers, byId, currentMemberId: OWNER, activeCircle: { circle: { id: ROOM } },
    circleStreamAllowed: () => true, composerHasMention: () => true,
    setMessage: (_, text) => messages.push(text), currentAuthorizationHeader: async () => ({ Authorization: 'Bearer fixture' }),
    updateCircleComposerState() {}, loadCircleStream: async () => calls.push('reload'), showToast: (text) => calls.push(text),
    fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); if (lost) { lost = false; throw new Error('Lost acknowledgement'); } return { ok: true, status: 202, json: async () => pending() }; },
  };
  const share = runInNewContext(extract(app, 'async function shareCircleSauti()', 'async function loadCircleDetail(') + '\nshareCircleSauti;', context);
  await share();
  assert.equal(byId('circle-sauti-body').value, 'Retry pending text');
  await share();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].client_request_id, requests[1].client_request_id);
  assert.equal(byId('circle-sauti-body').value, '');
  assert.equal(messages.at(-1), 'Submitted to Room admins for approval.');
  assert.deepEqual(calls, ['Room post is awaiting approval.']);
});

test('Room image pending acknowledgement keeps held bytes and does not refresh the public Room feed', async () => {
  const byId = nodes(), messages = [], clear = [], requests = [];
  let reloads = 0;
  byId('circle-sauti-body').value = 'Pending image';
  byId('circle-stream-retry').click = () => reloads++;
  const context = { ...helpers, Event, roomPostNode: byId, roomPostImages: [{ id: '40000000-0000-4000-8000-000000000002', status: 'ready' }],
    roomPostImageSubmitting: false, roomPostImageRoomSlug: 'fixture', roomPostSlug: () => 'fixture',
    roomPostMentionReady: () => true, roomPostAccessToken: () => 'fixture', lookupRoomForPost: async () => ({ id: ROOM }),
    renderRoomPostImages() {}, roomPostMessage: (text) => messages.push(text),
    clearRoomPostImages: async (options) => clear.push(options), queueMicrotask() {}, syncRoomPostImageComposer() {},
    fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, status: 202, json: async () => pending() }; },
  };
  const share = runInNewContext(extract(images, 'async function publishRoomPostWithImages(', 'function installRoomPostImages(') + '\npublishRoomPostWithImages;', context);
  await share({ preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(clear.length, 1);
  assert.equal(clear[0].remote, false);
  assert.equal(reloads, 0);
  assert.equal(messages.at(-1), 'Submitted to Room admins for approval.');
  assert.match(requests[0].client_request_id, /^[a-f0-9-]{36}$/);
});

test('an unconfirmed 202 preserves the Home draft and does not claim a submitted or live post', async () => {
  const byId = nodes(), calls = [], messages = [];
  byId('sauti-body').value = 'Unconfirmed'; byId('sauti-audience').value = `circle:${ROOM}`;
  const context = { ...helpers, byId, currentMember: { id: OWNER }, currentMemberId: OWNER, composerMedia: [],
    composerHasMention: () => true, setMessage: (_, text) => messages.push(text),
    currentAuthorizationHeader: async () => ({ Authorization: 'Bearer fixture' }), updateComposerState() {},
    clearComposerCurrent: () => calls.push('clear'), closeSautiComposer: () => calls.push('close'),
    returnHomeAfterPost: async () => calls.push('home'), showToast: () => calls.push('toast'),
    fetch: async () => ({ ok: true, status: 202, json: async () => ({ ok: true, data: {} }) }),
  };
  await runInNewContext(extract(app, 'async function shareSauti()', 'async function deleteThreadComment(') + '\nshareSauti;', context)();
  assert.deepEqual(calls, []);
  assert.match(messages.at(-1), /not confirmed/);
});
