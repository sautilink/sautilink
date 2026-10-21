import assert from 'node:assert/strict';
import test from 'node:test';
import Hls from 'hls.js';
import { getVideoQualityPreference, setVideoQualityPreference } from '../src/video-quality-preference.js';

const MEDIA = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://sautilink.com';
const MP4 = `/api/sauti-media/${MEDIA}`;
let runtimeId = 0;
async function flush() { await new Promise(setImmediate); await new Promise(setImmediate); }

/** Browser event flow with the pinned SDK's real setters, not fake setter
 * semantics. The source/decoder remain in memory; no account or HTTP is used.
 */
async function harness({ short = false } = {}) {
  const keys = ['window', 'document', 'HTMLVideoElement', 'localStorage', 'MutationObserver', 'fetch'];
  const previous = Object.fromEntries(keys.map((key) => [key, globalThis[key]]));
  const storage = new Map();
  const document = new EventTarget();
  document.visibilityState = 'visible'; document.documentElement = {};
  const instances = [];
  class Video extends EventTarget {
    constructor() {
      super(); this.dataset = { sautiMediaId: MEDIA, sautiManualPlay: 'true' };
      this.currentTime = 12; this.duration = 30; this.playbackRate = 1.5;
      this.paused = false; this.isConnected = true; this.src = MP4; this.loads = 0; this.plays = 0;
    }
    closest(selector) { return short && selector === '#sauti-short-videos' ? {} : null; }
    play() { this.paused = false; this.plays++; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    load() { this.loads++; }
    canPlayType() { return ''; }
  }
  class Runtime {
    static Events = { MANIFEST_PARSED: 'manifestParsed', LEVEL_SWITCHED: 'levelSwitched', ERROR: 'error' };
    static isSupported() { return true; }
    constructor() {
      this.events = new Map(); this.logger = { log() {} };
      this.levels = [{ width: 640, height: 360 }, { width: 480, height: 854 }, { width: 960, height: 540 }];
      this.levelController = { manualLevel: -1 };
      this.safeSwitches = 0; this.immediateSwitches = 0;
      this.streamController = {
        nextLevelSwitch: () => { this.safeSwitches++; },
        immediateLevelSwitch: () => { this.immediateSwitches++; },
      };
      instances.push(this);
    }
    on(type, handler) { this.events.set(type, [...(this.events.get(type) || []), handler]); }
    emit(type, data) { for (const handler of this.events.get(type) || []) handler(type, data); }
    loadSource() {}
    attachMedia(video) { this.video = video; }
    startLoad() {}
    stopLoad() {}
    destroy() {}
  }
  for (const property of ['loadLevel', 'nextLevel', 'currentLevel']) {
    Object.defineProperty(Runtime.prototype, property, Object.getOwnPropertyDescriptor(Hls.prototype, property));
  }
  globalThis.document = document;
  globalThis.window = { Hls: Runtime, location: { origin: ORIGIN }, setTimeout() { return 1; }, clearTimeout() {}, addEventListener() {} };
  globalThis.HTMLVideoElement = Video;
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
  globalThis.MutationObserver = class { observe() {} };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${MP4}/playback`); assert.equal(options.redirect, 'error');
    return { ok: true, async json() { return { ok: true, data: {
      type: 'hls', url: `${ORIGIN}${MP4}/hls/m_${'a'.repeat(43)}?c=opaque.${'b'.repeat(43)}`,
      expires_in: 300, expires_at: new Date(Date.now() + 300_000).toISOString(),
    } }; } };
  };
  const runtime = await import(`../src/sauti-stream-web-player.js?quality-switch-test=${++runtimeId}`);
  const video = new Video(); runtime.enhanceSautiStreamPlayback(video); await flush();
  const hls = instances[0]; assert.ok(hls); hls.emit(Runtime.Events.MANIFEST_PARSED);
  hls.emit(Runtime.Events.LEVEL_SWITCHED, { level: 1 });
  return {
    video, hls, levels: runtime.streamQualityState(video).levels,
    state: () => runtime.streamQualityState(video),
    switched(level) { hls.emit(Runtime.Events.LEVEL_SWITCHED, { level }); },
    close() {
      video.isConnected = false; document.dispatchEvent(new Event('visibilitychange'));
      for (const key of keys) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; }
    },
  };
}

test('manual selection invokes the pinned safe-switch setter instead of waiting for the whole buffer', async () => {
  const h = await harness();
  try {
    assert.equal(Hls.version, '1.7.3');
    assert.equal(h.state().actual, 480);
    const switches = h.hls.safeSwitches, plays = h.video.plays;
    assert.equal(setVideoQualityPreference('360', { streamLevels: h.levels }), '360');
    assert.equal(h.hls.levelController.manualLevel, 0);
    assert.equal(h.hls.safeSwitches, switches + 1, 'loadLevel alone never requests this safe buffered switch');
    assert.equal(h.hls.immediateSwitches, 0, 'currentLevel would force an interrupting switch');
    assert.equal(h.state().preference, '360');
    assert.equal(h.state().actual, 480, 'report the actual rendition until the playhead changes fragments');
    h.switched(0); assert.equal(h.state().actual, 360);
    assert.equal(h.video.currentTime, 12); assert.equal(h.video.playbackRate, 1.5);
    assert.equal(h.video.loads, 0); assert.equal(h.video.plays, plays); assert.equal(h.video.paused, false);
  } finally { h.close(); }
});

test('an advertised 540p survives storage and selection while MP4 callers keep their whitelist', async () => {
  const h = await harness();
  try {
    assert.deepEqual(h.levels, [360, 480, 540]);
    assert.equal(setVideoQualityPreference('540', { streamLevels: h.levels }), '540');
    assert.equal(getVideoQualityPreference({ streamLevels: h.levels }), '540');
    assert.equal(getVideoQualityPreference(), 'auto');
    assert.equal(h.state().preference, '540'); assert.equal(h.hls.levelController.manualLevel, 2);
    h.switched(2); assert.equal(h.state().actual, 540);
    assert.equal(setVideoQualityPreference('576', { streamLevels: h.levels }), 'auto');
    assert.equal(h.state().preference, 'auto'); assert.equal(h.hls.levelController.manualLevel, -1);
  } finally { h.close(); }
});

test('Auto, Data Saver and standard 480p preserve manual pause, rate and position', async () => {
  const h = await harness();
  try {
    h.video.pause(); const plays = h.video.plays;
    for (const [preference, index] of [['480', 1], ['data-saver', 0], ['auto', -1]]) {
      const switches = h.hls.safeSwitches;
      assert.equal(setVideoQualityPreference(preference, { streamLevels: h.levels }), preference);
      assert.equal(h.hls.levelController.manualLevel, index); assert.equal(h.state().preference, preference);
      assert.equal(h.hls.safeSwitches, switches + 1); assert.equal(h.hls.immediateSwitches, 0);
      assert.equal(h.video.paused, true); assert.equal(h.video.plays, plays); assert.equal(h.video.loads, 0);
      assert.equal(h.video.currentTime, 12); assert.equal(h.video.playbackRate, 1.5);
    }
  } finally { h.close(); }
});

test('Short Videos keep Auto when a Home manual Stream preference changes', async () => {
  const h = await harness({ short: true });
  try {
    setVideoQualityPreference('540', { streamLevels: h.levels });
    assert.equal(h.state().preference, 'auto'); assert.equal(h.hls.levelController.manualLevel, -1);
  } finally { h.close(); }
});
