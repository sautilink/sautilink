import assert from 'node:assert/strict';
import test from 'node:test';
import { enhanceSautiStreamPlayback, installSautiStreamAuthLifecycle } from '../src/sauti-stream-web-player.js';

const MEDIA = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
function session(user = USER, id = SESSION) {
  return { user: { id: user }, access_token: `header.${Buffer.from(JSON.stringify({ session_id: id })).toString('base64url')}.signature` };
}

test('same-session focus/sign-in retains the player; account end cancels and permits a fresh single binding', () => {
  const previous = { window: globalThis.window, document: globalThis.document, HTMLVideoElement: globalThis.HTMLVideoElement };
  class FakeVideo {
    constructor() {
      this.dataset = { sautiMediaId: MEDIA, sautiStreamManaged: 'true' };
      this.listeners = new Map(); this.paused = true; this.isConnected = true;
      this.currentTime = 6; this.playbackRate = 1.5; this.src = 'blob:private-session'; this.poster = 'blob:private-poster';
    }
    closest() { return null; }
    addEventListener(type, callback) { const entries = this.listeners.get(type) || new Set(); entries.add(callback); this.listeners.set(type, entries); }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    pause() { this.paused = true; }
    removeAttribute(name) { this[name] = ''; }
    load() { this.loads = (this.loads || 0) + 1; }
  }
  let callback; let subscriptions = 0;
  const client = { auth: { onAuthStateChange(fn) { callback = fn; subscriptions++; return {}; } } };
  try {
    globalThis.window = { clearTimeout() {} };
    globalThis.document = { visibilityState: 'visible' };
    globalThis.HTMLVideoElement = FakeVideo;
    installSautiStreamAuthLifecycle(client);
    installSautiStreamAuthLifecycle(client);
    assert.equal(subscriptions, 1);
    callback('INITIAL_SESSION', session());
    const video = new FakeVideo();
    enhanceSautiStreamPlayback(video);
    const state = video.__sautiStreamState;
    let destroyed = 0;
    state.hls = { destroy() { destroyed++; } };
    state.abort = new AbortController();
    callback('SIGNED_IN', session());
    callback('SIGNED_IN', session());
    assert.equal(video.__sautiStreamState, state);
    assert.equal(state.destroyed, false);
    assert.equal(destroyed, 0);
    assert.equal(video.currentTime, 6); assert.equal(video.playbackRate, 1.5);
    callback('TOKEN_REFRESHED', session());
    assert.equal(destroyed, 0); assert.equal(state.expiresAt, 0);
    callback('SIGNED_IN', session('44444444-4444-4444-8444-444444444444'));
    assert.equal(state.abort.signal.aborted, true);
    assert.equal(destroyed, 1); assert.equal(state.destroyed, true);
    assert.equal(video.__sautiStreamState, undefined);
    assert.equal(video.src, ''); assert.equal(video.poster, '');
    assert.equal(video.listeners.get('play').size, 0); assert.equal(video.listeners.get('pause').size, 0);
    // The normal media renderer can authorize and bind the retained element again.
    video.src = `/api/sauti-media/${MEDIA}`;
    enhanceSautiStreamPlayback(video); enhanceSautiStreamPlayback(video);
    assert.notEqual(video.__sautiStreamState, state);
    assert.equal(video.listeners.get('play').size, 1); assert.equal(video.listeners.get('pause').size, 1);
    callback('SIGNED_OUT', null);
    assert.equal(video.__sautiStreamState, undefined); assert.equal(video.src, '');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
