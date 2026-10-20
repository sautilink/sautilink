import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const clientSource = await readFile(new URL('../src/messages-durable-realtime.js', import.meta.url), 'utf8');

// Execute the actual browser module. The synthetic DOM produces childList/hidden
// observer notifications when the module renders, as the browser does. There is
// no network, real account, token, or production DOM in these deterministic tests.
function clientFixture({ accept = false, delayedToken = false, missingToken = false } = {}) {
  let now = 0;
  let nextTimer = 1;
  let observer = null;
  let mutationQueued = false;
  let tokenReads = 0;
  const timers = new Map();
  const attempts = [];
  const tokenWaiters = [];
  const browserEvents = new Map();
  const wanted = { conversationId: 'synthetic-thread-one', memberId: 'synthetic-member-one',
    activityEnabled: true, blocked: false };
  const fixture = { accept };
  function schedule(fn, delay = 0) {
    const id = nextTimer++;
    timers.set(id, { at: now + delay, fn });
    return id;
  }
  function mutation() {
    if (!observer || mutationQueued) return;
    mutationQueued = true;
    queueMicrotask(() => { mutationQueued = false; observer(); });
  }
  function element() {
    return { dataset: {}, addEventListener() {},
      get hidden() { return this._hidden || false; },
      set hidden(value) { this._hidden = value; mutation(); },
      get textContent() { return this._text || ''; },
      set textContent(value) { this._text = value; mutation(); } };
  }
  const elements = new Map(['message-body', 'message-thread-activity', 'message-typing-status', 'messages-surface']
    .map((id) => [id, element()]));
  class SyntheticWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    constructor(url) {
      this.readyState = 0;
      this.listeners = new Map();
      attempts.push({ at: now, url, socket: this });
      schedule(() => {
        if (this.readyState !== 0) return;
        if (!fixture.accept) { this.finish(1006); return; }
        this.readyState = 1;
        this.listeners.get('open')?.();
        schedule(() => this.finish(1008), 30_000);
      }, 10);
    }
    addEventListener(event, callback) { this.listeners.set(event, callback); }
    send() {}
    finish(code) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.listeners.get('close')?.({ code, reason: 'synthetic' });
    }
    close(code) { this.finish(code); }
  }
  const window = { location: { protocol: 'https:', host: 'offline.invalid' },
    setTimeout: schedule, clearTimeout(id) { timers.delete(id); },
    addEventListener(name, callback) { browserEvents.set(name, callback); },
    __sautilinkDmRealtimeContext: () => ({ ...wanted }),
    __sautilinkDmRealtimeAuthHeaders: async () => {
      tokenReads++;
      if (delayedToken) return new Promise((resolve) => tokenWaiters.push(resolve));
      return missingToken ? {} : { Authorization: 'Bearer synthetic-offline-token' };
    } };
  const document = { hidden: false, body: {}, getElementById: (id) => elements.get(id), addEventListener() {} };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ window, document, WebSocket: SyntheticWebSocket,
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} }, Date: Clock });
  vm.runInContext(clientSource, context);
  async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  async function until(deadline) {
    for (let turns = 0; turns < 10_000; turns++) {
      await flush();
      const selected = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!selected || selected[1].at > deadline) { now = deadline; await flush(); return; }
      timers.delete(selected[0]);
      now = selected[1].at;
      selected[1].fn();
    }
    assert.fail('synthetic timer loop did not settle');
  }
  return Object.assign(fixture, { attempts, wanted, elements, tokenWaiters, until, flush, mutation,
    tokenReads: () => tokenReads, event: (name) => browserEvents.get(name)?.() });
}

test('failed upgrades honor exponential backoff despite DOM observer, online and navigation events', async () => {
  const client = clientFixture();
  await client.until(100);
  for (let time = 200; time <= 5000; time += 100) {
    client.mutation();
    client.event('online');
    client.event('popstate');
    await client.until(time);
  }
  assert.equal(client.attempts.length, 3);
  assert.ok(client.attempts[1].at - client.attempts[0].at >= 1400);
  assert.ok(client.attempts[2].at - client.attempts[1].at >= 2800);
  assert.equal(client.tokenReads(), 3);
});

