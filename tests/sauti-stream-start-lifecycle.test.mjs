import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Hls from 'hls.js';

const previousSelf = globalThis.self;
globalThis.self = globalThis;
after(() => { if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf; });

const MEDIA = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://sautilink.com';
let runtimeId = 0;
async function flush() { await new Promise(setImmediate); await new Promise(setImmediate); }

/** Keep the pinned SDK's public start/stop/getter and StreamController lifecycle.
 * Replace only network acceptance and its scheduler: an accepted init/fragment
 * stays pending until real SDK stopLoad aborts it and resets the transmuxer.
 * There is no browser decoder, HTTP request, or worker in this seam.
 */
function sdkLifecycle(config = {}) {
  const sdk = new Hls({ ...config, enableWorker: false, autoStartLoad: false, startLevel: 0 });
  const stream = sdk.streamController;
  const originalControllers = sdk.networkControllers;
  const originalTick = stream.tick;
  const originalFragmentAbort = stream.fragmentLoader.abort;
  const originalInitAbort = stream.initFragmentLoader.abort;
  const originalTransmuxer = stream.transmuxer;
  const metrics = { starts: [], accepts: 0, fragmentAborts: 0, initAborts: 0, resets: 0,
    pendingFragment: false, pendingInit: false };
  let level = 0, closed = false;
  // Do not let the level setter schedule real manifest requests. The actual
  // StreamController still chooses its start level, stops, and enters IDLE.
  Object.defineProperties(sdk, {
    nextLoadLevel: { configurable: true, get: () => level, set: (value) => { level = value; } },
    loadLevel: { configurable: true, get: () => level },
    startLevel: { configurable: true, get: () => 0 },
  });
  sdk.networkControllers = [stream];
  stream.levels = [{}];
  stream.tick = () => {
    if (stream.state !== 'IDLE') return;
    metrics.accepts++;
    metrics.pendingFragment = metrics.pendingInit = true;
    stream.startFragRequested = true;
    stream.state = 'FRAG_LOADING';
  };
  stream.fragmentLoader.abort = () => {
    if (metrics.pendingFragment) metrics.fragmentAborts++;
    metrics.pendingFragment = false;
  };
  stream.initFragmentLoader.abort = () => {
    if (metrics.pendingInit) metrics.initAborts++;
    metrics.pendingInit = false;
  };
  stream.transmuxer = { reset() { metrics.resets++; }, destroy() {} };
  return {
    sdk, metrics,
    start(position) { metrics.starts.push(position); sdk.startLoad(position); },
    stop() { sdk.stopLoad(); },
    close() {
      if (closed) return;
      closed = true;
      sdk.stopLoad();
      sdk.networkControllers = originalControllers;
      stream.tick = originalTick;
      stream.fragmentLoader.abort = originalFragmentAbort;
      stream.initFragmentLoader.abort = originalInitAbort;
      stream.transmuxer = originalTransmuxer;
      for (const property of ['nextLoadLevel', 'loadLevel', 'startLevel']) delete sdk[property];
      sdk.destroy();
    },
  };
}

