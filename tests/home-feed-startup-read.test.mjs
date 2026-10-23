import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHomeFeedStartupRead } from '../src/home-feed-startup-read.js';
import { transformMemberBootstrapResilienceSource } from '../scripts/member-bootstrap-resilience-source-transform.mjs';

const tick = () => new Promise(setImmediate);
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(options = {}) {
  let clock = 100000, sequence = 0;
  const value = { pathname: '/home', mode: 'for-you', requestEpoch: 0, memberId: '', recovery: false };
  const timers = new Map(), operations = [];
  const reader = createHomeFeedStartupRead({ context: () => value, now: () => clock,
    setTimer(callback, delay) { timers.set(++sequence, { callback, at: clock + delay }); return sequence; },
    clearTimer: (id) => timers.delete(id),
    request(input) {
      const gate = deferred(), operation = { ...input, gate, executions: 0 }; operations.push(operation);
      return { then(ok, fail) { operation.executions++; return gate.promise.then(ok, fail); } };
    }, ...options });
  reader.auth('INITIAL_SESSION', { user: { id: 'A' } });
  return { reader, value, operations, timers,
    admit(owner = 'A') { value.memberId = owner; reader.admit(owner); value.requestEpoch++; },
    take(extra = {}) { return reader.take({ ownerId: value.memberId, mode: value.mode, offset: 0,
      requestId: value.requestEpoch, reset: true, ...extra }); },
    async advance(ms) {
      clock += ms;
      for (let count = 0; count < 20; count++) {
        const next = [...timers].find(([, timer]) => timer.at <= clock);
        if (!next) break;
        timers.delete(next[0]); next[1].callback(); await tick();
      }
      await tick();
    },
  };
}

test('first Home RPC starts during admission and its one thenable result can be consumed only once after admission', async () => {
  const h = harness();
  h.reader.begin('A'); await tick();
  assert.equal(h.operations.length, 1); assert.equal(h.value.memberId, '');
  assert.equal(h.operations[0].mode, 'for-you'); assert.equal(h.operations[0].offset, 0);
  h.operations[0].gate.resolve({ data: [{ post_id: 'fresh' }], error: null }); await tick();
  assert.equal(h.operations[0].executions, 1);
  h.admit(); const result = h.take(); assert.equal(h.take(), null);
  assert.deepEqual(await result, { data: [{ post_id: 'fresh' }], error: null });
  assert.equal(h.operations.length, 1); assert.equal(h.timers.size, 0);
});

test('missing admission, wrong owner/mode/offset/request generation and non-reset loads discard the early result', async () => {
  for (const change of [
    h => { h.value.memberId = 'A'; h.value.requestEpoch = 1; },
    h => { h.admit(); h.value.memberId = 'B'; },
    h => { h.admit(); h.value.mode = 'following'; },
    h => { h.admit(); h.value.requestEpoch++; },
    h => { h.admit(); return { offset: 20 }; },
    h => { h.admit(); return { reset: false }; },
  ]) {
    const h = harness(); h.reader.begin('A'); await tick();
    const extra = change(h) || {};
    assert.equal(h.take(extra), null); assert.equal(h.operations[0].signal.aborted, true);
    h.operations[0].gate.resolve({ data: [{ post_id: 'late' }] }); await tick();
    assert.equal(h.take(), null);
  }
});

test('non-Home and recovery starts never fetch, while route changes abort both queued and consumed requests', async () => {
  for (const patch of [{ pathname: '/messages' }, { pathname: '/videos' }, { recovery: true }, { mode: 'short-videos' }, { hasFeed: true }]) {
    const h = harness(); Object.assign(h.value, patch);
    assert.equal(h.reader.begin('A'), null); await tick(); assert.equal(h.operations.length, 0);
  }
  const h = harness(); h.reader.begin('A'); await tick(); h.admit();
  let fresh = 0; const old = h.take({ requestFresh() { fresh++; return { data: [] }; } });
  h.value.pathname = '/messages'; h.reader.reconcile();
  await assert.rejects(old, { code: 'HOME_STARTUP_INVALIDATED' });
  assert.equal(h.operations[0].signal.aborted, true); assert.equal(fresh, 0);
});

