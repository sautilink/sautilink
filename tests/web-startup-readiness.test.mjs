import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { stampProductionUiAssets, contentHash } from '../scripts/stamp-production-ui-assets.mjs';
import { verifyProductionUiAssetHashes } from '../scripts/verify-production-ui-asset-hashes.mjs';
import { transformMemberBootstrapResilienceSource } from '../scripts/member-bootstrap-resilience-source-transform.mjs';
import { transformRuntimePerformanceSource } from '../scripts/runtime-performance-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function workerHarness({ responseFactory, cachePutGate, onCachePut = () => {} } = {}) {
  const handlers = {}, stored = new Map(), fetches = [], precached = [];
  let networkDown = false;
  const key = (request) => typeof request === 'string' ? request : request.url;
  const cache = { match: async (request) => stored.get(key(request))?.clone(),
    put: async (request, response) => {
      onCachePut();
      if (cachePutGate) await cachePutGate;
      stored.set(key(request), response.clone());
    },
    add: async (url) => precached.push(url) };
  vm.runInNewContext(await read('sw.js'), {
    self: { location: { origin: 'https://sautilink.com' }, skipWaiting() {}, addEventListener: (type, fn) => { handlers[type] = fn; } },
    URL, URLSearchParams, Response, Set, Promise, crypto: webcrypto,
    caches: { open: async () => cache, match: cache.match },
    fetch: async (request, options) => {
      fetches.push({ url: key(request), options });
      if (networkDown) throw new Error('offline');
      return responseFactory ? responseFactory()
        : new Response('public code', { status: 200, headers: { 'Content-Type': 'application/javascript' } });
    },
  });
  return { stored, fetches, precached, offline() { networkDown = true; },
    async install() { let pending; handlers.install({ waitUntil(value) { pending = value; } }); await pending; },
    dispatch(path, { mode = 'cors' } = {}) {
      const pending = [], request = { url: new URL(path, 'https://sautilink.com').href, method: 'GET', mode };
      let response;
      handlers.fetch({ request, respondWith: (value) => { response = Promise.resolve(value); }, waitUntil: (value) => pending.push(value) });
      return { response, pending };
    },
    async get(path, { mode = 'cors' } = {}) {
    const { response, pending } = this.dispatch(path, { mode });
    const result = await response;
    await Promise.all(pending);
    return result;
  } };
}

test('warm versioned app code reuses only the exact public asset URL', async () => {
  const harness = await workerHarness();
  const version = contentHash('public code');
  const asset = `/app/assets/app.js?v=${version}`;
  assert.equal(await (await harness.get(asset)).text(), 'public code');
  assert.equal(await (await harness.get(asset)).text(), 'public code');
  assert.equal(harness.fetches.length, 1, 'second page open must not refetch identical code');
  await harness.get('/app/assets/app.js?v=abcdef012345');
  await harness.get(`/app/assets/app.js?v=${version}&release=other`);
  assert.equal(harness.fetches.length, 3, 'different release URLs cannot borrow another response');
});

test('cold code headers stream before delayed body validation and cache disk writes finish', async () => {
  const disk = deferred(), putStarted = deferred();
  let releaseBody, timeout, released = false;
  const h = await workerHarness({ cachePutGate: disk.promise, onCachePut: putStarted.resolve,
    responseFactory: () => new Response(new ReadableStream({ start(controller) {
      releaseBody = () => {
        if (released) return;
        released = true;
        controller.enqueue(new TextEncoder().encode('public code'));
        controller.close();
      };
    } }), { status: 200, headers: { 'Content-Type': 'application/javascript' } }) });
  const event = h.dispatch(`/app/assets/app.js?v=${contentHash('public code')}`);
  let backgroundDone = false;
  const background = Promise.all(event.pending).then(() => { backgroundDone = true; });
  try {
    const response = await Promise.race([event.response, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('headers waited for body validation')), 250);
    })]);
    clearTimeout(timeout);
    assert.equal(response.status, 200);
    assert.equal(released, false, 'headers must arrive before any body chunk');
    assert.equal(h.stored.size, 0);
    assert.equal(backgroundDone, false);
    releaseBody();
    assert.equal(await response.text(), 'public code');
    await putStarted.promise;
    assert.equal(h.stored.size, 0, 'delivery must not await disk persistence');
    assert.equal(backgroundDone, false, 'waitUntil retains ongoing validation/persistence');
    disk.resolve();
    await background;
    assert.equal(h.stored.size, 1);
    assert.equal(h.fetches.length, 1, 'delivery and validation must share a single fetch');
  } finally {
    clearTimeout(timeout);
    releaseBody?.();
    disk.resolve();
    await background;
  }
});