test('sustained denial reaches the 15 second cap rather than creating a reconnect storm', async () => {
  const client = clientFixture();
  await client.until(60_000);
  assert.equal(client.attempts.length, 7);
  assert.ok(client.attempts[6].at - client.attempts[5].at >= 15_000);
  assert.equal(client.elements.get('messages-surface').dataset.realtimeTransport, undefined);
});

test('normal 1008 lease expiry reconnects and successful upgrades reset earlier failure backoff', async () => {
  const client = clientFixture();
  await client.until(4000);
  assert.equal(client.attempts.length, 2);
  client.accept = true;
  await client.until(32_000);
  assert.equal(client.attempts.length, 3);
  assert.equal(client.elements.get('messages-surface').dataset.realtimeTransport, 'durable-object');
  await client.until(36_000);
  assert.equal(client.attempts.length, 4);
  const difference = client.attempts[3].at - client.attempts[2].at;
  assert.ok(difference >= 31_400 && difference < 32_000);
  assert.equal(client.elements.get('messages-surface').dataset.realtimeTransport, 'durable-object');
});

test('conversation and account changes reset only the old context backoff', async () => {
  const client = clientFixture();
  await client.until(2000);
  assert.equal(client.attempts.length, 2);
  client.wanted.conversationId = 'synthetic-thread-two';
  client.mutation();
  await client.until(2100);
  assert.equal(client.attempts.length, 3);
  assert.match(client.attempts[2].url, /synthetic-thread-two$/);
  client.wanted.memberId = 'synthetic-member-two';
  client.mutation();
  await client.until(2200);
  assert.equal(client.attempts.length, 4);
  await client.until(3000);
  assert.equal(client.attempts.length, 4);
});

test('only one token read can open the current context; late old-context tokens are ignored', async () => {
  const client = clientFixture({ delayedToken: true, accept: true });
  await client.until(100);
  for (let time = 200; time <= 1000; time += 100) {
    client.mutation();
    await client.until(time);
  }
  assert.equal(client.tokenReads(), 1);
  assert.equal(client.attempts.length, 0);
  client.wanted.conversationId = 'synthetic-thread-two';
  client.mutation();
  await client.until(1100);
  assert.equal(client.tokenReads(), 2);
  client.tokenWaiters[0]({ Authorization: 'Bearer synthetic-old-token' });
  await client.flush();
  assert.equal(client.attempts.length, 0);
  client.tokenWaiters[1]({ Authorization: 'Bearer synthetic-current-token' });
  await client.until(1200);
  assert.equal(client.attempts.length, 1);
  assert.match(client.attempts[0].url, /synthetic-thread-two$/);
});

test('missing credentials back off; privacy opt-out cancels future attempts', async () => {
  const client = clientFixture({ missingToken: true });
  await client.until(5000);
  assert.equal(client.tokenReads(), 3);
  assert.equal(client.attempts.length, 0);
  client.wanted.activityEnabled = false;
  client.mutation();
  await client.until(60_000);
  assert.equal(client.tokenReads(), 3);
  assert.equal(client.attempts.length, 0);
});

test('switching away and back cannot revive the first pending token attempt for the same thread', async () => {
  const client = clientFixture({ delayedToken: true, accept: true });
  await client.until(100);
  client.wanted.conversationId = 'synthetic-thread-two';
  client.mutation();
  await client.until(200);
  client.wanted.conversationId = 'synthetic-thread-one';
  client.mutation();
  await client.until(300);
  assert.equal(client.tokenReads(), 3);
  client.tokenWaiters[0]({ Authorization: 'Bearer synthetic-stale-token' });
  await client.flush();
  assert.equal(client.attempts.length, 0);
  client.mutation();
  await client.until(400);
  assert.equal(client.tokenReads(), 3);
  client.tokenWaiters[2]({ Authorization: 'Bearer synthetic-current-token' });
  await client.until(500);
  assert.equal(client.attempts.length, 1);
});
