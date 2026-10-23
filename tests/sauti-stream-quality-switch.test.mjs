import assert from 'node:assert/strict';
import test from 'node:test';
import Hls from 'hls.js';
import { getVideoQualityPreference, setVideoQualityPreference } from '../src/video-quality-preference.js';

const MEDIA = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://sautilink.com';
const MP4 = `/api/sauti-media/${MEDIA}`;
let runtimeId = 0;
async function flush() { await new Promise(setImmediate); await new Promise(setImmediate); }
const sdkReference = new Hls({ enableWorker: false, autoStartLoad: false, startLevel: 0 });
const levelPrototype = Object.getPrototypeOf(sdkReference.levelController);
const levelDescriptors = Object.fromEntries(['manualLevel', 'startLevel'].map((name) =>
  [name, Object.getOwnPropertyDescriptor(levelPrototype, name)]));
sdkReference.destroy();

/** Browser event flow with the pinned SDK's real setters, not fake setter
 * semantics. The source/decoder remain in memory; no account or HTTP is used.
 */
async function harness({ short = false, loop = false, preference = 'auto', beforeManifest } = {}) {
  const keys = ['window', 'document', 'HTMLVideoElement', 'localStorage', 'MutationObserver', 'fetch'];
  const previous = Object.fromEntries(keys.map((key) => [key, globalThis[key]]));
  const storage = new Map();
  storage.set('sautilink:video-quality:v1', preference);
  const document = new EventTarget();
  document.visibilityState = 'visible'; document.documentElement = {};
  const instances = [], requests = [];
  class Video extends EventTarget {
    constructor() {
      super(); this.dataset = { sautiMediaId: MEDIA, sautiManualPlay: 'true' };
      this.currentTime = 12; this.duration = 30; this.playbackRate = 1.5;
      this.paused = false; this.isConnected = true; this.src = MP4; this.loads = 0; this.plays = 0;
      this.loop = loop;
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
    constructor(config) {
      this.events = new Map(); this.logger = { log() {} };
      this.config = config; this.firstAutoLevel = 2; this.minAutoLevel = 0;
      this.abrController = { forcedAutoLevel: -1 };
      this.levels = [{ width: 640, height: 360 }, { width: 480, height: 854 }, { width: 960, height: 540 }];
      this.levelController = { hls: this, manualLevelIndex: -1, level: -1 };
      Object.defineProperties(this.levelController, levelDescriptors);
      this.starts = [];
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
    startLoad() { this.starts.push({ level: this.startLevel, bitrateTest: this.startLevel === -1 }); }
    stopLoad() {}
    destroy() {}
  }
  for (const property of ['loadLevel', 'nextLevel', 'currentLevel', 'startLevel']) {
    Object.defineProperty(Runtime.prototype, property, Object.getOwnPropertyDescriptor(Hls.prototype, property));
  }
  globalThis.document = document;
  globalThis.window = { Hls: Runtime, location: { origin: ORIGIN }, setTimeout() { return 1; }, clearTimeout() {}, addEventListener() {} };
  globalThis.HTMLVideoElement = Video;
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
  globalThis.MutationObserver = class { observe() {} };
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    assert.equal(url, `${MP4}/playback`); assert.equal(options.redirect, 'error');
    return { ok: true, async json() { return { ok: true, data: {
      type: 'hls', url: `${ORIGIN}${MP4}/hls/m_${'a'.repeat(43)}?c=opaque.${'b'.repeat(43)}`,
      expires_in: 300, expires_at: new Date(Date.now() + 300_000).toISOString(),
    } }; } };
  };
  const runtime = await import(`../src/sauti-stream-web-player.js?quality-switch-test=${++runtimeId}`);
  const video = new Video(); runtime.enhanceSautiStreamPlayback(video); await flush();
  const hls = instances[0]; assert.ok(hls); beforeManifest?.(); hls.emit(Runtime.Events.MANIFEST_PARSED);
  hls.emit(Runtime.Events.LEVEL_SWITCHED, { level: 1 });
  return {
    video, hls, runtime, instances, requests, levels: runtime.streamQualityState(video).levels,
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

test('the pinned SDK initial Auto setter overrides the configured low start and enables an unbuffered bitrate test', () => {
  const previousSelf = globalThis.self;
  globalThis.self = globalThis;
  const hls = new Hls({ enableWorker: false, autoStartLoad: false, startLevel: 0 });
  try {
    assert.equal(hls.startLevel, 0); assert.equal(hls.manualLevel, -1);
    hls.nextLevel = -1;
    assert.equal(hls.config.startLevel, 0, 'the config value alone cannot reveal its SDK override');
    assert.equal(hls.startLevel, -1, 'the first manualLevel assignment overrides config.startLevel');
  } finally { hls.destroy(); if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf; }
});

test('new Home and Shorts Auto controllers buffer the configured low start instead of probing then selecting a higher ABR level', async () => {
  for (const short of [false, true]) {
    const h = await harness({ short });
    try {
      assert.equal(h.hls.config.startLevel, 0);
      assert.deepEqual(h.hls.starts[0], { level: 0, bitrateTest: false });
      assert.equal(h.hls.firstAutoLevel, 2, 'a higher ABR estimate must not replace the first warmed rendition');
      assert.equal(h.hls.levelController.manualLevel, -1, 'automatic adaptation remains enabled after the initial fragment');
      assert.equal(h.hls.safeSwitches, 0, 'initial Auto must not invoke the SDK setter that overrides startLevel');
      const loads = h.video.loads, plays = h.video.plays;
      assert.equal(await h.runtime.prepareSautiStreamPlayback(h.video), true);
      assert.equal(h.instances.length, 1); assert.equal(h.requests.length, 1, 'valid replay retains its controller and grant');
      assert.equal(h.video.loads, loads); assert.equal(h.video.plays, plays);
    } finally { h.close(); }
  }
});

test('initial manual quality and forced Auto renewal retain the existing SDK setter behavior', async () => {
  const manual = await harness({ preference: '480' });
  try {
    assert.equal(manual.hls.config.startLevel, undefined);
    assert.equal(manual.hls.levelController.manualLevel, 1);
    assert.deepEqual(manual.hls.starts[0], { level: 1, bitrateTest: false });
    assert.equal(manual.hls.safeSwitches, 1);
  } finally { manual.close(); }
  const auto = await harness();
  try {
    assert.equal(auto.hls.starts[0].level, 0);
    auto.video.__sautiStreamState.expiresAt = 0;
    assert.equal(await auto.runtime.prepareSautiStreamPlayback(auto.video), true);
    assert.equal(auto.requests.length, 2, 'renewal still obtains a fresh descriptor');
    const renewed = auto.instances[1]; renewed.emit(auto.instances[0].constructor.Events.MANIFEST_PARSED);
    assert.deepEqual(renewed.starts[0], { level: -1, bitrateTest: true });
    assert.equal(renewed.levelController.manualLevel, -1); assert.equal(renewed.safeSwitches, 1);
  } finally { auto.close(); }
});

test('a manual-to-Auto change before the first manifest retains the ordinary Auto setter path', async () => {
  const h = await harness({ preference: '480', beforeManifest: () => setVideoQualityPreference('auto') });
  try {
    assert.equal(h.hls.config.startLevel, undefined, 'this controller was constructed for a manual initial preference');
    assert.deepEqual(h.hls.starts[0], { level: -1, bitrateTest: true });
    assert.equal(h.hls.safeSwitches, 1); assert.equal(h.state().preference, 'auto');
  } finally { h.close(); }
});

test('looped adaptive playback retains its earlier rendition after an upgrade while the sixty-second eviction budget still applies', async () => {
  const fragment = { level: 1, start: 4, elementaryStreams: { video: { startDTS: 4, partial: false } } };
  const previousFragment = { level: 0 };
  const baseline = new Hls({ enableWorker: false, autoStartLoad: false, backBufferLength: 60 });
  try {
    baseline.bufferController.media = { loop: true };
    assert.equal(baseline.bufferController.getLoopBackBufferFlushEnd(fragment, previousFragment), 3.75,
      'the pinned SDK normally removes the loop beginning on a quality upgrade despite the sixty-second budget');
  } finally {
    baseline.bufferController.media = null;
    baseline.destroy();
  }
  for (const loop of [true, false]) {
    const h = await harness({ short: loop, loop });
    let sdk;
    try {
      assert.equal(Object.hasOwn(h.hls.config, 'loopBackBufferFlush'), loop,
        'nonlooped playback leaves the SDK option at its existing default');
      if (loop) assert.equal(h.hls.config.loopBackBufferFlush, false);
      sdk = new Hls({ ...h.hls.config, enableWorker: false });
      const buffer = sdk.bufferController;
      buffer.media = { loop, currentTime: 4 };
      assert.equal(buffer.getLoopBackBufferFlushEnd(fragment, previousFragment), 0,
        'the actual SDK must not schedule eviction of the earlier low rendition on this loop');
      assert.equal(sdk.config.backBufferLength, 60);
      assert.equal(sdk.config.maxBufferLength, 20);
      assert.equal(sdk.config.maxMaxBufferLength, 40);
      assert.equal(sdk.config.maxBufferSize, 24 * 1024 * 1024);

      // Exercise the SDK trimming policy; substitute only the final physical
      // SourceBuffer removal, which requires a real browser decoder.
      const evictions = [];
      buffer.details = { live: false, levelTargetDuration: 4 };
      buffer.sourceBuffers = [['video', {}], [null, null]];
      buffer.flushBackBuffer = (_time, _targetDuration, position) => evictions.push(position);
      buffer.trimBuffers(Infinity, sdk.config.backBufferLength, fragment, previousFragment);
      assert.deepEqual(evictions, [], 'an eight-second loop keeps its buffered beginning after an upgrade');
      buffer.media.currentTime = 80;
      buffer.trimBuffers(Infinity, sdk.config.backBufferLength, fragment, previousFragment);
      assert.deepEqual(evictions, [20], 'ordinary age eviction remains bounded rather than retaining an entire long video');
    } finally {
      if (sdk) {
        sdk.bufferController.media = null;
        sdk.bufferController.details = null;
        sdk.bufferController.sourceBuffers = [[null, null], [null, null]];
        sdk.destroy();
      }
      h.close();
    }
  }
});