test('installed UI cache retains exact version offline without precaching legacy duplicates', async () => {
  const h = await workerHarness();
  await h.install();
  assert.ok(h.precached.includes('/app/'), 'offline HTML shell remains installed');
  assert.ok(h.precached.every((url) => !url.startsWith('/app/assets/')), 'install must not duplicate page core downloads');
  const path = `/app/assets/vendor/hls-1.7.3.min.js?v=${contentHash('public code')}`;
  await h.get(path);
  h.offline();
  assert.equal(await (await h.get(path)).text(), 'public code');
  assert.equal(h.fetches.length, 1);
});

test('a mismatched content version cannot poison a future immutable asset URL', async () => {
  const h = await workerHarness();
  await h.get('/app/assets/app.js?v=000000000000');
  await h.get('/app/assets/app.js?v=000000000000');
  assert.equal(h.fetches.length, 2);
  assert.equal(h.stored.size, 0);
});

test('legacy code revalidates and API/private media never enter immutable UI cache', async () => {
  const harness = await workerHarness();
  for (const asset of ['/app/assets/app.js?v=legacy-release', '/app/assets/app.js?v=012345abcdef&v=012345abcdef']) {
    await harness.get(asset); await harness.get(asset);
  }
  assert.equal(harness.fetches.length, 4);
  assert.ok(harness.fetches.every((request) => request.options.cache === 'no-store'));
  for (const path of ['/api/sauti-media/example?v=012345abcdef', '/api/account/preferences?v=012345abcdef']) {
    assert.equal(await harness.get(path), undefined, 'worker must leave every API request to normal authorization');
  }
  assert.equal(harness.fetches.length, 4);
  assert.ok([...harness.stored.keys()].every((url) => new URL(url).pathname.startsWith('/app/assets/')));
});

test('navigation still reaches network even when old app HTML exists locally', async () => {
  const harness = await workerHarness();
  harness.stored.set('https://sautilink.com/home', new Response('old shell'));
  await harness.get('/home', { mode: 'navigate' });
  assert.equal(harness.fetches.length, 1);
  assert.equal(harness.fetches[0].options.cache, 'no-store');
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sautilink-ui-hash-test-'));
  const assets = join(root, 'app/assets');
  await mkdir(assets, { recursive: true });
  await mkdir(join(assets, 'vendor'));
  await mkdir(join(assets, 'huge-icons'));
  const files = {
    'app.css': 'body{color:black}',
    'profile-x-ui.css': '.profile{color:blue}',
    'profile-settings-ui.css': '.settings{color:red}',
    'post-edit.js': 'const css="/app/assets/profile-x-ui.css?v=legacy";',
    'theme-init.js': 'document.documentElement.dataset.theme="light";',
    'app.js': 'import("/app/assets/post-edit.js"); const css="/app/assets/profile-settings-ui.css?v=legacy"; const hls="/app/assets/vendor/hls-1.7.3.min.js";',
    'vendor/hls-1.7.3.min.js': 'window.Hls={};',
    'huge-icons/runtime.js': 'window.Huge={};',
    'icons.js': 'const release="legacy"; const runtime=`/app/assets/huge-icons/runtime.js?v=${release}`;',
  };
  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(assets, name), content)));
  await writeFile(join(root, 'app/index.html'), '<link href="/app/assets/app.css?v=legacy&amp;menu=old"><script src="/app/assets/app.js?v=legacy&feature=kept"></script><script src="/app/assets/theme-init.js?v=legacy"></script><link href="/app/assets/profile-x-ui.css?v=legacy">');
  return { root, assets, files };
}

