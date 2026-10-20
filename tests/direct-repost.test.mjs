import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as settle } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const shorts = await readFile(new URL('../src/short-videos-feed.js', import.meta.url), 'utf8');

function functionSource(source, name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} must exist`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `${name} must have a closing brace`);
  return source.slice(start, end + 2);
}

function control(dataset = {}) {
  const classes = new Set();
  const attributes = new Map();
  return {
    dataset, disabled: false,
    classList: {
      toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
  };
}

function repostHarness({ active = false, count = 2 } = {}) {
  const requests = [];
  const refreshed = [];
  const toasts = [];
  const makeCard = (postId) => {
    const metric = { textContent: String(count) };
    const label = { textContent: active ? 'Undo repost' : 'Repost' };
    const button = control({ sautiAction: 'repost', active: String(active), pending: 'false' });
    const card = {
      dataset: { postId },
      querySelector: (selector) => selector === '[data-sauti-action="repost"]' ? button : null,
      querySelectorAll: () => [],
    };
    button.querySelector = (selector) => selector === '[data-count-for]' ? metric : selector === '.sauti-action-label' ? label : null;
    button.closest = (selector) => selector === '[data-sauti-action]' ? button : selector === '.sauti-card' ? card : null;
    return { card, button, metric, label };
  };
  const primary = makeCard('sample-post');
  const duplicate = makeCard('sample-post');
  const other = makeCard('other-post');
  const cards = [primary, duplicate, other];
  const context = {
    document: { querySelectorAll: (selector) => selector === '.sauti-card' ? cards.map(({ card }) => card) : [] },
    socialMutation: (path, options) => new Promise((resolve, reject) => requests.push({ path, method: options.method, resolve, reject })),
    refreshPostInteractionControls: (postId) => refreshed.push(postId),
    showToast: (...args) => toasts.push(args),
  };
  const names = ['sautiCardsForPost', 'syncPostActionButton', 'setPostInteractionPending', 'setPostInteractionState', 'toggleRepost', 'handleSautiFeedClick'];
  const api = runInNewContext(`${names.map((name) => functionSource(app, name)).join('\n')}\n({ handleSautiFeedClick });`, context);
  for (const { button } of cards) button.click = () => { if (!button.disabled) api.handleSautiFeedClick({ target: button }); };
  return { ...primary, duplicate, other, requests, refreshed, toasts, click: () => primary.button.click(), context };
}

function assertRepostState(item, { active, pending, count }) {
  assert.equal(item.button.dataset.active, String(active));
  assert.equal(item.button.dataset.pending, String(pending));
  assert.equal(item.button.getAttribute('aria-pressed'), String(active));
  assert.equal(item.button.getAttribute('aria-busy'), String(pending));
  assert.equal(item.button.getAttribute('aria-label'), active ? 'Undo repost' : 'Repost');
  assert.equal(item.label.textContent, active ? 'Undo repost' : 'Repost');
  assert.equal(item.metric.textContent, String(count));
}

test('one core Repost click sends one mutation immediately and a second completed click undoes it', async () => {
  const h = repostHarness();
  h.click();
  assert.equal(h.requests.length, 1, 'a click must mutate directly without a menu choice');
  assert.equal(h.requests[0].path, '/api/social/posts/sample-post/repost');
  assert.equal(h.requests[0].method, 'POST');
  assertRepostState(h, { active: true, pending: true, count: 3 });
  assertRepostState(h.duplicate, { active: true, pending: true, count: 3 });
  assert.equal(h.other.metric.textContent, '2', 'another post is not changed');
  h.requests[0].resolve({});
  await settle();
  assertRepostState(h, { active: true, pending: false, count: 3 });
  assert.deepEqual(h.refreshed, ['sample-post']);

  h.click();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].method, 'DELETE');
  assertRepostState(h.duplicate, { active: false, pending: true, count: 2 });
  h.requests[1].resolve({});
  await settle();
  assertRepostState(h, { active: false, pending: false, count: 2 });
  assert.equal(h.toasts.at(-1)[0], 'Repost removed.');
});

test('rapid Repost clicks, including another copy of the post, share a pending guard', async () => {
  const h = repostHarness();
  h.click();
  h.click();
  h.duplicate.button.click();
  assert.equal(h.requests.length, 1);
  assertRepostState(h, { active: true, pending: true, count: 3 });
  h.requests[0].resolve({});
  await settle();
  h.duplicate.button.click();
  assert.equal(h.requests.length, 2, 'the guard clears after completion');
  assert.equal(h.requests[1].method, 'DELETE');
  h.requests[1].resolve({});
  await settle();
});

for (const active of [false, true]) {
  test(`a failed ${active ? 'undo' : 'repost'} restores all cards and releases the pending guard`, async () => {
    const h = repostHarness({ active, count: active ? 3 : 2 });
    h.click();
    h.requests[0].reject(new Error('Connection interrupted'));
    await settle();
    const expected = { active, pending: false, count: active ? 3 : 2 };
    assertRepostState(h, expected);
    assertRepostState(h.duplicate, expected);
    assert.deepEqual(h.toasts.at(-1), ['Connection interrupted', 'error']);
    assert.equal(h.refreshed.length, 0, 'failed mutations do not hydrate an optimistic result');
    h.click();
    assert.equal(h.requests.length, 2, 'retry remains possible');
    h.requests[1].resolve({});
    await settle();
  });
}

function shortHarness(core) {
  const button = control({ shortAction: 'repost' });
  const count = { textContent: '', hidden: true };
  const root = { hidden: true };
  const slide = {
    ...control({ postId: core.card.dataset.postId }),
    closest: () => root,
    querySelector: (selector) => selector === '[data-short-action="repost"]' ? button : null,
  };
  button.closest = (selector) => selector === '[data-short-action]' ? button : selector === '.sauti-short-video-slide' ? slide : null;
  button.querySelector = (selector) => selector === '[data-short-action-count]' ? count : null;
  let click;
  const names = ['sourceCardForPost', 'mediaUrlForTile', 'shortVideoUrlForTile', 'sourceTileForSlide', 'actionSourceFor', 'actionStateSourceFor', 'sourceActionCount', 'syncSlideFromSource'];
  const start = shorts.indexOf("  track.addEventListener('click', (event) => {");
  const end = shorts.indexOf("  track.addEventListener('keydown'", start);
  assert.ok(start >= 0 && end > start, 'Short Videos track click path must exist');
  const context = {
    SHORT_VIDEOS_ROOT_ID: 'sauti-short-videos',
    document: { querySelectorAll: () => [core.card] },
    window: { setTimeout: (callback) => callback() },
    track: { addEventListener: (type, handler) => { if (type === 'click') click = handler; } },
  };
  const sync = runInNewContext(`${names.map((name) => functionSource(shorts, name)).join('\n')}\n${shorts.slice(start, end)}\n() => syncSlideFromSource(slide);`, { ...context, slide });
  return { button, count, sync, click: () => click({ target: button }) };
}

test('Short Videos forwards Repost to the core click path and mirrors pending, success, undo and rollback', async () => {
  const core = repostHarness();
  const short = shortHarness(core);
  short.click();
  assert.equal(core.requests.length, 1);
  assert.equal(core.requests[0].method, 'POST');
  short.sync();
  assert.equal(short.button.dataset.active, 'true');
  assert.equal(short.button.dataset.pending, 'true');
  assert.equal(short.button.getAttribute('aria-pressed'), 'true');
  assert.equal(short.button.getAttribute('aria-busy'), 'true');
  assert.equal(short.button.getAttribute('aria-label'), 'Undo repost');
  assert.equal(short.button.getAttribute('title'), 'Undo repost');
  assert.equal(short.count.textContent, '3');
  short.click();
  assert.equal(core.requests.length, 1, 'the forwarded core pending guard blocks another request');
  core.requests[0].resolve({});
  await settle();
  short.sync();
  assert.equal(short.button.getAttribute('aria-busy'), 'false');
  short.click();
  assert.equal(core.requests[1].method, 'DELETE');
  short.sync();
  assert.equal(short.button.getAttribute('aria-pressed'), 'false');
  assert.equal(short.button.getAttribute('aria-label'), 'Repost');
  assert.equal(short.count.textContent, '2');
  core.requests[1].reject(new Error('Undo failed'));
  await settle();
  short.sync();
  assert.equal(short.button.getAttribute('aria-busy'), 'false');
  assert.equal(short.button.getAttribute('aria-pressed'), 'true');
  assert.equal(short.button.getAttribute('aria-label'), 'Undo repost');
  assert.equal(short.count.textContent, '3');
  core.button.disabled = true;
  short.sync();
  assert.equal(short.button.disabled, true, 'source disabled state is preserved');
  short.click();
  assert.equal(core.requests.length, 2, 'disabled core actions cannot be forwarded');
});

test('legacy quote drafts retain authored text and media while restoration and future snapshots omit the quote', () => {
  const prefix = 'drafts:';
  const currentPrefix = 'current:';
  const draft = { id: 'legacy', body: 'My own caption', audience: 'followers', replyAccess: 'following', media: [{ id: 'image-one', altText: 'Original photo', status: 'ready' }], quote: { id: 'quoted-post', body: 'Someone else’s content' } };
  const storage = new Map([[`${prefix}member`, JSON.stringify([draft])], [`${currentPrefix}member`, JSON.stringify(draft)]]);
  const inputs = {
    'sauti-body': { value: '', focus() {} },
    'sauti-audience': { value: 'public', options: [{ value: 'public' }, { value: 'followers' }] },
    'sauti-reply-access': { value: 'everyone' },
    'composer-drafts': { hidden: false },
    'sauti-drafts-toggle': control(),
  };
  const context = {
    currentMemberId: 'member', composerDrafts: [], composerMedia: [], restoringComposerState: false,
    POST_BODY_LIMIT: 2000, COMPOSER_CURRENT_PREFIX: currentPrefix, COMPOSER_DRAFTS_PREFIX: prefix, COMPOSER_DRAFT_LIMIT: 20,
    window: { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } },
    byId: (id) => inputs[id], renderComposerDrafts() {}, updateComposerState() {},
    restoreComposerMedia: (media) => { context.composerMedia = media; },
    serializeComposerMedia: () => context.composerMedia,
  };
  const names = ['composerStorageKey', 'stripComposerQuote', 'readComposerStorage', 'writeComposerStorage', 'loadComposerDraftsFromStorage', 'applyComposerSnapshot', 'restoreComposerDraft', 'persistComposerCurrent', 'currentComposerSnapshot'];
  const api = runInNewContext(`${names.map((name) => functionSource(app, name)).join('\n')}\n({ readComposerStorage, loadComposerDraftsFromStorage, restoreComposerDraft, currentComposerSnapshot });`, context);
  const current = api.readComposerStorage(currentPrefix, null);
  assert.equal(current.body, draft.body);
  assert.deepEqual(JSON.parse(JSON.stringify(current.media)), draft.media);
  assert.equal('quote' in current, false);
  assert.equal('quote' in JSON.parse(storage.get(`${currentPrefix}member`)), false, 'legacy current storage is sanitized');
  api.loadComposerDraftsFromStorage();
  assert.equal(context.composerDrafts.length, 1);
  assert.equal('quote' in context.composerDrafts[0], false);
  assert.equal('quote' in JSON.parse(storage.get(`${prefix}member`))[0], false, 'saved legacy drafts are sanitized');
  api.restoreComposerDraft('legacy');
  assert.equal(inputs['sauti-body'].value, draft.body);
  assert.equal(inputs['sauti-audience'].value, 'followers');
  assert.equal(inputs['sauti-reply-access'].value, 'following');
  assert.deepEqual(JSON.parse(JSON.stringify(context.composerMedia)), draft.media);
  const snapshot = api.currentComposerSnapshot();
  assert.equal(snapshot.body, draft.body);
  assert.equal('quote' in snapshot, false);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.media)), draft.media);
  assert.equal(context.composerDrafts.length, 0, 'restoration consumes the saved draft');
});

test('publishing sends authored text and media without a quote and rejects an empty legacy quote-only draft', async () => {
  const requests = [];
  const messages = [];
  const submit = { ...control(), textContent: 'Post', removeAttribute() {} };
  const nodes = {
    'sauti-body': { value: '  My own caption  ' },
    'sauti-submit': submit,
    'sauti-message': {},
    'sauti-audience': { value: 'followers', selectedOptions: [{ textContent: 'Followers' }] },
    'sauti-reply-access': { value: 'following' },
  };
  const context = {
    currentMember: { id: 'member' },
    activeComposerQuote: { id: 'legacy-target' },
    composerMedia: [{ id: 'photo', status: 'ready', altText: '  Original photo  ' }],
    POST_BODY_LIMIT: 2000,
    navigator: { onLine: true }, byId: (id) => nodes[id],
    currentAuthorizationHeader: async () => ({ Authorization: 'Bearer fixture' }),
    fetch: async (path, options) => { requests.push({ path, method: options.method, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true }) }; },
    setMessage: (_node, ...args) => messages.push(args),
    clearComposerCurrent() {}, loadStream() {}, closeSautiComposer() {}, showToast() {}, updateComposerState() {},
  };
  const publish = runInNewContext(`${functionSource(app, 'shareSauti')}\nshareSauti;`, context);
  await publish();
  assert.deepEqual(requests, [{
    path: '/api/sauti', method: 'POST', body: {
      body: 'My own caption', visibility: 'followers', circle_id: null,
      reply_access: 'following', media: [{ id: 'photo', alt_text: 'Original photo' }],
    },
  }]);
  nodes['sauti-body'].value = '';
  context.composerMedia = [];
  await publish();
  assert.equal(requests.length, 1, 'a legacy quote reference cannot publish a new empty post');
  assert.equal(messages.at(-1)[0], 'Write something or add media before sharing.');
});
