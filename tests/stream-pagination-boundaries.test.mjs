import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { createHomeFeedStartupRead } from '../src/home-feed-startup-read.js';
import { transformMemberBootstrapResilienceSource } from '../scripts/member-bootstrap-resilience-source-transform.mjs';

const raw = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const transformed = transformMemberBootstrapResilienceSource('/repo/src/app.js', raw);
const tick = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }
function block(source, start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const events = count => Array.from({ length: count }, (_, index) => ({
  event_key: `post:${index}`, event_at: `time-${index}`, post_id: `p${index}`, post: { id: `p${index}` },
}));

function harness({ mode = 'for-you', rows = events(30), source = transformed, read } = {}) {
  const operations = [], hydrated = [], nodes = new Map(), completions = [];
  let hydrate = async page => page;
  const feed = { children: [], get childElementCount() { return this.children.length; },
    append(card) { this.children.push(card); }, replaceChildren() { this.children = []; },
    querySelectorAll(selector) { assert.equal(selector, '.sauti-card[data-event-key]'); return this.children; } };
  const scope = { currentMember: { id: 'A' }, currentMemberId: 'A', recoverySession: false, activeHomeFeed: mode,
    streamLoading: false, streamRequest: 0, streamOffset: 0, streamCursor: null, streamHasMore: false,
    STREAM_PAGE_SIZE: 20, STREAM_INITIAL_PAGE_SIZE: 5,
    READ_RETRY_ATTEMPTS: 3, READ_RETRY_TIMEOUT_MS: 1000, READ_RETRY_DELAYS_MS: [0, 1, 1],
    HOME_FEED_COPY: { 'for-you': { rpcMode: 'for_you' }, following: { rpcMode: 'following' }, 'short-videos': { rpcMode: 'short_videos' } },
    window: { location: { pathname: '/home' }, setTimeout, clearTimeout }, createHomeFeedStartupRead,
    syncHomeFeedModeUi() {}, clearHomeFeedMediaState() {},
    byId(id) { if (id === 'stream-feed') return feed; if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false }); return nodes.get(id); },
    hydrateStreamEvents(page) { hydrated.push([...page]); return hydrate(page); },
    createSautiCard(item) { return item.post ? { dataset: { eventKey: item.event_key || item.post.id } } : null; },
    memberSurfaceRetention: { completed(...args) { completions.push(args); } },
    supabase: { rpc(name, params) {
      assert.equal(name, 'social_home_feed');
      const operation = { ...params, executions: 0 }; operations.push(operation);
      const result = read ? read(operation, operations.length) : { data: rows.slice(params.p_offset, params.p_offset + params.p_limit) };
      return { abortSignal(signal) { operation.signal = signal; return this; },
        then(ok, fail) { operation.executions++; return Promise.resolve(result).then(ok, fail); } };
    } },
  };
  vm.createContext(scope);
  const initializer = block(transformed, 'const initialHomeFeedRead = createHomeFeedStartupRead(', "window.addEventListener('popstate'");
  vm.runInContext(initializer + '\nthis.reader = initialHomeFeedRead;', scope);
  scope.reader.auth('INITIAL_SESSION', { user: { id: 'A' } });
  const utilities = block(transformed, 'function memberBootWithTimeout(', 'function refreshMemberProfileAfterFallback(');
  vm.runInContext(utilities + '\n' + block(source, 'function renderStreamRows(', 'async function loadQuotedPostMap(')
    + '\n' + block(source, 'async function loadStream(', 'function sautiCardsForPost(') + '\nthis.load = loadStream;', scope);
  return { scope, operations, hydrated, feed, nodes, completions,
    setHydrate(value) { hydrate = value; }, load: options => scope.load(options),
    keys: () => feed.children.map(card => card.dataset.eventKey),
    close() { scope.reader.invalidate(); },
  };
}

for (const mode of ['for-you', 'following', 'short-videos']) {
  test(`${mode}: first five render in order, then normal twenty-item pagination starts at offset five`, async () => {
    const h = harness({ mode });
    try {
      await h.load({ reset: true });
      assert.equal(h.operations[0].p_limit, 6);
      assert.equal(h.operations[0].p_offset, 0);
      assert.equal(h.operations[0].p_mode, h.scope.HOME_FEED_COPY[mode].rpcMode);
      assert.deepEqual(h.keys(), events(5).map(row => row.event_key));
      assert.equal(h.hydrated[0].length, 5, 'the sentinel is not hydrated or rendered');
      assert.equal(h.scope.streamOffset, 5); assert.equal(h.scope.streamHasMore, true);
      await h.load();
      assert.equal(h.operations[1].p_limit, 21); assert.equal(h.operations[1].p_offset, 5);
      assert.equal(h.hydrated[1].length, 20);
      assert.deepEqual(h.keys(), events(25).map(row => row.event_key));
      assert.equal(h.scope.streamOffset, 25); assert.equal(h.scope.streamHasMore, true);
      await h.load();
      assert.equal(h.operations[2].p_offset, 25); assert.equal(h.scope.streamOffset, 30);
      assert.equal(h.scope.streamHasMore, false); assert.equal(h.nodes.get('stream-more').hidden, true);
      assert.ok(h.operations.every(operation => operation.executions === 1));
    } finally { h.close(); }
  });
}

