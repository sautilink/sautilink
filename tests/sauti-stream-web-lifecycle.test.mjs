import assert from 'node:assert/strict';
import test from 'node:test';
import { enhanceSautiStreamPlayback, installSautiStreamAuthLifecycle, streamQualityState } from '../src/sauti-stream-web-player.js';

const MEDIA = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';
const ORIGIN = 'https://sautilink.com';
const MP4 = `/api/sauti-media/${MEDIA}`;

function session(user = USER) {
  return { user: { id: user }, access_token: `header.${Buffer.from(JSON.stringify({ session_id: SESSION })).toString('base64url')}.signature` };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function descriptorResponse(generation = 'a') {
  return { ok: true, async json() { return { ok: true, data: {
    type: 'hls', url: `${ORIGIN}${MP4}/hls/m_${generation.repeat(64)}?c=opaque.${'b'.repeat(43)}`,
    expires_in: 300, expires_at: new Date(Date.now() + 300000).toISOString(),
  } }; } };
}
async function flush() {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
}

/** Exercise the production module with controllable network, media and SDK events. */
function harness() {
  const previous = Object.fromEntries(['window', 'document', 'HTMLVideoElement', 'CustomEvent', 'fetch'].map((key) => [key, globalThis[key]]));
  const originalWarn = console.warn;
  const responses = [], requests = [], warnings = [], instances = [], timers = new Map();
  let timerId = 0, authCallback;
  class FakeVideo {
    constructor() {
      this.dataset = { sautiMediaId: MEDIA, sautiManualPlay: 'true' };
      this.listeners = new Map(); this.paused = false; this.isConnected = true;
      this.currentTime = 18; this.duration = 120; this.playbackRate = 1.5;
      this.src = MP4; this.poster = 'poster'; this.plays = 0; this.loads = 0;
    }
    closest() { return null; }
    addEventListener(type, callback, options = {}) {
      const entries = this.listeners.get(type) || new Map(); entries.set(callback, options); this.listeners.set(type, entries);
    }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    emit(type, event = { type, target: this }) {
      for (const [callback, options] of [...(this.listeners.get(type) || [])]) {
        if (options.once) this.removeEventListener(type, callback);
        callback(event);
      }
    }
    dispatchEvent(event) { this.emit(event.type, event); return true; }
    play() { this.paused = false; this.plays++; this.emit('play'); return Promise.resolve(); }
    pause() { this.paused = true; this.emit('pause'); }
    removeAttribute(name) { this[name] = ''; }
    load() { this.loads++; this.paused = true; this.currentTime = 0; }
    canPlayType() { return ''; }
  }
  class FakeHls {
    static Events = { MANIFEST_PARSED: 'manifestParsed', LEVEL_SWITCHED: 'levelSwitched', ERROR: 'error' };
    static isSupported() { return true; }
    constructor(config) {
      this.config = config; this.handlers = new Map(); this.starts = []; this.stops = 0; this.destroyed = 0;
      this.levels = [{ width: 426, height: 240, bitrate: 300000 }, { width: 1280, height: 720, bitrate: 1500000 }];
      instances.push(this);
    }
    on(type, callback) { const entries = this.handlers.get(type) || []; entries.push(callback); this.handlers.set(type, entries); }
    emit(type, detail) { for (const callback of this.handlers.get(type) || []) callback(type, detail); }
    loadSource(url) { this.url = url; }
    attachMedia(video) { this.video = video; video.src = `blob:hls-${instances.indexOf(this)}`; video.paused = true; video.currentTime = 0; }
    startLoad(position) { this.starts.push(position); }
    stopLoad() { this.stops++; }
    destroy() { this.destroyed++; }
    fatal(extra = {}) { this.emit(FakeHls.Events.ERROR, { fatal: true, type: 'networkError', details: 'fragLoadError', response: { code: 403 }, ...extra }); }
    manifest() { this.emit(FakeHls.Events.MANIFEST_PARSED); }
  }
  globalThis.window = {
    Hls: FakeHls, location: { origin: ORIGIN },
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.document = { visibilityState: 'visible' };
  globalThis.HTMLVideoElement = FakeVideo;
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    assert.equal(url, `${MP4}/playback`);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    if (!responses.length) throw new Error('Unexpected descriptor request');
    return responses.shift();
  };
  console.warn = (...args) => warnings.push(args);
  installSautiStreamAuthLifecycle({ auth: { onAuthStateChange(callback) { authCallback = callback; return {}; } } });
  authCallback('INITIAL_SESSION', session());
  return {
    responses, requests, warnings, instances, timers, FakeVideo, FakeHls,
    async start() {
      responses.push(descriptorResponse());
      const video = new FakeVideo(); enhanceSautiStreamPlayback(video); await flush();
      assert.equal(instances.length, 1);
      instances[0].manifest(); video.emit('loadedmetadata');
      assert.equal(video.currentTime, 18); assert.equal(video.playbackRate, 1.5);
      return video;
    },
    renew(video) { const timer = timers.get(video.__sautiStreamState.renewTimer); assert.ok(timer); timer.callback(); },
    signIn(user) { authCallback('SIGNED_IN', session(user)); },
    close() {
      authCallback('SIGNED_OUT', null);
      console.warn = originalWarn;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
      }
    },
  };
}