async function harness() {
  const keys = ['window', 'document', 'HTMLVideoElement', 'MutationObserver', 'fetch'];
  const previous = Object.fromEntries(keys.map((key) => [key, globalThis[key]]));
  const instances = [], requests = [], timers = new Map();
  const document = new EventTarget();
  document.visibilityState = 'visible'; document.documentElement = {};
  document.querySelector = () => null;
  let timerId = 0;
  class Video extends EventTarget {
    constructor({ paused = true } = {}) {
      super(); this.paused = paused; this.isConnected = true;
      this.dataset = { sautiMediaId: MEDIA, sautiManualPlay: 'true' };
      this.currentTime = 0; this.duration = 8; this.playbackRate = 1;
      this.src = `/api/sauti-media/${MEDIA}`; this.plays = 0;
    }
    closest() { return null; }
    canPlayType() { return ''; }
    getBoundingClientRect() { return this.bounds || { top: 0, bottom: 400, height: 400 }; }
    play() {
      this.plays++;
      const changed = this.paused; this.paused = false;
      // A real play event is queued only on the paused-to-playing transition.
      if (changed) queueMicrotask(() => this.dispatchEvent(new Event('play')));
      return Promise.resolve();
    }
    pause() {
      const changed = !this.paused; this.paused = true;
      if (changed) this.dispatchEvent(new Event('pause'));
    }
    load() { this.paused = true; this.currentTime = 0; }
    emit(type) { this.dispatchEvent(new Event(type)); }
  }
  class Runtime {
    static Events = Hls.Events;
    static isSupported() { return true; }
    constructor(config) {
      this.config = config; this.handlers = new Map(); this.destroyed = false;
      this.lifecycle = sdkLifecycle(config);
      this.levels = [{ width: 426, height: 240, bitrate: 200000 }, { width: 1280, height: 720, bitrate: 1500000 }];
      instances.push(this);
    }
    get loadingEnabled() { return this.lifecycle.sdk.loadingEnabled; }
    on(type, handler) { this.handlers.set(type, [...(this.handlers.get(type) || []), handler]); }
    emit(type, detail) { for (const handler of this.handlers.get(type) || []) handler(type, detail); }
    manifest() { this.emit(Hls.Events.MANIFEST_PARSED); }
    loadSource(url) { this.url = url; }
    attachMedia(video) { this.video = video; video.src = 'blob:controlled-mse'; video.load(); }
    startLoad(position) { this.lifecycle.start(position); }
    stopLoad() { this.lifecycle.stop(); }
    destroy() { this.destroyed = true; this.lifecycle.close(); }
  }
  globalThis.document = document;
  globalThis.HTMLVideoElement = Video;
  globalThis.MutationObserver = class { observe() {} };
  globalThis.window = {
    Hls: Runtime, location: { origin: ORIGIN }, innerHeight: 800,
    SautiLinkVideoMediaSession: { async ensure() {} },
    addEventListener() {},
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `/api/sauti-media/${MEDIA}/playback`);
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
    requests.push(url);
    return Response.json({ ok: true, data: { type: 'hls', expires_in: 300,
      expires_at: new Date(Date.now() + 300000).toISOString(),
      url: `${ORIGIN}/api/sauti-media/${MEDIA}/hls/master${requests.length}?c=opaque.${'b'.repeat(43)}` } });
  };
  const runtime = await import(`../src/sauti-stream-web-player.js?start-lifecycle=${++runtimeId}`);
  const videos = [];
  return {
    runtime, instances, requests, timers,
    video(options) { const video = new Video(options); videos.push(video); return video; },
    async attachPlaying() {
      const video = this.video({ paused: false });
      runtime.enhanceSautiStreamPlayback(video); await flush();
      assert.equal(instances.length, 1);
      instances[0].manifest(); await flush();
      return video;
    },
    close() {
      for (const video of videos) video.isConnected = false;
      document.dispatchEvent(new Event('visibilitychange'));
      for (const instance of instances) instance.lifecycle.close();
      for (const key of keys) {
        if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key];
      }
    },
  };
}

function acceptedWithoutRestart(hls, expected = 1) {
  assert.equal(hls.loadingEnabled, true);
  assert.equal(hls.lifecycle.metrics.starts.length, expected);
  assert.equal(hls.lifecycle.metrics.accepts, expected);
  assert.equal(hls.lifecycle.metrics.pendingFragment, true);
  assert.equal(hls.lifecycle.metrics.pendingInit, true);
}

test('the actual pinned SDK restarts abort accepted fragment/init work and reset transmuxing', () => {
  assert.equal(Hls.version, '1.7.3');
  const h = sdkLifecycle();
  try {
    assert.equal(h.sdk.loadingEnabled, false);
    h.start(0); assert.equal(h.sdk.loadingEnabled, true);
    assert.equal(h.metrics.fragmentAborts, 0); assert.equal(h.metrics.initAborts, 0);
    h.start(-1);
    assert.equal(h.metrics.accepts, 2);
    assert.equal(h.metrics.fragmentAborts, 1); assert.equal(h.metrics.initAborts, 1);
    assert.equal(h.metrics.resets, 1, 'this seam must expose actual SDK restart side effects');
  } finally { h.close(); }
});

