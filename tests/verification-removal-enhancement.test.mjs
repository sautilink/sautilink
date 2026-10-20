import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/verified-identity-controls.js', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(payload, body = null) {
  const started = deferred();
  const json = () => { started.resolve(); return body ? body.promise : Promise.resolve(payload); };
  return { ok: true, json, clone: () => ({ json }), started: started.promise };
}

const identity = (verified) => ({
  ok: true,
  data: {
    profile: { id: 'fixture-member', username: 'amina', is_verified: verified },
    username: { locked_permanently: verified, changes_remaining_30_days: verified ? 0 : 1 },
    display_name: { changes_remaining_month: 2 },
  },
});

function harness() {
  const nodes = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const requests = [];
  const timers = [];
  const observers = [];
  let token = 'synthetic-session-a';
  const listen = (events, name, callback) => {
    if (!events.has(name)) events.set(name, []);
    events.get(name).push(callback);
  };
  const node = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      const attributes = new Map();
      const events = new Map();
      nodes.set(id, {
        id, hidden: false, disabled: false, textContent: '', value: '', dataset: {},
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: name => attributes.get(name) ?? null,
        removeAttribute: name => attributes.delete(name),
        closest: selector => selector === '.identity-username-field' ? node('username-field') : null,
        addEventListener: (name, callback) => listen(events, name, callback),
        fire: name => { for (const callback of events.get(name) || []) callback({ type: name }); },
      });
    }
    return nodes.get(id);
  };
  node('profile-username').textContent = '@amina';
  node('profile-verified-badge').hidden = true;
  node('verification-info-since').hidden = true;
  const document = {
    readyState: 'loading',
    getElementById: node,
    querySelector: selector => selector === '#profile-identity-state' ? node('profile-identity-state') : null,
    createElement: tag => ({ tagName: tag }),
    head: { append() {} },
    addEventListener: (name, callback) => listen(documentEvents, name, callback),
  };
  const window = {
    location: { origin: 'https://sautilink.test' },
    localStorage: { getItem: key => key === 'sautilink.auth.session' && token ? JSON.stringify({ access_token: token }) : null },
    addEventListener: (name, callback) => listen(windowEvents, name, callback),
    setTimeout: (callback, delay) => { timers.push({ callback, delay, ran: false }); return timers.length; },
    fetch: (...args) => {
      const result = deferred();
      requests.push({ args, ...result });
      return result.promise;
    },
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target) { observers.push({ target, callback: this.callback }); }
  }
  runInNewContext(source, { window, document, MutationObserver, URL, URLSearchParams, Intl });
  const fire = (events, name, event = {}) => {
    for (const callback of events.get(name) || []) callback({ type: name, ...event });
  };
  fire(documentEvents, 'DOMContentLoaded');
  return {
    node, requests,
    setToken: value => { token = value; },
    remove: () => fire(documentEvents, 'sautilink:verification-removed', { detail: { userId: 'fixture-member', username: 'amina' } }),
    storage: key => fire(windowEvents, 'storage', { key }),
    read: () => window.fetch('/api/account/identity'),
    runTimers: () => {
      for (const timer of timers) {
        if (!timer.ran && [0, 60].includes(timer.delay)) { timer.ran = true; timer.callback(); }
      }
    },
    reopenEditor: () => {
      for (const observer of observers) if (observer.target.id === 'profile-editor') observer.callback();
    },
    apply: async (verified) => {
      const pending = window.fetch('/api/account/identity');
      requests.at(-1).resolve(response(identity(verified)));
      await pending;
    },
  };
}

async function settle() {
  for (let n = 0; n < 8; n++) await Promise.resolve();
}

function assertUnlocked(h) {
  assert.equal(h.node('profile-username-input').disabled, false);
  assert.equal(h.node('profile-username-input').getAttribute('aria-disabled'), null);
  assert.equal(h.node('username-field').classList.contains('verified-username-locked'), false);
  assert.equal(h.node('profile-username-submit').dataset.verifiedUsernameLocked, undefined);
}

test('removal invalidates an identity response before headers or while its cloned JSON is pending', async () => {
  for (const afterHeaders of [false, true]) {
    const h = harness();
    const pending = h.read();
    const body = deferred();
    const result = response(null, body);
    if (afterHeaders) {
      h.requests[0].resolve(result);
      await result.started;
    }
    h.remove();
    if (!afterHeaders) h.requests[0].resolve(result);
    body.resolve(identity(true));
    await pending;
    h.runTimers();
    h.reopenEditor();
    h.runTimers();
    assertUnlocked(h);
    assert.equal(h.node('profile-identity-summary').textContent, '');
  }
});

