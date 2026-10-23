import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { bindVideoBuffering } from '../src/video-buffering-state.js';
import { enhanceSautiVideoQuality, registerVideoMediaMetadata } from '../src/video-quality-preference.js';

function fixture() {
  const callbacks = new Map(), timers = new Map(), changes = [];
  let sequence = 0;
  const video = { paused: true, isConnected: true, readyState: 0, ended: false, error: null,
    addEventListener: (name, callback) => callbacks.set(name, callback),
    removeEventListener: (name) => callbacks.delete(name),
  };
  const dispose = bindVideoBuffering(video, (...args) => changes.push(args), {
    setTimer(callback) { timers.set(++sequence, callback); return sequence; },
    clearTimer: (id) => timers.delete(id), visible: () => true,
  });
  return { video, changes, dispose, timers,
    event(name, detail) { callbacks.get(name)?.({ detail }); },
    tick() { const pending = [...timers]; timers.clear(); for (const [, callback] of pending) callback(); },
  };
}

test('adaptive preparation parks speculative work before play and shows only delayed loading', () => {
  const h = fixture();
  h.event('sautilink:video-preparing', { active: true });
  assert.deepEqual(h.changes, [[true, false]]);
  assert.equal(h.video.paused, true, 'preparation must not start native MP4 playback');
  h.tick(); assert.deepEqual(h.changes.at(-1), [true, true]);
  h.event('sautilink:video-preparing', { active: false });
  assert.deepEqual(h.changes.at(-1), [false, false]);
  h.event('waiting'); assert.equal(h.timers.size, 0, 'an ordinary user pause stays quiet');
  h.dispose();
});

test('an explicit pause or failed/disconnected preparation cannot leave its spinner alive', () => {
  for (const stop of ['pause', 'error', 'disconnect']) {
    const h = fixture();
    h.event('sautilink:video-preparing', { active: true });
    if (stop === 'disconnect') { h.video.isConnected = false; h.tick(); }
    else h.event(stop);
    assert.deepEqual(h.changes.at(-1), [false, false]);
    assert.equal(h.timers.size, 0);
    h.dispose();
  }
});

test('a first unmuted control gesture invokes native play synchronously without waiting for network preparation', async () => {
  const source = await readFile(new URL('../src/sautilink-video-player.js', import.meta.url), 'utf8');
  const begin = source.indexOf('  const togglePlayback = () => {');
  const end = source.indexOf('\n  const flashSeek = ', begin);
  assert.ok(begin >= 0 && end > begin);
  const events = [], video = { dataset: { sautiUserPaused: 'true' }, paused: true, ended: false, muted: false,
    play() { events.push('play'); this.paused = false; return Promise.resolve(); },
    pause() { events.push('pause'); this.paused = true; },
  };
  const handler = vm.runInNewContext(`${source.slice(begin, end)}\ntogglePlayback;`, {
    video, showControls() {}, window: { SautiLinkStreamPlayback: { prepare() { throw new Error('gesture was delayed'); } } },
  });
  handler(); events.push('gesture-returned');
  assert.deepEqual(events, ['play', 'gesture-returned']);
  assert.equal(video.dataset.sautiManualPlay, 'true');
  handler(); assert.equal(video.dataset.sautiUserPaused, 'true');
  assert.equal(video.dataset.sautiManualPlay, undefined);
  assert.deepEqual(events, ['play', 'gesture-returned', 'pause']);
});

test('a delayed legacy quality preparation rechecks current visibility and adaptive ownership before touching src', async () => {
  const previous = Object.fromEntries(['window', 'HTMLVideoElement'].map((key) => [key, globalThis[key]]));
  try {
    for (const change of ['offscreen', 'adaptive']) {
      let finish, ensures = 0;
      const pending = new Promise((resolve) => { finish = resolve; });
      globalThis.window = { location: { origin: 'https://sautilink.com' },
        SautiLinkVideoMediaSession: { ensure() { ensures++; return pending; } },
        SautiLinkStreamPlayback: { eligible(video) { return video.visible; } },
      };
      class Video {
        constructor() { this.dataset = { sautiMediaId: '11111111-1111-4111-8111-111111111111' }; this.visible = true;
          this.isConnected = true; this.src = `/api/sauti-media/${this.dataset.sautiMediaId}`; this.loads = 0;
          this.__sautiStreamState = { checkedAt: 1, resolving: false }; }
        getAttribute(name) { return this[name]; }
        closest() { return null; }
        addEventListener() {}
        load() { this.loads++; }
      }
      globalThis.HTMLVideoElement = Video;
      const video = new Video();
      registerVideoMediaMetadata({ id: video.dataset.sautiMediaId, media_kind: 'video', width: 1080, height: 1920, duration_ms: 5000 });
      enhanceSautiVideoQuality(video);
      assert.equal(ensures, 1);
      if (change === 'offscreen') video.visible = false;
      else video.__sautiStreamState.resolving = true;
      finish(); await new Promise(setImmediate);
      assert.equal(video.loads, 0);
      assert.equal(video.src, `/api/sauti-media/${video.dataset.sautiMediaId}`);
      assert.equal(video.__sautiVideoQualityState.switching, false);
      video.isConnected = false;
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('a delayed Shorts prepare cannot start the departed clip when the active slide changes', async () => {
  const source = await readFile(new URL('../src/short-videos-feed.js', import.meta.url), 'utf8');
  const begin = source.indexOf('async function playActiveShortVideo(');
  const end = source.indexOf('\nfunction currentShortVideoReturnPath', begin);
  assert.ok(begin >= 0 && end > begin);
  let finish, active = true, plays = 0;
  const pending = new Promise((resolve) => { finish = resolve; });
  const slide = { closest: () => ({}), classList: { contains: () => active } };
  const video = { dataset: {}, play() { plays++; return Promise.resolve(); }, pause() {} };
  const play = vm.runInNewContext(`${source.slice(begin, end)}\nplayActiveShortVideo;`, {
    SHORT_VIDEOS_ROOT_ID: 'sauti-short-videos', shortVideoPlaybackAllowed: () => true,
    getVideoAutoplayPreference: () => true, window: { SautiLinkStreamPlayback: { prepare: () => pending } },
  });
  const first = play(video, slide); active = false; finish(); await first;
  assert.equal(plays, 0);
  active = true; await play(video, slide); assert.equal(plays, 1);
});