test('auth generation changes abort A and no late result or fallback can enter B', async () => {
  for (const event of ['SIGNED_OUT', 'SIGNED_IN', 'PASSWORD_RECOVERY', 'TOKEN_REFRESHED']) {
    const h = harness(); h.reader.begin('A'); await tick(); h.admit();
    let fresh = 0; const old = h.take({ requestFresh() { fresh++; return { data: [] }; } });
    h.reader.auth(event, { user: { id: 'B' } }); h.value.memberId = 'B';
    await assert.rejects(old, { code: 'HOME_STARTUP_INVALIDATED' });
    h.operations[0].gate.resolve({ data: [{ post_id: 'A-private' }] }); await tick();
    assert.equal(fresh, 0); assert.equal(h.take(), null); assert.equal(h.operations[0].signal.aborted, true);
  }
});

test('SIGNED_IN for B cannot use fresh fallback while member admission still displays A', async () => {
  const h = harness(); h.reader.begin('A'); await tick(); h.admit();
  const authorization = h.reader.authorization('A');
  let fresh = 0; const old = h.take({ requestFresh() { fresh++; return { data: [{ post_id: 'B-under-A' }] }; } });
  h.reader.auth('SIGNED_IN', { user: { id: 'B' } });
  assert.equal(h.value.memberId, 'A', 'B admission deliberately has not updated the presentation owner');
  assert.equal(h.reader.isCurrentAuthorization(authorization), false);
  assert.equal(h.reader.authorization('A'), null);
  await assert.rejects(old, { code: 'HOME_STARTUP_INVALIDATED' });
  assert.equal(fresh, 0);
  h.operations[0].gate.resolve({ data: [{ post_id: 'A-late' }] }); await tick();
  assert.equal(fresh, 0);
});

test('unchanged INITIAL_SESSION and token refresh retain the read, but a new sign-in always revalidates admission', async () => {
  const h = harness(); h.reader.begin('A'); await tick();
  h.reader.auth('INITIAL_SESSION', { user: { id: 'A' } });
  h.reader.auth('TOKEN_REFRESHED', { user: { id: 'A' } });
  assert.equal(h.operations[0].signal.aborted, false);
  h.reader.auth('SIGNED_IN', { user: { id: 'A' } });
  assert.equal(h.operations[0].signal.aborted, true, 'same-session SIGNED_IN reuse is deliberately outside this optimization');
  assert.equal(h.take(), null);
});

test('expired taken reads immediately use a fresh normal RPC for the still-current request instead of returning null data', async () => {
  const h = harness({ requestTimeoutMs: 20000 }); h.reader.begin('A'); await tick(); h.admit();
  let fresh = 0; const result = h.take({ requestFresh() { fresh++; return { data: [{ post_id: 'newer' }], error: null }; } });
  await h.advance(10000);
  assert.deepEqual(await result, { data: [{ post_id: 'newer' }], error: null });
  assert.equal(fresh, 1); assert.equal(h.operations[0].signal.aborted, true);
  h.operations[0].gate.resolve({ data: [{ post_id: 'expired' }] }); await tick(); assert.equal(fresh, 1);
});

test('failed and timed-out early reads settle safely and are never replayed by a later normal retry', async () => {
  const h = harness(); h.reader.begin('A'); await tick();
  const failure = new Error('temporary read failure'); h.operations[0].gate.reject(failure); await tick();
  h.admit(); await assert.rejects(h.take(), error => error === failure);
  assert.equal(h.take(), null, 'the next retry must execute its normal fresh RPC factory');
  assert.equal(h.operations[0].executions, 1);
  const timed = harness(); timed.reader.begin('A'); await tick(); await timed.advance(5000);
  assert.equal(timed.operations[0].signal.aborted, true);
  timed.admit(); assert.equal(timed.take(), null); timed.reader.invalidate(); assert.equal(timed.timers.size, 0);
});

