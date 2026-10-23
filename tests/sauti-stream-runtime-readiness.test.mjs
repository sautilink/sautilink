import assert from 'node:assert/strict';
import test from 'node:test';

const MEDIA = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
let sequence = 0;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

async function harness() {
  const keys = ['window', 'document', 'navigator', 'MutationObserver', 'HTMLVideoElement', 'fetch'];
  const original = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const scripts = [], timers = new Map();
  let timer = 0, callback, releaseSession;
  const session = new Promise((resolve) => { releaseSession = resolve; });
  const document = new EventTarget();
  document.visibilityState = 'visible'; document.documentElement = {};
  document.dialog = false;
  document.querySelector = () => document.dialog ? {} : null;
  document.createElement = (tag) => {
    assert.equal(tag, 'script');
    return { remove() { this.removed = true; } };
  };
  document.head = { append(script) { scripts.push(script); } };
  const window = new EventTarget();
  Object.assign(window, { location: { origin: 'https://sautilink.com' }, MediaSource: class {},
    SautiLinkVideoMediaSession: { ensure: () => session },
    setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout(id) { timers.delete(id); } });
  const connection = new EventTarget();
  Object.assign(connection, { saveData: false, effectiveType: '4g' });
  const values = { window, document, navigator: { connection },
    MutationObserver: class { observe() {} }, HTMLVideoElement: class {},
    fetch() { assert.fail('public SDK readiness must not bypass the existing pending media-session check'); } };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const module = await import(`../src/sauti-stream-web-player.js?runtime-readiness=${++sequence}`);
  module.installSautiStreamAuthLifecycle({ auth: { onAuthStateChange(fn) { callback = fn; return {}; } } });
  return { module, scripts, window, document, connection, timers,
    async close() {
      callback('SIGNED_OUT', null);
      releaseSession(); await flush();
      for (const key of keys) {
        if (original[key]) Object.defineProperty(globalThis, key, original[key]); else delete globalThis[key];
      }
    } };
}

test('a valid wanted readiness window shares one pinned public SDK load without creating a player or decoder', async () => {
  const h = await harness();
  try {
    h.module.updateSautiStreamReadiness(['invalid', 'https://example.com/video']);
    assert.equal(h.scripts.length, 0);
    h.module.updateSautiStreamReadiness([MEDIA]);
    h.module.updateSautiStreamReadiness([MEDIA, OTHER]);
    assert.equal(h.scripts.length, 1);
    assert.equal(h.scripts[0].src, '/app/assets/vendor/hls-1.7.3.min.js');
    assert.equal(h.scripts[0].async, true);
    let created = 0;
    h.window.Hls = class { constructor() { created++; } };
    h.scripts[0].onload(); await flush();
    h.module.updateSautiStreamReadiness([OTHER]);
    assert.equal(h.scripts.length, 1); assert.equal(created, 0);
    assert.equal(h.timers.size, 0, 'a successful code warmup leaves no background timeout');
  } finally { await h.close(); }
});

test('hidden, dialog, saver, very slow network and visible buffering suspend SDK warmup until eligible', async () => {
  for (const blocked of ['hidden', 'dialog', 'saver', '2g', 'buffering']) {
    const h = await harness();
    const video = { isConnected: true, paused: false, dataset: {} };
    try {
      if (blocked === 'hidden') h.document.visibilityState = 'hidden';
      if (blocked === 'dialog') h.document.dialog = true;
      if (blocked === 'saver') h.connection.saveData = true;
      if (blocked === '2g') h.connection.effectiveType = '2g';
      if (blocked === 'buffering') h.module.setSautiStreamBuffering(video, true);
      h.module.updateSautiStreamReadiness([MEDIA]);
      assert.equal(h.scripts.length, 0, blocked);
      h.document.visibilityState = 'visible'; h.document.dialog = false;
      h.connection.saveData = false; h.connection.effectiveType = '4g';
      h.module.setSautiStreamBuffering(video, false);
      h.module.updateSautiStreamReadiness([MEDIA]);
      assert.equal(h.scripts.length, 1, `${blocked} may resume one public code warmup`);
    } finally { await h.close(); }
  }
});

test('failed speculative SDK loading does not retry inside one wanted window or on native-only playback', async () => {
  const h = await harness();
  try {
    delete h.window.MediaSource;
    h.module.updateSautiStreamReadiness([MEDIA]);
    assert.equal(h.scripts.length, 0, 'native HLS does not need the public MSE SDK');
    h.window.MediaSource = class {};
    h.module.updateSautiStreamReadiness([MEDIA]);
    assert.equal(h.scripts.length, 1);
    h.scripts[0].onerror(); await flush();
    assert.equal(h.scripts[0].removed, true); assert.equal(h.timers.size, 0);
    for (let i = 0; i < 10; i++) h.module.updateSautiStreamReadiness([MEDIA, OTHER]);
    assert.equal(h.scripts.length, 1, 'failed prefetch cannot become an observer-driven retry loop');
    h.module.updateSautiStreamReadiness([]);
    h.module.updateSautiStreamReadiness([OTHER]);
    assert.equal(h.scripts.length, 2, 'a later distinct wanted window can attempt its normal code readiness once');
  } finally { await h.close(); }
});
