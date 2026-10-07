import assert from 'node:assert/strict';
import test from 'node:test';

test('video autoplay rollout turns existing off choice on once, then preserves later choices', async () => {
  const values = new Map([['sautilink:video-autoplay:v1', 'off']]);
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
    const first = await import('../src/video-autoplay-preference.js?rollout=1');
    assert.equal(first.getVideoAutoplayPreference(), true);
    assert.equal(values.get('sautilink:video-autoplay:v1'), 'on');
    assert.equal(values.get('sautilink:video-autoplay-default:v2'), 'applied');

    assert.equal(first.setVideoAutoplayPreference(false), false);
    assert.equal(values.get('sautilink:video-autoplay:v1'), 'off');
    assert.equal(events.at(-1).type, first.VIDEO_AUTOPLAY_EVENT);
    assert.deepEqual(events.at(-1).detail, { enabled: false });

    const reloaded = await import('../src/video-autoplay-preference.js?rollout=2');
    assert.equal(reloaded.getVideoAutoplayPreference(), false);
    assert.equal(values.get('sautilink:video-autoplay:v1'), 'off');

    assert.equal(reloaded.setVideoAutoplayPreference(true), true);
    assert.equal(values.get('sautilink:video-autoplay:v1'), 'on');
  } finally {
    delete globalThis.localStorage;
    delete globalThis.document;
    delete globalThis.CustomEvent;
  }
});