test('cancelling an old admission token cannot cancel a newer owner read', async () => {
  const h = harness(); const old = h.reader.begin('A'); await tick();
  h.reader.auth('SIGNED_IN', { user: { id: 'B' } }); h.reader.begin('B'); await tick();
  h.reader.invalidate(old); assert.equal(h.operations[1].signal.aborted, false);
  h.admit('B'); h.operations[1].gate.resolve({ data: [{ post_id: 'B' }] });
  assert.deepEqual(await h.take(), { data: [{ post_id: 'B' }] });
});

test('transformed member entry begins early while existing account/social admission remains authoritative', async () => {
  const source = transformMemberBootstrapResilienceSource('/repo/src/app.js',
    await readFile(new URL('../src/app.js', import.meta.url), 'utf8'));
  const start = source.indexOf('async function loadMemberOnce(user) {');
  const end = source.indexOf('\nasync function completeOnboarding', start);
  for (const admitted of [true, false]) {
    const h = harness(), account = deferred(), social = deferred(), rendered = [];
    const scope = { currentMember: null, currentMemberId: '', currentAccountEmail: '', memberLoadPromise: null,
      memberLoadUserId: '', MEMBER_BOOT_TIMEOUT_MS: 4500, initialHomeFeedRead: h.reader,
      normalizeEmail: value => value, normalizeUsername: value => value, syncAccountSecurityEmail() {},
      resilientRead: async factory => { const result = await factory(); if (result?.error) throw result.error; return result; },
      supabase: { from(table) { return { select() { return this; }, eq() { return this; },
        maybeSingle() { return (table === 'account_profiles' ? account : social).promise; } }; } },
      renderMember(profile, owner) { scope.currentMember = profile; scope.currentMemberId = owner; h.admit(owner); rendered.push(profile); },
      memberFallbackProfile: () => null, showSignupRequirements: async () => true,
      cacheMemberProfile() {}, loadDeletionRequestState: async () => {}, applyLocationRoute: async () => {},
    };
    vm.createContext(scope); vm.runInContext(source.slice(start, end) + '\nthis.load = loadMember;', scope);
    const pending = scope.load({ id: 'A', email: 'a@example.test' }); await tick();
    assert.equal(h.operations.length, 1, 'the RPC must begin while both profile reads are still blocked');
    h.operations[0].gate.resolve({ data: [{ post_id: 'fresh' }] }); await tick(); assert.equal(rendered.length, 0);
    social.resolve({ data: { id: 'A', username: 'a' } }); await tick(); assert.equal(rendered.length, 0);
    account.resolve({ data: admitted ? { username: 'a' } : null }); await pending;
    assert.equal(rendered.length, admitted ? 1 : 0);
    if (admitted) assert.deepEqual(await h.take(), { data: [{ post_id: 'fresh' }] });
    else { assert.equal(h.take(), null); assert.equal(h.operations[0].signal.aborted, true); }
  }
});