test('an expired fragment joins proactive renewal, repeated errors cannot tear it down, and later grants can renew again', async () => {
  const h = harness();
  try {
    const video = await h.start();
    const first = h.instances[0], state = video.__sautiStreamState;
    const renewal = deferred(); h.responses.push(renewal.promise); h.renew(video); await flush();
    assert.equal(state.resolving, true); assert.equal(h.requests.length, 2);
    first.fatal(); first.fatal();
    assert.equal(first.destroyed, 0); assert.equal(video.dataset.sautiStreamManaged, 'true');
    assert.equal(h.requests.length, 2); assert.equal(h.warnings.length, 1);
    renewal.resolve(descriptorResponse('c')); await flush();
    assert.equal(h.instances.length, 2); assert.equal(first.destroyed, 1);
    const second = h.instances[1];
    assert.equal(state.hls, second); assert.equal(state.refreshAttempted, false);
    second.manifest(); video.emit('loadedmetadata');
    assert.equal(video.currentTime, 18); assert.equal(video.playbackRate, 1.5); assert.equal(video.paused, false);
    assert.equal(video.loads, 0); assert.equal(video.dataset.sautiStreamManaged, 'true');

    state.expiresAt = Date.now() - 1;
    h.responses.push(descriptorResponse('d')); second.fatal(); await flush();
    assert.equal(h.instances.length, 3); assert.equal(second.destroyed, 1);
    assert.equal(state.hls, h.instances[2]); assert.equal(state.refreshAttempted, false);
    assert.equal(video.dataset.sautiStreamManaged, 'true'); assert.equal(video.loads, 0);
    const quality = streamQualityState(video);
    first.emit(h.FakeHls.Events.LEVEL_SWITCHED, { level: 0 });
    assert.deepEqual(streamQualityState(video), quality, 'late events from the replaced controller cannot change current quality');
  } finally { h.close(); }
});

test('a pause during descriptor renewal survives manifest and metadata restoration', async () => {
  const h = harness();
  try {
    const video = await h.start(), renewal = deferred();
    h.responses.push(renewal.promise); h.renew(video); await flush();
    video.dataset.sautiUserPaused = 'true'; video.pause(); video.currentTime = 7;
    const plays = video.plays;
    h.instances[0].fatal();
    renewal.resolve(descriptorResponse('c')); await flush();
    h.instances[1].manifest(); video.emit('loadedmetadata');
    assert.equal(video.currentTime, 7); assert.equal(video.playbackRate, 1.5);
    assert.equal(video.paused, true); assert.equal(video.plays, plays);
    assert.equal(video.dataset.sautiStreamManaged, 'true'); assert.equal(video.loads, 0);
  } finally { h.close(); }
});

test('failed renewal falls back once while preserving a current pause and seek to zero', async () => {
  const h = harness();
  try {
    const video = await h.start(), state = video.__sautiStreamState, renewal = deferred();
    const first = h.instances[0];
    state.expiresAt = Date.now() - 1;
    // Even without a custom-control dataset flag, the real current pause wins.
    video.pause(); video.currentTime = 0;
    const plays = video.plays;
    h.responses.push(renewal.promise); first.fatal(); first.fatal(); await flush();
    renewal.resolve({ ok: false, status: 503 }); await flush();
    assert.equal(first.destroyed, 1); assert.equal(video.loads, 1); assert.equal(video.src, MP4);
    assert.equal(video.dataset.sautiStreamManaged, undefined); assert.equal(state.hls, null);
    video.emit('loadedmetadata');
    assert.equal(video.currentTime, 0); assert.equal(video.paused, true);
    assert.equal(video.playbackRate, 1.5); assert.equal(video.plays, plays);
    first.fatal(); await flush();
    assert.equal(video.loads, 1); assert.equal(h.requests.length, 2);
  } finally { h.close(); }
});

test('fatal diagnostics expose only known enums and bounded HTTP status, never SDK URLs or tokens', async () => {
  const h = harness();
  try {
    const video = await h.start();
    const secret = 'provider-secret-do-not-log';
    h.instances[0].fatal({
      type: `networkError:${secret}`, details: `${ORIGIN}/?token=${secret}`,
      response: { code: 403, text: secret, url: `${ORIGIN}/${secret}` },
      url: `${ORIGIN}/?c=${secret}`, networkDetails: { status: 403, headers: { authorization: secret } }, error: new Error(secret),
    });
    assert.equal(h.warnings.length, 1);
    assert.equal(h.warnings[0].length, 1, 'the diagnostic must be one visible string, never an SDK object');
    const prefix = '[SautiLink video] HLS fatal ';
    assert.equal(typeof h.warnings[0][0], 'string');
    assert.equal(h.warnings[0][0].startsWith(prefix), true);
    assert.deepEqual(JSON.parse(h.warnings[0][0].slice(prefix.length)), { type: 'unknown', details: 'unknown', status: 403 });
    assert.equal(JSON.stringify(h.warnings).includes(secret), false);
    assert.equal(JSON.stringify(h.warnings).includes(ORIGIN), false);
    assert.equal(video.src, MP4);
    h.instances[0].fatal();
    assert.equal(h.warnings.length, 1, 'stale controllers do not emit extra diagnostics');
  } finally { h.close(); }
});

