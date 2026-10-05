import assert from 'node:assert/strict';
import test from 'node:test';
import { getActivePlaybackVideo, installVideoPlaybackCoordinator } from '../src/video-playback-coordinator.js';
import { shouldResumeVideoAfterQualityChange } from '../src/video-quality-preference.js';

function playbackTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    emit(name, video) { listeners.get(name)?.({ target: video }); },
  };
}

function video() {
  return {
    nodeName: 'VIDEO',
    paused: true,
    isConnected: true,
    pause() { this.paused = true; this.pauseCount = (this.pauseCount || 0) + 1; },
    closest() { return null; },
  };
}

test('playing another video stops the previous one, including a detached video', () => {
  const target = playbackTarget();
  const cleanup = installVideoPlaybackCoordinator(target);
  const first = video();
  const second = video();
  first.paused = false;
  target.emit('play', first);
  first.isConnected = false;
  second.paused = false;
  target.emit('play', second);
  assert.equal(first.paused, true);
  assert.equal(first.pauseCount, 1);
  assert.equal(second.paused, false);
  assert.equal(getActivePlaybackVideo(), second);
  cleanup();
});

test('quality switching cannot restart an offscreen video or interrupt a newer video', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const target = playbackTarget();
  const cleanup = installVideoPlaybackCoordinator(target);
  const first = video();
  const second = video();
  first.getBoundingClientRect = () => ({ top: 900, bottom: 1100, height: 200 });
  first.closest = (selector) => selector === '#stream-feed' ? {} : null;
  try {
    globalThis.document = { visibilityState: 'visible', documentElement: { clientHeight: 700 } };
    globalThis.window = { innerHeight: 700 };
    target.emit('play', first);
    assert.equal(shouldResumeVideoAfterQualityChange(first, 'home'), false);
    first.getBoundingClientRect = () => ({ top: 100, bottom: 300, height: 200 });
    target.emit('play', second);
    assert.equal(shouldResumeVideoAfterQualityChange(first, 'home'), false);
    assert.equal(shouldResumeVideoAfterQualityChange(second, 'home'), true);
  } finally {
    cleanup();
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
