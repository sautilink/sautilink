import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getVideoAutoplayPreference,
  setVideoAutoplayPreference,
  VIDEO_AUTOPLAY_EVENT,
} from '../src/video-autoplay-preference.js';

test('video autoplay defaults on and keeps an off choice after the module reloads', async () => {
  const values = new Map();
  const events = [];
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  globalThis.document = { dispatchEvent: (event) => events.push(event) };
  globalThis.CustomEvent = class {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  };

  try {
    assert.equal(getVideoAutoplayPreference(), true);
    assert.equal(setVideoAutoplayPreference(false), false);
    assert.equal(values.get('sautilink:video-autoplay:v1'), 'off');
    assert.equal(events.at(-1).type, VIDEO_AUTOPLAY_EVENT);
    assert.deepEqual(events.at(-1).detail, { enabled: false });

    const reloaded = await import('../src/video-autoplay-preference.js?reload=1');
    assert.equal(reloaded.getVideoAutoplayPreference(), false);
    assert.equal(reloaded.setVideoAutoplayPreference(true), true);
    assert.equal(values.get('sautilink:video-autoplay:v1'), 'on');
  } finally {
    delete globalThis.localStorage;
    delete globalThis.document;
    delete globalThis.CustomEvent;
  }
});
