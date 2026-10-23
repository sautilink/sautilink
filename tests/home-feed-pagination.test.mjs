import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { installHomeFeedPagination } from '../src/home-feed-pagination.js';
import { transformMemberBootstrapResilienceSource } from '../scripts/member-bootstrap-resilience-source-transform.mjs';

const tick = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }
function target() {
  const listeners = new Map();
  return { addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    emit(type, details = {}) { for (const listener of [...listeners.get(type) || []]) listener({ type, ...details }); },
    listeners };
}
function harness() {
  let clock = 10000, serial = 0, observer;
  const timers = new Map(), operations = [], win = target(), doc = target();
  win.setTimeout = (callback, delay) => { timers.set(++serial, { callback, at: clock + delay }); return serial; };
  win.clearTimeout = id => timers.delete(id);
  const value = { ownerId: 'A', mode: 'for-you', epoch: 1, offset: 5, active: true, authorized: true, busy: false, hasMore: true };
  const feed = { isConnected: true }, more = { isConnected: true, hidden: false }, button = { isConnected: true, disabled: false };
  const pagination = installHomeFeedPagination({ feed, more, button, state: () => ({ ...value }),
    loadMore() { const gate = deferred(); operations.push({ gate, owner: value.ownerId, offset: value.offset }); value.epoch++; value.busy = true; return gate.promise; },
    win, doc, now: () => clock,
    Observer: class {
      constructor(callback, options) { observer = this; this.callback = callback; this.options = options; }
      observe(node) { this.node = node; } unobserve() {} disconnect() { this.disconnected = true; }
    },
  });
  return { value, timers, operations, win, doc, feed, more, button, pagination, observer,
    near(enabled = true) { observer.callback([{ target: more, isIntersecting: enabled }]); },
    gesture(type = 'wheel', details) { win.emit(type, details); win.emit('scroll'); },
    async advance(ms) {
      clock += ms;
      while (true) { const entry = [...timers].find(([, timer]) => timer.at <= clock); if (!entry) break;
        timers.delete(entry[0]); entry[1].callback(); await tick(); }
      await tick();
    },
    async finish(index = operations.length - 1, offset = value.offset + 20) {
      value.offset = offset; value.busy = false; operations[index].gate.resolve(); await tick();
    },
  };
}

test('Home loads one page after user scroll near the footer, never from initial intersection or layout scroll', async () => {
  const h = harness(); h.near(); await h.advance(2000);
  assert.equal(h.operations.length, 0);
  h.win.emit('scroll'); await h.advance(1000); assert.equal(h.operations.length, 0);
  h.gesture(); await h.advance(99); assert.equal(h.operations.length, 0);
  await h.advance(1); assert.equal(h.operations.length, 1); assert.equal(h.operations[0].offset, 5);
  h.gesture(); h.near(); await h.advance(3000); assert.equal(h.operations.length, 1, 'one flight owns the page');
  await h.finish(); h.near(); h.win.emit('scroll'); await h.advance(3000);
  assert.equal(h.operations.length, 1, 'short cards and scroll anchoring cannot create a fill loop');
  h.gesture('touchmove'); await h.advance(100); assert.equal(h.operations.length, 2);
  h.pagination.destroy();
});

test('debounce, cooldown and viewport exit bound requests without hiding the manual button', async () => {
  const h = harness(); h.near(); h.gesture(); await h.advance(100); await h.finish();
  h.gesture(); await h.advance(999); assert.equal(h.operations.length, 1);
  await h.advance(1); assert.equal(h.operations.length, 2);
  await h.finish(); h.gesture(); h.near(false); await h.advance(2000);
  assert.equal(h.operations.length, 2); assert.equal(h.button.disabled, false);
  h.near(); await h.advance(100); assert.equal(h.operations.length, 3);
  h.pagination.destroy();
});

test('a far-footer scroll intent expires before a much later intersection without starting a timer loop', async () => {
  const h = harness(); h.near(false); h.gesture(); await h.advance(60000);
  assert.equal(h.timers.size, 0); h.near(); await h.advance(1000);
  assert.equal(h.operations.length, 0);
  h.gesture(); await h.advance(100); assert.equal(h.operations.length, 1);
  h.pagination.destroy();
});

