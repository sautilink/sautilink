import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/profile-activity.js', import.meta.url), 'utf8');
const posterSource = source.slice(
  source.indexOf('async function loadProfileActivityVideoPoster('),
  source.indexOf('async function loadProtectedProfileActivityMedia('),
);

function posterHarness({ contentType = 'image/jpeg', requestOk = true, decodeFails = false } = {}) {
  const objectUrls = new Set();
  const revoked = [];
  const revealed = [];
  const requests = [];
  const video = { dataset: {}, poster: '' };
  const context = {
    AbortController,
    Image: class {
      async decode() {
        if (decodeFails) throw new Error('decode failed');
      }
    },
    URL: {
      createObjectURL() { return 'blob:profile-poster'; },
      revokeObjectURL(url) { revoked.push(url); },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: requestOk,
        headers: { get: () => contentType },
        blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }),
      };
    },
    profileActivityAccessToken: () => 'test-token',
    profileActivityFeedRequest: 1,
    profileActivityObjectUrls: objectUrls,
    revealProfileActivityMedia: (...args) => revealed.push(args),
    window: { setTimeout, clearTimeout },
  };
  const loadPoster = runInNewContext(`${posterSource}; loadProfileActivityVideoPoster`, context);
  return { loadPoster, context, objectUrls, revoked, revealed, requests, video };
}

test('profile videos show the protected JPEG poster before video bytes are ready', async () => {
  const harness = posterHarness();
  const placeholder = {};
  const loaded = await harness.loadPoster('media-id', harness.video, placeholder, 1);

  assert.equal(loaded, true);
  assert.equal(harness.requests[0].url, '/api/sauti-media/media-id?poster=1');
  assert.equal(harness.requests[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(harness.video.poster, 'blob:profile-poster');
  assert.equal(harness.revealed.length, 1);
  assert.equal(harness.revealed[0][1], placeholder);
  assert.ok(harness.objectUrls.has('blob:profile-poster'));
  assert.deepEqual(harness.revoked, []);
});

test('unavailable or undecodable posters leave the video fallback intact', async () => {
  for (const options of [{ requestOk: false }, { contentType: 'application/json' }, { decodeFails: true }]) {
    const harness = posterHarness(options);
    assert.equal(await harness.loadPoster('media-id', harness.video, {}, 1), false);
    assert.equal(harness.video.poster, '');
    assert.equal(harness.revealed.length, 0);
    assert.equal(harness.objectUrls.size, 0);
  }

  const createMedia = source.slice(source.indexOf('function createProfileActivityMedia('), source.indexOf('function createProfileActivityCard('));
  assert.match(createMedia, /media\.kind === 'video'[\s\S]*loadProfileActivityVideoPoster\(media\.id/);
  assert.match(createMedia, /loadProtectedProfileActivityMedia\([^;]*posterReady\)/);
});