test('zero/exact first-page and later-page boundaries use their own sentinel and never skip it', async () => {
  for (const count of [0, 4, 5, 6, 24, 25, 26]) {
    const h = harness({ rows: events(count) });
    try {
      await h.load({ reset: true });
      assert.equal(h.scope.streamHasMore, count > 5, `first boundary ${count}`);
      assert.equal(h.scope.streamOffset, Math.min(5, count));
      if (h.scope.streamHasMore) await h.load();
      assert.equal(h.scope.streamHasMore, count > 25, `later boundary ${count}`);
      assert.equal(h.scope.streamOffset, Math.min(25, count));
      assert.deepEqual(h.keys(), events(Math.min(25, count)).map(row => row.event_key));
    } finally { h.close(); }
  }
});

test('the admitted early read uses the exact six-row query once and normal pagination continues at five', async () => {
  const h = harness();
  try {
    h.scope.reader.begin('A'); await tick();
    assert.equal(h.operations[0].p_limit, 6);
    h.scope.reader.admit('A'); await h.load({ reset: true });
    assert.equal(h.operations.length, 1, 'the normal loader consumes the matching early query');
    assert.equal(h.operations[0].executions, 1); assert.equal(h.scope.streamOffset, 5);
    await h.load(); assert.equal(h.operations[1].p_limit, 21); assert.equal(h.operations[1].p_offset, 5);
  } finally { h.close(); }
});

test('hydration failure does not consume offsets; a retry uses the same range and retains existing cards', async () => {
  const h = harness();
  try {
    await h.load({ reset: true });
    const originals = [...h.feed.children];
    h.setHydrate(async () => { throw Object.assign(new Error('Unavailable'), { code: '42501' }); });
    await h.load();
    assert.equal(h.scope.streamOffset, 5); assert.equal(h.scope.streamHasMore, true);
    assert.deepEqual(h.feed.children, originals);
    h.setHydrate(async page => page); await h.load();
    assert.deepEqual(h.operations.slice(1).map(row => row.p_offset), [5, 5]);
    assert.deepEqual(h.keys(), events(25).map(row => row.event_key));
    assert.equal(h.scope.streamOffset, 25);
    h.setHydrate(async () => { throw Object.assign(new Error('Unavailable'), { code: '42501' }); });
    await h.load({ reset: true });
    assert.equal(h.operations.at(-1).p_limit, 6, 'explicit refresh always re-queries fresh first data');
    assert.equal(h.scope.streamOffset, 25, 'failed retained refresh restores its previous pagination');
    assert.deepEqual(h.keys(), events(25).map(row => row.event_key));
  } finally { h.close(); }
});

test('refresh replaces stale records while pagination deduplicates repeated event keys without changing raw offsets', async () => {
  const dataset = events(30);
  const h = harness({ read(operation) {
    if (operation.p_offset === 5) return { data: [dataset[4], ...dataset.slice(5, 25)] };
    return { data: dataset.slice(0, 6) };
  } });
  try {
    await h.load({ reset: true }); await h.load();
    assert.equal(h.scope.streamOffset, 25, 'offset counts consumed RPC rows, including duplicates');
    assert.deepEqual(h.keys(), events(24).map(row => row.event_key));
    const previous = h.feed.children[0]; await h.load({ reset: true });
    assert.equal(h.operations.at(-1).p_offset, 0); assert.equal(h.scope.streamOffset, 5);
    assert.equal(h.feed.children.length, 5); assert.notEqual(h.feed.children[0], previous);
  } finally { h.close(); }
});

test('stale mode and owner results cannot commit first-five pagination or replace a newer feed', async () => {
  for (const transition of ['mode', 'owner']) {
    const slow = deferred(); const h = harness();
    try {
      h.setHydrate(() => slow.promise);
      const old = h.load({ reset: true }); await tick();
      assert.equal(h.scope.streamOffset, 0, 'offset is not committed during hydration');
      h.scope.streamRequest++; h.scope.streamLoading = false;
      if (transition === 'mode') h.scope.activeHomeFeed = 'following';
      else {
        h.scope.reader.auth('SIGNED_IN', { user: { id: 'B' } });
        h.scope.currentMemberId = 'B'; h.scope.currentMember = { id: 'B' };
      }
      h.setHydrate(async page => page); await h.load({ reset: true });
      const current = [...h.feed.children];
      slow.resolve(events(5)); await old;
      assert.deepEqual(h.feed.children, current); assert.equal(h.scope.streamOffset, 5);
      assert.equal(h.scope.streamLoading, false);
    } finally { h.close(); }
  }
});

test('canonical untransformed loader also uses five first, then twenty without changing order', async () => {
  const h = harness({ source: raw });
  try {
    await h.load({ reset: true }); await h.load();
    assert.deepEqual(h.operations.map(row => [row.p_offset, row.p_limit]), [[0, 6], [5, 21]]);
    assert.deepEqual(h.keys(), events(25).map(row => row.event_key));
  } finally { h.close(); }
});