test('hidden/navigation/auth/mode/busy/end/disconnection guards discard pending requests', async () => {
  for (const guard of [h => { h.value.active = false; }, h => { h.value.authorized = false; },
    h => { h.value.mode = 'short-videos'; }, h => { h.value.busy = true; }, h => { h.value.hasMore = false; },
    h => { h.more.hidden = true; }, h => { h.button.disabled = true; }, h => { h.feed.isConnected = false; },
    h => { h.value.offset = 0; }, h => { h.value.epoch++; }, h => { h.value.ownerId = 'B'; }]) {
    const h = harness(); h.near(); h.gesture(); guard(h); await h.advance(2000);
    assert.equal(h.operations.length, 0); h.pagination.destroy();
  }
  const away = harness(); away.near(); away.gesture(); away.value.active = false; away.win.emit('popstate');
  away.value.active = true; away.win.emit('sautilink:routechange'); away.win.emit('scroll'); await away.advance(2000);
  assert.equal(away.operations.length, 0, 'return navigation does not reuse the previous scroll intent'); away.pagination.destroy();
});

test('a new owner can paginate before the old owner settles, and old completion cannot clear the new flight', async () => {
  const h = harness(); h.near(); h.gesture(); await h.advance(100);
  h.value.ownerId = 'B'; h.value.epoch++; h.value.busy = false; h.value.offset = 5;
  h.win.emit('sautilink:routechange'); h.gesture(); await h.advance(1000);
  assert.equal(h.operations.length, 2); assert.equal(h.operations[1].owner, 'B');
  h.operations[0].gate.resolve(); await tick(); h.gesture(); await h.advance(2000);
  assert.equal(h.operations.length, 2, 'late A completion cannot release B');
  await h.finish(1); h.gesture(); await h.advance(100); assert.equal(h.operations.length, 3);
  h.pagination.destroy();
});

test('a failed automatic page leaves manual retry available and a refreshed epoch can reuse the same offset', async () => {
  const h = harness(); h.near(); h.gesture(); await h.advance(100); await h.finish(0, 5);
  h.gesture(); await h.advance(2000); assert.equal(h.operations.length, 1);
  assert.equal(h.button.disabled, false);
  h.value.epoch++; h.win.emit('sautilink:routechange'); h.gesture(); await h.advance(100);
  assert.equal(h.operations.length, 2); h.pagination.destroy();
});

test('page lifecycle and disposal cancel queued work; unsupported browsers retain the existing button', async () => {
  const h = harness(); h.near(); h.gesture(); h.win.emit('pagehide'); await h.advance(1000);
  assert.equal(h.operations.length, 0); h.win.emit('pageshow'); h.near(); h.gesture('keydown', { key: 'PageDown' });
  await h.advance(100); assert.equal(h.operations.length, 1);
  await h.finish(); h.gesture(); h.pagination.destroy(); await h.advance(2000);
  assert.equal(h.operations.length, 1); assert.equal(h.observer.disconnected, true);
  assert.equal(h.win.listeners.get('scroll').size, 0);
  assert.equal(installHomeFeedPagination({ feed: {}, more: {}, button: {}, Observer: null, win: {}, doc: {} }), null);
});

test('canonical and production install once, production strengthens the current-owner auth gate, and bundling copies the module', async () => {
  const raw = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const built = transformMemberBootstrapResilienceSource('/repo/src/app.js', raw);
  for (const source of [raw, built]) {
    assert.equal(source.match(/installHomeFeedPagination\(\{/g)?.length, 1);
    assert.match(source, /from '\.\/home-feed-pagination\.js'/);
    assert.match(source, /loadMore: \(\) => loadStream\(\)/);
  }
  assert.match(built, /function homeFeedPaginationAuthorized\(\) \{\s*return Boolean\(currentMember && currentMemberId && !recoverySession && initialHomeFeedRead.authorization\(currentMemberId\)\)/);
  const pipeline = await readFile(new URL('../scripts/build-production-release.mjs', import.meta.url), 'utf8');
  assert.match(pipeline, /cp\(resolve\(projectRoot, 'src'\), workerSource, \{ recursive: true \}\)/);
  assert.match(pipeline, /entryPoints: \[productionAppSource\]/);
});