test('removal cancels both scheduled identity applications and cached editor reapplication', async () => {
  const h = harness();
  await h.apply(true);
  h.remove();
  h.runTimers();
  h.reopenEditor();
  h.runTimers();
  assertUnlocked(h);
  assert.equal(h.node('profile-identity-summary').textContent, '');
});

test('a newer identity request supersedes an older response and its already scheduled timers', async () => {
  for (const oldAlreadyScheduled of [false, true]) {
    const h = harness();
    const old = h.read();
    if (oldAlreadyScheduled) {
      h.requests[0].resolve(response(identity(true)));
      await old;
    }
    const fresh = h.read();
    h.runTimers();
    assertUnlocked(h);
    h.requests[1].resolve(response(identity(false)));
    await fresh;
    if (!oldAlreadyScheduled) {
      h.requests[0].resolve(response(identity(true)));
      await old;
    }
    h.runTimers();
    assertUnlocked(h);
    assert.equal(h.node('profile-identity-summary').textContent, '');
  }
});

test('logout or account token change prevents pending responses and queued timers from changing the editor', async () => {
  for (const nextToken of ['', 'synthetic-session-b']) {
    for (const scheduled of [false, true]) {
      const h = harness();
      const pending = h.read();
      if (scheduled) {
        h.requests[0].resolve(response(identity(true)));
        await pending;
      }
      h.setToken(nextToken);
      if (!scheduled) {
        h.requests[0].resolve(response(identity(true)));
        await pending;
      }
      h.runTimers();
      h.reopenEditor();
      h.runTimers();
      assertUnlocked(h);
    }
  }
});

test('fresh unverified identity removes the old username lock and keeps the normal change limits authoritative', async () => {
  const h = harness();
  await h.apply(true);
  h.runTimers();
  assert.equal(h.node('profile-username-input').disabled, true);
  assert.equal(h.node('username-field').classList.contains('verified-username-locked'), true);
  assert.match(h.node('profile-username-hint').textContent, /remove verification in Settings/);
  h.remove();
  await h.apply(false);
  h.runTimers();
  assertUnlocked(h);
  assert.equal(h.node('profile-username-submit').disabled, true,
    'The enhancement leaves submission quota decisions to the account identity controls');
});

test('removal clears the verification-since cache instead of reusing the old verification date', async () => {
  const h = harness();
  h.node('profile-verified-badge').hidden = false;
  h.node('profile-verified-badge').fire('click');
  h.requests[0].resolve(response([{ username: 'amina', username_locked_at: '2026-09-01T00:00:00Z', is_verified: true }]));
  await settle();
  assert.equal(h.node('verification-info-since').textContent, 'Verified since September 2026');
  h.node('profile-verified-badge').fire('click');
  assert.equal(h.requests.length, 1, 'The initial successful date is cached');
  h.remove();
  assert.equal(h.node('verification-info-since').hidden, true);
  assert.equal(h.node('verification-info-since').textContent, '');
  h.node('profile-verified-badge').fire('click');
  assert.equal(h.requests.length, 2, 'A later badge must read its new verification date');
  h.requests[1].resolve(response([{ username: 'amina', username_locked_at: '2026-10-01T00:00:00Z', is_verified: true }]));
  await settle();
  assert.equal(h.node('verification-info-since').textContent, 'Verified since October 2026');
});

test('removal invalidates verification-since requests before headers and after their JSON read begins', async () => {
  for (const afterHeaders of [false, true]) {
    const h = harness();
    h.node('profile-verified-badge').hidden = false;
    h.node('profile-verified-badge').fire('click');
    const body = deferred();
    const result = response(null, body);
    if (afterHeaders) {
      h.requests[0].resolve(result);
      await result.started;
    }
    h.remove();
    if (!afterHeaders) h.requests[0].resolve(result);
    body.resolve([{ username: 'amina', username_locked_at: '2026-09-01T00:00:00Z', is_verified: true }]);
    await settle();
    assert.equal(h.node('verification-info-since').hidden, true);
    assert.equal(h.node('verification-info-since').textContent, '');
    h.node('profile-verified-badge').fire('click');
    assert.equal(h.requests.length, 2, 'The invalidated request cannot refill the date cache');
    h.requests[1].resolve(response([]));
    await settle();
  }
});

test('auth storage invalidation cancels cached editor data and verification-since dates', async () => {
  const h = harness();
  await h.apply(true);
  h.storage('sautilink.auth.session');
  h.runTimers();
  h.reopenEditor();
  h.runTimers();
  assertUnlocked(h);
  assert.equal(h.node('verification-info-since').hidden, true);
});
