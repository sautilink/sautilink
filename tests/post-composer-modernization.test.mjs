import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { POST_BODY_LIMIT, hasPostFormatting, parsePostFormatting } from '../src/post-text-formatting.js';
import { applyHomeVideoAudio, rememberHomeVideoAudio, resetHomeVideoAudio } from '../src/home-video-audio-session.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('post formatting recognizes all four styles and leaves unpaired markers as text', () => {
  assert.equal(POST_BODY_LIMIT, 2000);
  const nodes = parsePostFormatting('**Bold** *Italic* __Underline__ ~~Strike~~');
  assert.deepEqual(nodes.filter((node) => node.tag).map((node) => node.tag), ['strong', 'em', 'u', 's']);
  assert.equal(hasPostFormatting('A plain post *with an unpaired marker'), false);
  assert.equal(hasPostFormatting('**One *nested* style**'), true);
  assert.deepEqual(parsePostFormatting('**One *nested* style**')[0].children.filter((node) => node.tag).map((node) => node.tag), ['em']);
});

test('home video audio choice follows the tab session and resets on sign-out', () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  try {
    resetHomeVideoAudio();
    const first = { dataset: {} };
    applyHomeVideoAudio(first);
    assert.equal(first.muted, true);
    rememberHomeVideoAudio(false, .65);
    const next = { dataset: {} };
    applyHomeVideoAudio(next);
    assert.equal(next.muted, false);
    assert.equal(next.volume, .65);
    assert.equal(next.dataset.sautiAudioPreference, 'unmuted');
    next.muted = true; // Browser policy can decline unmuted autoplay for this one video.
    applyHomeVideoAudio(next);
    assert.equal(next.muted, true);
    const following = { dataset: {} };
    applyHomeVideoAudio(following);
    assert.equal(following.muted, false);
    resetHomeVideoAudio();
    const fresh = { dataset: {} };
    applyHomeVideoAudio(fresh);
    assert.equal(fresh.muted, true);
    assert.equal(store.size, 0);
  } finally {
    delete globalThis.sessionStorage;
  }
});

test('composer, API and database accept 2,000 character posts consistently', async () => {
  const [html, api, migration] = await Promise.all([
    read('app/index.html'),
    read('src/sauti-posts-api.js'),
    read('supabase/migrations/20261010120000_expand_social_post_body_to_2000.sql'),
  ]);
  assert.match(html, /id="sauti-body"[^>]*maxlength="2000"/);
  assert.match(api, /body\.length > POST_BODY_LIMIT/);
  assert.match(migration, /char_length\(btrim\(body\)\) <= 2000/);
  assert.match(migration, /char_length\(v_body\) > 2000/);
  assert.match(migration, /v_post\.author_id <> v_user_id/);
  assert.match(migration, /v_post\.edit_count >= 1/);
});
