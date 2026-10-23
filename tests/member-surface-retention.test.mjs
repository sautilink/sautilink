import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createMemberSurfaceRetention } from '../src/member-surface-retention.js';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';
import { transformMemberBootstrapResilienceSource } from '../scripts/member-bootstrap-resilience-source-transform.mjs';

const raw = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const path = '/repo/src/app.js';
const transformed = transformMemberBootstrapResilienceSource(path,
  transformMediaPerformanceSource(path, transformPostMediaSource(path, raw)));
function block(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing runtime block: ${start}`);
  return source.slice(a, b);
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const flush = () => new Promise(setImmediate);
function nodes() {
  const map = new Map();
  const byId = (id) => {
    if (!map.has(id)) map.set(id, {
      children: [], hidden: false, value: '', disabled: false,
      get childElementCount() { return this.children.length; },
      replaceChildren(...children) { this.children = children; },
      append(child) { this.children.push(child); },
    });
    return map.get(id);
  };
  return { map, byId };
}
function supabaseFor(read) {
  return { from(table) {
    const chain = new Proxy({}, { get(_target, name) {
      if (name === 'then') return (resolve, reject) => Promise.resolve(read(table)).then(resolve, reject);
      return () => chain;
    } });
    return chain;
  } };
}
function context(extra = {}) {
  const dom = nodes();
  return vm.createContext({
    currentMember: { username: 'owner' }, currentMemberId: 'owner', activeHomeFeed: 'for-you',
    memberSurfaceRetention: createMemberSurfaceRetention(), ...dom,
    notificationsRequest: 0, discoverRequest: 0, savedRequest: 0, messagesRequest: 0,
    byId: dom.byId, normalizeDiscoverQuery: (value) => value.trim(),
    renderNotificationItem: (row) => ({ id: row.id }),
    renderDiscoverProfile: (row) => ({ id: row.id }),
    THREAD_POST_SELECT: 'id,author_id',
    createSautiCard: (row) => ({ id: row.id }), hydrateDirectPosts: async (rows) => rows,
    syncNotificationBadges() {}, syncMessageBadges() {}, messageBadgesEnabled: () => true,
    window: { location: { href: 'https://sautilink.com/home', pathname: '/home', search: '' },
      history: { pushState() {} }, dispatchEvent() {} }, URL, Event,
    ...extra,
  });
}

function navigationContext(extra = {}) {
  const surfaces = Object.fromEntries(['stream', 'notifications', 'circles', 'messages', 'discover', 'saved',
    'appeals', 'moderation', 'conversation', 'settings', 'menu', 'profile']
    .map((name) => [`${name}Surface`, { hidden: name !== 'stream' }]));
  return context({ ...surfaces,
    memberCommentSheet: null, dmThreadSyncRequest: 0, activeConversation: null, dmConversationRealtimeChannel: null,
    disposeDmTimeline() {}, stopDmPeerActivityPresence() {}, stopDmConversationRealtime() {}, pauseHomeFeedVideos() {},
    closeProfileEditor() {}, syncHomeFeedModeUi() {}, syncHomeFeedVideoPlayback() {},
    loadMessagesInbox() {}, loadNotifications() {}, messagePath: () => '/messages',
    viewTitle: {}, document: { querySelectorAll: () => [] }, ...extra,
  });
}

test('presentation freshness is bounded, owner/context scoped, invalidatable, and never records content', () => {
  let now = 1000;
  const policy = createMemberSurfaceRetention({ now: () => now });
  assert.equal(policy.isFresh('stream', 'owner', 'for-you'), false);
  policy.completed('stream', 'owner', 'for-you');
  now += 1000;
  assert.equal(policy.isFresh('stream', 'owner', 'for-you'), true);
  assert.equal(policy.isFresh('stream', 'another', 'for-you'), false);
  assert.equal(policy.isFresh('stream', 'owner', 'following'), false);
  now += 29000;
  assert.equal(policy.isFresh('stream', 'owner', 'for-you'), false);
  assert.equal(policy.owns('stream', 'owner', 'for-you'), true, 'stale DOM may stay visible during a fresh read');
  policy.invalidate();
  assert.equal(policy.owns('stream', 'owner', 'for-you'), false);
  policy.completed('stream', '', 'for-you');
  assert.equal(policy.owns('stream', '', 'for-you'), false);
});

test('absence freshness needs a previously rendered matching owner/context and expires without extending it', () => {
  let now = 1000;
  const policy = createMemberSurfaceRetention({ now: () => now });
  policy.completed('stream', 'owner', 'for-you');
  now += 300000;
  policy.left('stream', 'another', 'for-you');
  policy.left('stream', 'owner', 'following');
  assert.equal(policy.isFresh('stream', 'owner', 'for-you'), false);
  policy.left('stream', 'owner', 'for-you');
  assert.equal(policy.isFresh('stream', 'owner', 'for-you'), true);
  assert.equal(policy.isFresh('stream', 'another', 'for-you'), false);
  assert.equal(policy.isFresh('stream', 'owner', 'following'), false);
  now += 30000;
  assert.equal(policy.isFresh('stream', 'owner', 'for-you'), false);
  policy.invalidate('stream');
  policy.left('stream', 'owner', 'for-you');
  assert.equal(policy.isFresh('stream', 'owner', 'for-you'), false, 'leaving cannot manufacture an unrendered snapshot');
});

for (const [label, source] of [['source', raw], ['built transform', transformed]]) {
  test(`${label}: a five-minute-old Home still retains its exact player after a one-second trip to Messages`, () => {
    let now = 1000, reads = 0, h;
    const policy = createMemberSurfaceRetention({ now: () => now });
    h = navigationContext({ memberSurfaceRetention: policy, loadStream: () => {
      reads++; h.byId('stream-feed').replaceChildren();
    } });
    vm.runInContext(block(source, 'function setMemberNavigation(', 'function memberProfilePath('), h);
    vm.runInContext(block(source, 'function showMemberSurface(', 'function showProfileRouteState('), h);
    const player = { currentTime: 3.71, readyState: 4 };
    h.byId('stream-feed').append(player);
    policy.completed('stream', 'owner', 'for-you');
    now += 300000;
    vm.runInContext("showMemberSurface('messages')", h);
    now += 1000;
    vm.runInContext("showMemberSurface('stream')", h);
    assert.equal(reads, 0, 'navigation grace must measure absence, not how long the member watched Home');
    assert.equal(h.byId('stream-feed').children[0], player);
    assert.equal(player.currentTime, 3.71);
    assert.equal(player.readyState, 4);
  });

  test(`${label}: navigation between away screens cannot prolong the Home return grace`, () => {
    let now = 1000, reads = 0;
    const policy = createMemberSurfaceRetention({ now: () => now });
    const h = navigationContext({ memberSurfaceRetention: policy, loadStream: () => { reads++; } });
    vm.runInContext(block(source, 'function setMemberNavigation(', 'function memberProfilePath('), h);
    vm.runInContext(block(source, 'function showMemberSurface(', 'function showProfileRouteState('), h);
    policy.completed('stream', 'owner', 'for-you');
    now += 300000;
    vm.runInContext("showMemberSurface('messages')", h);
    now += 25000;
    vm.runInContext("showMemberSurface('notifications')", h);
    now += 6000;
    vm.runInContext("showMemberSurface('stream')", h);
    assert.equal(reads, 1, 'Home was absent for 31 seconds despite the last away-screen change being six seconds ago');
  });

  test(`${label}: feed commits mark presentation, clearing media invalidates it, and empty feeds remain fresh`, () => {
    const h = context({ streamHasMore: false, homeMediaOpenTimers: new Map(),
      homeDoubleTapState: null, homeVideoObserver: null, homeVideoVisibility: new Map(),
      pauseHomeFeedVideos() {}, revokeHomeFeedMediaObjectUrls() {}, window: { clearTimeout() {} } });
    vm.runInContext(block(source, 'function clearHomeFeedMediaState(', 'async function hydrateSautiMediaGallery('), h);
    vm.runInContext(block(source, 'function renderStreamRows(', 'async function loadQuotedPostMap('), h);
    vm.runInContext("renderStreamRows([{id:'post'}], {reset:true})", h);
    assert.equal(h.memberSurfaceRetention.isFresh('stream', 'owner', 'for-you'), true);
    vm.runInContext('clearHomeFeedMediaState()', h);
    assert.equal(h.memberSurfaceRetention.isFresh('stream', 'owner', 'for-you'), false);
    vm.runInContext('renderStreamRows([], {reset:true})', h);
    assert.equal(h.memberSurfaceRetention.isFresh('stream', 'owner', 'for-you'), true);
    assert.equal(h.byId('stream-empty').hidden, false);
  });

  test(`${label}: immediate Home return keeps its DOM and player; stale or changed-owner/mode navigation reads again`, () => {
    let now = 1000, reads = 0;
    const policy = createMemberSurfaceRetention({ now: () => now });
    const h = context({ memberSurfaceRetention: policy, loadStream: () => { reads++; },
      setMemberNavigation() {}, closeProfileEditor() {}, syncHomeFeedModeUi() {}, syncHomeFeedVideoPlayback() {} });
    vm.runInContext(block(source, 'function showMemberSurface(', 'function showProfileRouteState('), h);
    const player = { currentTime: 12, source: 'same-mounted-source' };
    h.byId('stream-feed').append(player);
    policy.completed('stream', 'owner', 'for-you');
    now += 1000;
    vm.runInContext("showMemberSurface('stream')", h);
    assert.equal(reads, 0);
    assert.equal(h.byId('stream-feed').children[0], player);
    assert.equal(player.currentTime, 12);
    now += 29000;
    vm.runInContext("showMemberSurface('stream')", h);
    assert.equal(reads, 1);
    policy.completed('stream', 'owner', 'for-you');
    h.activeHomeFeed = 'following';
    vm.runInContext("showMemberSurface('stream')", h);
    assert.equal(reads, 2);
    h.activeHomeFeed = 'for-you'; h.currentMemberId = 'another';
    vm.runInContext("showMemberSurface('stream')", h);
    assert.equal(reads, 3);
  });

  test(`${label}: notifications retain owned rows during a read, replace fresh results, and clear on denial/account change`, async () => {
    let result = { data: [{ id: 'old', read_at: null }] };
    const h = context({ supabase: supabaseFor(() => result) });
    vm.runInContext(block(source, 'async function loadNotifications(', 'async function markNotificationRead('), h);
    await vm.runInContext('loadNotifications()', h);
    const list = h.byId('notifications-list'), old = list.children[0];
    const waiting = deferred(); result = waiting.promise;
    const pending = vm.runInContext('loadNotifications()', h);
    assert.equal(list.children[0], old);
    assert.equal(h.byId('notifications-loading').hidden, true);
    waiting.resolve({ data: [{ id: 'new', read_at: 'read' }] }); await pending;
    assert.deepEqual(list.children.map((row) => row.id), ['new']);
    result = { error: { code: '42501' } }; await vm.runInContext('loadNotifications()', h);
    assert.equal(list.childElementCount, 0);
    result = { data: [{ id: 'owned' }] }; await vm.runInContext('loadNotifications()', h);
    h.currentMemberId = 'another'; const other = deferred(); result = other.promise;
    const pendingOther = vm.runInContext('loadNotifications()', h);
    assert.equal(list.childElementCount, 0, 'another owner cannot inherit the old rows');
    other.resolve({ data: [] }); await pendingOther;
  });

  test(`${label}: Saved keeps existing posts while checking fresh access; successful empty results remove them`, async () => {
    let result = { data: [{ post_id: 'post' }] };
    const h = context({ supabase: supabaseFor((table) => table === 'social_saved_posts' ? result : { data: [{ id: 'post' }] }) });
    vm.runInContext(block(source, 'async function loadSavedSauti(', 'function readSharedSautiTarget('), h);
    await vm.runInContext('loadSavedSauti()', h);
    const list = h.byId('saved-sauti-feed'), old = list.children[0], waiting = deferred();
    result = waiting.promise;
    const pending = vm.runInContext('loadSavedSauti()', h);
    assert.equal(list.children[0], old);
    assert.equal(h.byId('saved-loading').hidden, true);
    waiting.resolve({ data: [] }); await pending;
    assert.equal(list.childElementCount, 0);
    assert.equal(h.byId('saved-empty').hidden, false);
  });

  test(`${label}: Discover retains only the same query and commits profiles/posts after complete hydration`, async () => {
    let held;
    const h = context({ supabase: supabaseFor((table) => {
      if (table === 'social_blocks') return held || { data: [] };
      if (table === 'social_profiles') return { data: [{ id: 'profile' }] };
      if (table === 'social_posts') return { data: [{ id: 'post' }] };
      return { data: [] };
    }) });
    vm.runInContext(block(source, 'async function loadDiscover(', 'async function loadSavedSauti('), h);
    await vm.runInContext("loadDiscover('')", h);
    const list = h.byId('discover-sauti-feed'), old = list.children[0], waiting = deferred();
    held = waiting.promise;
    const pending = vm.runInContext("loadDiscover('')", h);
    assert.equal(list.children[0], old);
    assert.equal(h.byId('discover-loading').hidden, true);
    waiting.resolve({ data: [] }); await pending;
    assert.equal(list.childElementCount, 1);
    const changed = deferred(); held = changed.promise;
    const search = vm.runInContext("loadDiscover('new query')", h);
    assert.equal(list.childElementCount, 0);
    assert.equal(h.byId('discover-loading').hidden, false);
    changed.resolve({ data: [] }); await search;
  });

  test(`${label}: Discover searches latest public posts without rankings and excludes blocked/muted authors`, async () => {
    const calls = [];
    const h = context({ supabase: { from(table) {
      const chain = new Proxy({}, { get(_target, name) {
        if (name === 'then') return (resolve) => resolve({ data: table === 'social_blocks' ? [{ blocked_id: 'blocked' }]
          : table === 'social_mutes' ? [{ muted_id: 'muted' }]
          : table === 'social_posts' ? [{ id: 'latest', author_id: 'visible' }, { id: 'hidden-b', author_id: 'blocked' },
            { id: 'hidden-m', author_id: 'muted' }, { id: 'older', author_id: 'visible' }] : [] });
        return (...args) => { if (table === 'social_posts') calls.push([name, ...args]); return chain; };
      } });
      return chain;
    } } });
    vm.runInContext(block(source, 'async function loadDiscover(', 'async function loadSavedSauti('), h);
    await vm.runInContext("loadDiscover('caption')", h);
    assert.deepEqual(h.byId('discover-sauti-feed').children.map((row) => row.id), ['latest', 'older']);
    for (const [name, column, value] of [['eq', 'visibility', 'public'], ['is', 'circle_id', null],
      ['is', 'reply_to_post_id', null], ['eq', 'post_status', 'published'], ['is', 'deleted_at', null],
      ['ilike', 'body', '%caption%']]) {
      assert.ok(calls.some((call) => call[0] === name && call[1] === column && call[2] === value));
    }
    const orders = calls.filter((call) => call[0] === 'order');
    assert.deepEqual(orders.map((call) => call[1]), ['created_at', 'id']);
    assert.ok(orders.every((call) => call[2].ascending === false));
    assert.ok(calls.some((call) => call[0] === 'limit' && call[1] === 30));
    assert.ok(!calls.some((call) => call[0] === 'gte'), 'older public posts remain discoverable');
  });

  test(`${label}: inbox retains rows during a current read and still replaces updates`, async () => {
    let result = [{ conversation_id: 'old' }];
    const h = context({
      dmThreadSyncRequest: 0, activeConversation: null, messagesSurface: { hidden: false },
      disposeDmTimeline() {}, stopDmConversationRealtime: async () => {}, stopDmPeerActivityPresence: async () => {},
      setMessageSearchLoading() {}, setMessage() {}, filterMessageInbox() {},
      getDmInboxRows: async () => result,
      supabase: supabaseFor(() => ({ data: [] })), renderMessageInboxItem: (row) => ({ id: row.conversation_id }),
    });
    vm.runInContext(block(source, 'async function loadMessagesInbox(', 'function renderDirectMessage('), h);
    await vm.runInContext('loadMessagesInbox()', h);
    const list = h.byId('messages-inbox-list'), old = list.children[0], waiting = deferred();
    result = waiting.promise;
    const pending = vm.runInContext('loadMessagesInbox()', h);
    await flush();
    assert.equal(list.children[0], old);
    assert.equal(h.byId('messages-loading').hidden, true);
    waiting.resolve([{ conversation_id: 'new' }]); await pending;
    assert.deepEqual(list.children.map((row) => row.id), ['new']);
  });
}

test('explicit Home refresh still performs the normal fresh query even inside the navigation freshness window', async () => {
  const waiting = deferred();
  let reads = 0, commits = 0;
  const h = context({ streamLoading: false, streamRequest: 0, streamCursor: null, streamOffset: 0,
    streamHasMore: false, STREAM_PAGE_SIZE: 20, HOME_FEED_COPY: { 'for-you': { rpcMode: 'for_you' } },
    syncHomeFeedModeUi() {}, clearHomeFeedMediaState() {},
    resilientRead: (operation) => operation(), READ_RETRY_ATTEMPTS: 3, READ_RETRY_TIMEOUT_MS: 8000,
    supabase: { rpc() { reads++; return waiting.promise; } }, hydrateStreamEvents: async (rows) => rows,
    renderStreamRows: (_rows, options) => { commits++; assert.equal(options.reset, true); } });
  h.byId('stream-feed').append({ id: 'existing' });
  h.memberSurfaceRetention.completed('stream', 'owner', 'for-you');
  vm.runInContext(block(transformed, 'async function loadStream(', 'function sautiCardsForPost('), h);
  const pending = vm.runInContext('loadStream({reset:true})', h);
  assert.equal(reads, 1);
  assert.equal(h.byId('stream-feed').childElementCount, 1, 'the old feed stays mounted while revalidating');
  waiting.resolve({ data: [] }); await pending;
  assert.equal(commits, 1);
});