test('paused-first production preparation keeps accepted initial work when the caller immediately plays', async () => {
  const h = await harness();
  try {
    const video = h.video();
    assert.equal(await h.runtime.prepareSautiStreamPlayback(video), true);
    const hls = h.instances[0]; hls.manifest();
    acceptedWithoutRestart(hls);
    await video.play(); await flush(); video.emit('loadedmetadata');
    acceptedWithoutRestart(hls);
    assert.equal(hls.lifecycle.metrics.fragmentAborts, 0);
    assert.equal(hls.lifecycle.metrics.initAborts, 0); assert.equal(hls.lifecycle.metrics.resets, 0);
    assert.equal(h.requests.length, 1); assert.equal(h.instances.length, 1);
  } finally { h.close(); }
});

test('production autoplay and loadedmetadata restoration do not restart a loading controller', async () => {
  const h = await harness();
  try {
    const video = await h.attachPlaying();
    const hls = h.instances[0]; acceptedWithoutRestart(hls);
    video.emit('loadedmetadata'); await flush();
    assert.equal(video.plays, 2, 'both initial resume and metadata restoration run through production code');
    acceptedWithoutRestart(hls);
    assert.equal(hls.lifecycle.metrics.fragmentAborts, 0);
    assert.equal(hls.lifecycle.metrics.initAborts, 0); assert.equal(hls.lifecycle.metrics.resets, 0);
  } finally { h.close(); }
});

test('a genuine production pause aborts work and the next play resumes the same unexpired controller', async () => {
  const h = await harness();
  try {
    const video = await h.attachPlaying(), hls = h.instances[0];
    acceptedWithoutRestart(hls);
    const expiry = video.__sautiStreamState.expiresAt;
    video.pause();
    assert.equal(hls.loadingEnabled, false);
    assert.equal(hls.lifecycle.metrics.fragmentAborts, 1); assert.equal(hls.lifecycle.metrics.initAborts, 1);
    assert.equal(hls.lifecycle.metrics.resets, 1);
    assert.equal(await h.runtime.prepareSautiStreamPlayback(video), true);
    await video.play(); await flush(); acceptedWithoutRestart(hls, 2);
    assert.equal(h.requests.length, 1); assert.equal(h.instances.length, 1);
    assert.equal(video.__sautiStreamState.expiresAt, expiry, 'resume never extends the grant');
    assert.equal(hls.lifecycle.metrics.fragmentAborts, 1); assert.equal(hls.lifecycle.metrics.initAborts, 1);
  } finally { h.close(); }
});

test('offscreen play cannot resume pending SDK work, but a visible return can', async () => {
  const h = await harness();
  try {
    const video = await h.attachPlaying(), hls = h.instances[0];
    video.bounds = { top: 900, bottom: 1300, height: 400 }; video.pause();
    const starts = hls.lifecycle.metrics.starts.length;
    await video.play(); await flush();
    assert.equal(video.paused, true); assert.equal(hls.loadingEnabled, false);
    assert.equal(hls.lifecycle.metrics.starts.length, starts);
    video.bounds = { top: 0, bottom: 400, height: 400 };
    await video.play(); await flush();
    acceptedWithoutRestart(hls, starts + 1);
    assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});

test('forced renewal still replaces a loading controller rather than skipping fresh authorization', async () => {
  const h = await harness();
  try {
    const video = await h.attachPlaying(), old = h.instances[0];
    acceptedWithoutRestart(old);
    const renewal = h.timers.get(video.__sautiStreamState.renewTimer);
    assert.ok(renewal); renewal.callback(); await flush();
    assert.equal(h.requests.length, 2); assert.equal(h.instances.length, 2);
    const replacement = h.instances[1];
    assert.equal(old.destroyed, true); assert.equal(old.loadingEnabled, false);
    assert.notEqual(replacement.url, old.url);
    replacement.manifest(); await flush(); video.emit('loadedmetadata'); await flush();
    acceptedWithoutRestart(replacement);
    assert.equal(replacement.lifecycle.metrics.fragmentAborts, 0);
    assert.equal(replacement.lifecycle.metrics.initAborts, 0); assert.equal(replacement.lifecycle.metrics.resets, 0);
  } finally { h.close(); }
});