test('hashes describe final dependency bytes and retain feature queries without root pollution', async () => {
  const f = await fixture();
  try {
    const first = await stampProductionUiAssets(f.root);
    assert.equal(await verifyProductionUiAssetHashes(f.root), 9);
    const html = await readFile(join(f.root, 'app/index.html'), 'utf8');
    const app = await readFile(join(f.assets, 'app.js'), 'utf8');
    assert.equal(first['app.js'], contentHash(app));
    assert.match(app, new RegExp(`post-edit\\.js\\?v=${first['post-edit.js']}`));
    assert.match(html, /&feature=kept/);
    assert.match(html, /&amp;menu=old/);
    assert.match(app, new RegExp(`vendor/hls-1\\.7\\.3\\.min\\.js\\?v=${first['vendor/hls-1.7.3.min.js']}`));
    const icons = await readFile(join(f.assets, 'icons.js'), 'utf8');
    assert.match(icons, new RegExp(`huge-icons/runtime\\.js\\?v=${first['huge-icons/runtime.js']}`));
    assert.doesNotMatch(icons, /\?v=\$\{/);
    assert.ok(Object.keys(first).every((name) => !name.includes('..') && !name.startsWith('/')));
    await writeFile(join(f.assets, 'profile-x-ui.css'), '.profile{color:green}');
    const second = await stampProductionUiAssets(f.root);
    assert.notEqual(second['post-edit.js'], first['post-edit.js']);
    assert.notEqual(second['app.js'], first['app.js'], 'dependency content change invalidates importing main bundle');
    assert.equal(await verifyProductionUiAssetHashes(f.root), 9);
    assert.deepEqual(await stampProductionUiAssets(f.root), second, 'stamping is idempotent');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('final-byte verifier rejects modified bytes, stale references and incomplete manifests', async () => {
  const f = await fixture();
  try {
    await stampProductionUiAssets(f.root);
    const appPath = join(f.assets, 'app.js'), clean = await readFile(appPath, 'utf8');
    await writeFile(appPath, clean + '\n// modified after hash');
    await assert.rejects(verifyProductionUiAssetHashes(f.root), /final file content/);
    await writeFile(appPath, clean);
    const htmlPath = join(f.root, 'app/index.html'), html = await readFile(htmlPath, 'utf8');
    await writeFile(htmlPath, html.replace(/app\.js\?v=[a-f0-9]{12}/, 'app.js?v=000000000000'));
    await assert.rejects(verifyProductionUiAssetHashes(f.root), /not referenced with its content hash/);
    await writeFile(htmlPath, html);
    await writeFile(join(f.assets, 'extra.js'), 'new code');
    await assert.rejects(verifyProductionUiAssetHashes(f.root), /every UI code asset/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('cyclic asset references fail instead of minting self-referential immutable versions', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.assets, 'post-edit.js'), 'import("/app/assets/app.js");');
    await assert.rejects(stampProductionUiAssets(f.root), /Circular production UI asset reference/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('legacy verification view scopes core markers without matching a WhatsApp CSS suffix', async () => {
  const source = await read('scripts/verify-production-artifact-with-hashes.mjs');
  const start = source.indexOf('function legacyVerificationView(input) {');
  const end = source.indexOf('\nfunction run(', start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end) + '\nthis.view = legacyVerificationView;', context);
  const transformed = context.view('/app/assets/app.css?v=012345abcdef /app/assets/messages-whatsapp.css?v=012345abcdef');
  assert.equal(transformed, '/app/assets/app.css?v=20260927-page-headers1 /app/assets/messages-whatsapp.css?v=20260914-messagesui1');
});

async function memberHarness() {
  const transformed = transformMemberBootstrapResilienceSource('/repo/src/app.js', await read('src/app.js'));
  const start = transformed.indexOf('async function loadMemberOnce(user) {');
  const end = transformed.indexOf('\nasync function loadMember(user)', start);
  const reads = { account_profiles: deferred(), social_profiles: deferred() }, started = [], rendered = [], events = [];
  const scope = {
    currentMember: null, currentMemberId: '', memberLoadUserId: '', currentAccountEmail: '', MEMBER_BOOT_TIMEOUT_MS: 4500,
    normalizeEmail: (email) => email, normalizeUsername: (name) => name,
    syncAccountSecurityEmail() {}, resilientRead: async (factory) => { const result = await factory(); if (result?.error) throw result.error; return result; },
    supabase: { from: (table) => ({ select() { return this; }, eq(key, id) { assert.equal(key, 'id'); assert.equal(id, 'owner'); return this; },
      maybeSingle() { started.push(table); return reads[table].promise; } }) },
    memberFallbackProfile: () => ({ id: 'owner', username: 'cached' }),
    renderMember: (profile) => rendered.push(profile), refreshMemberProfileAfterFallback: () => events.push('background-profile'),
    cacheMemberProfile() {}, loadDeletionRequestState: async () => {}, applyLocationRoute: async () => events.push('route'),
    showSignupRequirements: async () => { events.push('signup-gate'); return true; },
    showSignedOut: () => events.push('signed-out'), setMessage() {},
  };
  vm.createContext(scope);
  vm.runInContext(transformed.slice(start, end) + '\nthis.loadMemberOnce = loadMemberOnce;', scope);
  return { reads, started, rendered, events, scope, run: () => scope.loadMemberOnce({ id: 'owner', email: 'owner@example.test' }) };
}

test('owner account and social reads overlap, but render waits for both current results', async () => {
  const h = await memberHarness(), done = h.run();
  assert.deepEqual(h.started.sort(), ['account_profiles', 'social_profiles']);
  h.reads.social_profiles.resolve({ data: { id: 'owner', username: 'fresh', display_name: 'Fresh' } });
  await Promise.resolve();
  assert.equal(h.rendered.length, 0);
  h.reads.account_profiles.resolve({ data: { username: 'fresh', full_name: 'Owner' } });
  await done;
  assert.equal(h.rendered.length, 1);
  assert.equal(h.rendered[0].display_name, 'Fresh');
});

test('account admission remains authoritative even if parallel social read rejects', async () => {
  const h = await memberHarness(), done = h.run();
  h.reads.social_profiles.reject(new Error('transient social read'));
  h.reads.account_profiles.resolve({ data: null });
  await done;
  assert.deepEqual(h.events, ['signup-gate']);
  assert.equal(h.rendered.length, 0);
});

test('transient social/account failures retain established cached identity and routes', async () => {
  for (const failing of ['account_profiles', 'social_profiles']) {
    const h = await memberHarness(), done = h.run();
    for (const name of ['account_profiles', 'social_profiles']) {
      if (name === failing) h.reads[name].reject(new Error('temporary read failure'));
      else h.reads[name].resolve({ data: { id: 'owner', username: 'fresh' } });
    }
    await done;
    assert.equal(h.rendered[0].username, 'cached');
    assert.deepEqual(h.events, ['background-profile', 'route']);
    assert.ok(!h.events.includes('signed-out'));
  }
});

async function servicesHarness() {
  const source = transformRuntimePerformanceSource('/repo/src/app.js',
    transformMemberBootstrapResilienceSource('/repo/src/app.js', await read('src/app.js')));
  const start = source.indexOf('function startDeferredMemberServices(firstFeed) {');
  const end = source.indexOf('\nfunction renderMember(', start);
  let clock = 0, nextTimer = 0;
  const timers = new Map(), calls = [];
  const scope = {
    currentMemberId: 'owner', currentSettingsPreferences: null, activeConversation: null, MEMBER_REFRESH_DELAY_MS: 700,
    Date: { now: () => clock }, Promise,
    window: { setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { at: clock + delay, fn }); return id; },
      clearTimeout(id) { timers.delete(id); } },
    ensureDmInboxRealtime: () => calls.push('inbox'), ensureSettingsPreferences: async () => { calls.push('settings'); return {}; },
    messageBadgesEnabled: () => true, refreshMessageBadge: () => calls.push('message-badge'),
    refreshNotificationBadge: () => calls.push('notification-badge'), syncModerationAccess: () => calls.push('moderation'),
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end) + '\nthis.startDeferredMemberServices = startDeferredMemberServices;', scope);
  return { scope, calls, async tick(ms) {
    clock += ms;
    for (let turns = 0; turns < 20; turns++) {
      const due = [...timers].filter(([, value]) => value.at <= clock);
      if (!due.length) break;
      for (const [id, value] of due) { timers.delete(id); value.fn(); }
      await Promise.resolve();
    }
    await Promise.resolve();
  } };
}

test('optional member services wait for fast feed plus existing minimum delay', async () => {
  const h = await servicesHarness(), feed = deferred();
  h.scope.startDeferredMemberServices(feed.promise);
  feed.resolve(); await Promise.resolve();
  await h.tick(699); assert.equal(h.calls.length, 0);
  await h.tick(1);
  assert.deepEqual(h.calls, ['inbox', 'settings', 'notification-badge', 'moderation', 'message-badge']);
});

test('slow feeds have priority until bounded service deadline and cannot duplicate services', async () => {
  const h = await servicesHarness(), feed = deferred();
  h.scope.startDeferredMemberServices(feed.promise);
  await h.tick(4999); assert.equal(h.calls.length, 0);
  await h.tick(1); const count = h.calls.length; assert.ok(count > 0);
  feed.resolve(); await Promise.resolve(); await h.tick(10000);
  assert.equal(h.calls.length, count);
});

test('failed feed still starts services, while another account cannot inherit a scheduled launch', async () => {
  const h = await servicesHarness(), feed = deferred();
  h.scope.startDeferredMemberServices(feed.promise);
  feed.reject(new Error('feed unavailable')); await Promise.resolve();
  await h.tick(700); assert.ok(h.calls.length > 0);
  const other = await servicesHarness(), pending = deferred();
  other.scope.startDeferredMemberServices(pending.promise);
  other.scope.currentMemberId = 'another-owner';
  pending.resolve(); await Promise.resolve(); await other.tick(5000);
  assert.equal(other.calls.length, 0);
});