async function flowHarness() {
  const source = transformMemberBootstrapResilienceSource('/repo/src/app.js',
    await readFile(new URL('../src/app.js', import.meta.url), 'utf8'));
  const operations = [], rendered = [], nodes = new Map(); let credentialOwner = 'A';
  const feed = { childElementCount: 0, clears: 0, replaceChildren() { this.clears++; this.childElementCount = 0; } };
  const scope = { currentMember: { id: 'A' }, currentMemberId: 'A', activeHomeFeed: 'for-you',
    streamLoading: false, streamRequest: 0, streamOffset: 0, streamCursor: null, streamHasMore: false,
    memberLoadPromise: null, memberLoadUserId: '', recoverySession: false,
    MEMBER_BOOT_TIMEOUT_MS: 4500, READ_RETRY_ATTEMPTS: 3, READ_RETRY_TIMEOUT_MS: 5000, READ_RETRY_DELAYS_MS: [0, 1, 1],
    STREAM_PAGE_SIZE: 20, HOME_FEED_COPY: { 'for-you': { rpcMode: 'for_you' } },
    window: { setTimeout, clearTimeout }, syncHomeFeedModeUi() {}, clearHomeFeedMediaState() {},
    byId(id) { if (id === 'stream-feed') return feed; if (!nodes.has(id)) nodes.set(id, { hidden: true }); return nodes.get(id); },
    hydrateStreamEvents: async rows => rows,
    renderStreamRows(rows) { rendered.push(...rows); feed.childElementCount = rows.length; },
    supabase: { rpc() {
      const operation = { credentialOwner, gate: deferred(), executions: 0 }; operations.push(operation);
      return { abortSignal(signal) { operation.signal = signal; return this; },
        then(ok, fail) { operation.executions++; return operation.gate.promise.then(ok, fail); } };
    } },
  };
  const reader = createHomeFeedStartupRead({
    request: ({ signal }) => scope.supabase.rpc().abortSignal(signal),
    context: () => ({ pathname: '/home', mode: scope.activeHomeFeed, requestEpoch: scope.streamRequest,
      memberId: scope.currentMemberId, recovery: scope.recoverySession, hasFeed: feed.childElementCount > 0 }),
  });
  reader.auth('INITIAL_SESSION', { user: { id: 'A' } }); scope.initialHomeFeedRead = reader;
  vm.createContext(scope);
  const utilities = source.slice(source.indexOf('function memberBootWithTimeout('), source.indexOf('function refreshMemberProfileAfterFallback('));
  const loader = source.slice(source.indexOf('async function loadStream({ reset = false } = {})'), source.indexOf('\nfunction sautiCardsForPost'));
  const reset = source.slice(source.indexOf('function resetStreamState() {'), source.indexOf('\nfunction syncHomeFeedModeUi'));
  const member = source.slice(source.indexOf('async function loadMember(user) {'), source.indexOf('\nasync function completeOnboarding'));
  const panelStart = source.indexOf('function showAuthPanel(name) {');
  const panelGuard = source.slice(panelStart, source.indexOf('  document.body.classList.add', panelStart)) + '}';
  vm.runInContext(utilities + '\n' + reset + '\n' + loader + '\n' + member + '\n' + panelGuard
    + '\nthis.loadStream = loadStream; this.loadMember = loadMember; this.withdrawAdmission = showAuthPanel;', scope);
  return { scope, reader, operations, rendered, feed, nodes,
    auth(owner) { credentialOwner = owner; return reader.auth('SIGNED_IN', { user: { id: owner } }); },
    close() { reader.invalidate(); },
  };
}

test('the actual transformed retry flow never retries an invalidated taken read with new credentials under old presentation', async () => {
  const h = await flowHarness();
  try {
    h.reader.begin('A'); h.reader.admit('A');
    const pending = h.scope.loadStream({ reset: true }); await tick();
    assert.equal(h.operations.length, 1); assert.equal(h.scope.streamLoading, true);
    h.auth('B');
    assert.equal(h.scope.currentMemberId, 'A');
    await pending;
    assert.equal(h.operations.length, 1, 'HOME_STARTUP_INVALIDATED must not reach the normal retry factory');
    assert.equal(h.rendered.length, 0); assert.equal(h.nodes.get('stream-error').hidden, true);
    h.operations[0].gate.resolve({ data: [{ post_id: 'A-late' }] }); await tick();
    assert.equal(h.rendered.length, 0);
  } finally { h.close(); }
});

test('auth generation is checked after both normal RPC and hydration even before presentation owner changes', async () => {
  for (const stage of ['rpc', 'hydration']) {
    const h = await flowHarness(), hydration = deferred();
    try {
      h.scope.hydrateStreamEvents = () => hydration.promise;
      const pending = h.scope.loadStream({ reset: true }); await tick();
      if (stage === 'hydration') { h.operations[0].gate.resolve({ data: [{ post_id: 'A' }] }); await tick(); }
      h.auth('B');
      if (stage === 'rpc') h.operations[0].gate.resolve({ data: [{ post_id: 'B-under-A' }] });
      hydration.resolve([{ post_id: 'A-late' }]); await pending;
      assert.equal(h.rendered.length, 0); assert.equal(h.operations.length, 1);
    } finally { h.close(); }
  }
});