test('visible fatal diagnostics retain known enums and only bounded HTTP status', async () => {
  const prefix = '[SautiLink video] HLS fatal ';
  for (const [responseStatus, expected] of [[503, 503], ['403', 403], [99, 0], [600, 0], ['token-in-status', 0]]) {
    const h = harness();
    try {
      await h.start();
      h.instances[0].fatal({ response: { code: responseStatus, text: 'private-response-body', headers: { authorization: 'private-bearer' } } });
      assert.deepEqual(h.warnings, [[`${prefix}${JSON.stringify({ type: 'networkError', details: 'fragLoadError', status: expected })}`]]);
      const parsed = JSON.parse(h.warnings[0][0].slice(prefix.length));
      assert.deepEqual(Object.keys(parsed), ['type', 'details', 'status']);
      assert.equal(parsed.status, expected);
      assert.equal(JSON.stringify(h.warnings).includes('private-'), false);
    } finally { h.close(); }
  }
});

test('account changes abort a renewal and remove stale metadata restorers before the element is rebound', async () => {
  const h = harness();
  try {
    h.responses.push(descriptorResponse());
    const video = new h.FakeVideo(); enhanceSautiStreamPlayback(video); await flush();
    const state = video.__sautiStreamState, renewal = deferred();
    h.instances[0].manifest();
    assert.equal(video.listeners.get('loadedmetadata').size, 1, 'the old attach is still awaiting metadata');
    h.responses.push(renewal.promise); h.renew(video); await flush();
    // A prior attach can still be waiting for metadata when account auth ends.
    const old = h.instances[0];
    const pendingSignal = h.requests[1].options.signal;
    h.signIn(OTHER_USER);
    assert.equal(pendingSignal.aborted, true); assert.equal(state.destroyed, true);
    assert.equal(old.destroyed, 1); assert.equal(video.__sautiStreamState, undefined);
    assert.equal(video.src, ''); assert.equal(video.poster, '');
    assert.equal(video.listeners.get('loadedmetadata').size, 0);
    video.currentTime = 2; video.playbackRate = 1;
    enhanceSautiStreamPlayback(video);
    const replacement = video.__sautiStreamState;
    renewal.resolve(descriptorResponse('c')); await flush();
    video.emit('loadedmetadata'); old.manifest(); old.fatal();
    assert.equal(h.instances.length, 1); assert.equal(video.__sautiStreamState, replacement);
    assert.equal(video.currentTime, 2); assert.equal(video.playbackRate, 1); assert.equal(video.src, '');
    assert.equal(video.dataset.sautiStreamManaged, undefined); assert.equal(h.warnings.length, 0);
  } finally { h.close(); }
});

test('a manifest arriving after the page is hidden cannot start loading or resume playback', async () => {
  const h = harness();
  try {
    h.responses.push(descriptorResponse());
    const video = new h.FakeVideo(); enhanceSautiStreamPlayback(video); await flush();
    globalThis.document.visibilityState = 'hidden';
    h.instances[0].manifest(); video.emit('loadedmetadata');
    assert.equal(h.instances[0].starts.length, 0); assert.equal(h.instances[0].stops, 1);
    assert.equal(video.plays, 0); assert.equal(video.paused, true);
  } finally { h.close(); }
});

test('a controller failing synchronously during replacement cannot count its own attach as successful recovery', async () => {
  const h = harness();
  try {
    const video = await h.start(), state = video.__sautiStreamState;
    const originalAttach = h.FakeHls.prototype.attachMedia;
    h.FakeHls.prototype.attachMedia = function (media) { originalAttach.call(this, media); this.fatal(); };
    state.expiresAt = Date.now() - 1;
    h.responses.push(descriptorResponse('c')); h.instances[0].fatal(); await flush();
    assert.equal(h.requests.length, 2); assert.equal(h.instances.length, 2);
    assert.equal(h.instances[1].destroyed, 1); assert.equal(state.hls, null);
    assert.equal(video.src, MP4); assert.equal(video.loads, 1);
    video.emit('loadedmetadata');
    assert.equal(video.currentTime, 18, 'an internal attach reset must not become a user seek to zero');
    assert.equal(video.playbackRate, 1.5); assert.equal(video.paused, false);
  } finally { h.close(); }
});