test('B resets the loading latch and loads before A settles, while late A cannot clear or replace B', async () => {
  const h = await flowHarness(), admission = deferred();
  try {
    const old = h.scope.loadStream({ reset: true }); await tick();
    assert.equal(h.scope.streamLoading, true); const oldRequest = h.scope.streamRequest;
    h.auth('B');
    h.scope.loadMemberOnce = async user => {
      await admission.promise;
      h.scope.currentMember = { id: user.id }; h.scope.currentMemberId = user.id;
      h.reader.admit(user.id);
      h.scope.newFeed = h.scope.loadStream({ reset: true });
    };
    const member = h.scope.loadMember({ id: 'B' }); await tick();
    assert.equal(h.scope.streamLoading, false, 'owner transition must release A latch before B admission');
    assert.ok(h.scope.streamRequest > oldRequest); assert.equal(h.operations.length, 2);
    admission.resolve(); await member; await tick();
    assert.equal(h.scope.streamLoading, true);
    h.operations[1].gate.resolve({ data: [{ post_id: 'B' }] }); await h.scope.newFeed;
    assert.deepEqual(h.rendered, [{ post_id: 'B' }]); assert.equal(h.scope.streamLoading, false);
    const clears = h.feed.clears;
    h.operations[0].gate.resolve({ data: [{ post_id: 'A-late' }] }); await old;
    assert.deepEqual(h.rendered, [{ post_id: 'B' }]); assert.equal(h.feed.clears, clears);
    assert.equal(h.scope.streamLoading, false);
  } finally { h.close(); }
});

test('same-owner member admission preserves rendered Home DOM', async () => {
  const h = await flowHarness();
  try {
    h.feed.childElementCount = 1; h.scope.loadMemberOnce = async () => {};
    await h.scope.loadMember({ id: 'A' });
    assert.equal(h.feed.clears, 0); assert.equal(h.feed.childElementCount, 1); assert.equal(h.operations.length, 0);
  } finally { h.close(); }
});

test('auth-panel admission withdrawal cancels a taken request without a same-owner fresh fallback', async () => {
  const h = await flowHarness();
  try {
    h.reader.begin('A'); h.reader.admit('A');
    const pending = h.scope.loadStream({ reset: true }); await tick();
    h.scope.withdrawAdmission('onboarding');
    await pending;
    assert.equal(h.scope.currentMemberId, 'A'); assert.equal(h.scope.streamLoading, false);
    assert.equal(h.operations.length, 1); assert.equal(h.rendered.length, 0);
    assert.equal(h.operations[0].signal.aborted, true);
  } finally { h.close(); }
});

test('a late profile admission cannot replace the recovery UI or render a previous auth owner', async () => {
  const source = transformMemberBootstrapResilienceSource('/repo/src/app.js',
    await readFile(new URL('../src/app.js', import.meta.url), 'utf8'));
  const start = source.indexOf('function renderMember(profile, userId = currentMemberId) {');
  const end = source.indexOf('\nasync function loadMemberOnce', start);
  const h = harness();
  const scope = { currentMemberId: 'A', recoverySession: true, initialHomeFeedRead: h.reader,
    document: { body: { classList: { remove() { throw Error('member-shell-revealed'); } } } } };
  vm.createContext(scope); vm.runInContext(source.slice(start, end) + '\nthis.render = renderMember;', scope);
  scope.render({ id: 'A' }, 'A');
  scope.recoverySession = false; h.reader.auth('SIGNED_IN', { user: { id: 'B' } });
  scope.render({ id: 'A' }, 'A');
  assert.throws(() => scope.render({ id: 'B' }, 'B'), /member-shell-revealed/, 'a valid non-recovery admission still reaches its normal renderer');
  h.reader.invalidate();
});
