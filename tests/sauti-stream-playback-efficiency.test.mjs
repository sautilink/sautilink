import test from 'node:test';
import assert from 'node:assert/strict';
import { sautiStreamPlaybackDescriptor, serveSautiStreamHls, serveSautiStreamThumbnail } from '../src/sauti-stream-playback.js';

const ORIGIN = 'https://customer-example.cloudflarestream.com';
const ID = '11111111-1111-4111-8111-111111111111';
const GENERATION = '22222222-2222-4222-8222-222222222222';
const UID = 'a'.repeat(32);
const TOKEN = 'aaaa.bbbb.cccc';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
const asset = { kind: 'post', id: ID, generation: GENERATION, stream_uid: UID };
const options = { basePath: `/api/sauti-media/${ID}/hls/`, accessScope: 'Bearer authorized-viewer' };
const NOW = Math.floor(Date.now() / 1000);
const request = (signal) => new Request(`https://sautilink.com/api/sauti-media/${ID}?poster=1`, { signal });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture(generate = async () => TOKEN) {
  const calls = { tokens: 0, provider: 0 };
  const env = { SAUTI_STREAM_ORIGIN: ORIGIN, SAUTI_STREAM_SOURCE_KEY: 'a'.repeat(43),
    STREAM: { video(uid) { assert.equal(uid, UID); return { generateToken() { calls.tokens++; return generate(); } }; } } };
  return { env, calls };
}
function thumbnails(t, f) {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    f.calls.provider++;
    assert.equal(new URL(url).origin, f.env.SAUTI_STREAM_ORIGIN);
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
  });
}

test('concurrent same-binding same-UID callers share one private token operation, not responses', async t => {
  const token = deferred(), started = deferred();
  const f = fixture(() => { started.resolve(); return token.promise; }); thumbnails(t, f);
  const pending = Array.from({ length: 12 }, () => serveSautiStreamThumbnail(request(), f.env, asset, {}, NOW));
  await started.promise;
  assert.equal(f.calls.tokens, 1); assert.equal(f.calls.provider, 0);
  token.resolve(TOKEN);
  const responses = await Promise.all(pending);
  assert.equal(f.calls.tokens, 1); assert.equal(f.calls.provider, 12);
  for (const response of responses) {
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), JPEG);
  }
});

test('failed or invalid token generation is not retained and a later caller can retry', async t => {
  for (const mode of ['rejected', 'invalid']) await t.test(mode, async t => {
    let attempt = 0;
    const f = fixture(async () => ++attempt === 1 ? mode === 'invalid' ? 'invalid-token' : Promise.reject(new Error('unavailable')) : TOKEN);
    thumbnails(t, f);
    assert.equal((await serveSautiStreamThumbnail(request(), f.env, asset, {}, NOW)).status, 502);
    assert.equal(f.calls.provider, 0);
    assert.equal((await serveSautiStreamThumbnail(request(), f.env, asset, {}, NOW)).status, 200);
    assert.equal(f.calls.tokens, 2); assert.equal(f.calls.provider, 1);
  });
});

test('provider tokens remain isolated by binding and origin and refresh before their original deadline', async t => {
  const f = fixture(); thumbnails(t, f);
  assert.equal((await serveSautiStreamThumbnail(request(), f.env, asset, {}, NOW)).status, 200);
  assert.equal((await serveSautiStreamThumbnail(request(), f.env, asset, {}, NOW + 289)).status, 200);
  assert.equal(f.calls.tokens, 1);
  assert.equal((await serveSautiStreamThumbnail(request(), f.env, asset, {}, NOW + 290)).status, 200);
  assert.equal(f.calls.tokens, 2);
  f.env.SAUTI_STREAM_ORIGIN = 'https://customer-other.cloudflarestream.com';
  assert.equal((await serveSautiStreamThumbnail(request(), f.env, asset, {}, NOW + 291)).status, 200);
  assert.equal(f.calls.tokens, 3);
  const other = fixture();
  thumbnails(t, other);
  assert.equal((await serveSautiStreamThumbnail(request(), other.env, asset, {}, NOW + 292)).status, 200);
  assert.equal(other.calls.tokens, 1);
});

test('one cancelled token waiter cannot cancel a different live thumbnail caller', async t => {
  const token = deferred(), started = deferred(), controller = new AbortController();
  const f = fixture(() => { started.resolve(); return token.promise; }); thumbnails(t, f);
  const stopped = serveSautiStreamThumbnail(request(controller.signal), f.env, asset, {}, NOW);
  const live = serveSautiStreamThumbnail(request(), f.env, asset, {}, NOW);
  await started.promise; controller.abort(); token.resolve(TOKEN);
  assert.notEqual((await stopped).status, 200);
  assert.equal((await live).status, 200);
  assert.equal(f.calls.tokens, 1); assert.equal(f.calls.provider, 1);
});

test('the private token cache keeps at most its existing 128 entries, including completed flights', async t => {
  const counts = new Map();
  const env = { SAUTI_STREAM_ORIGIN: ORIGIN, STREAM: { video(uid) { return { async generateToken() {
    counts.set(uid, (counts.get(uid) || 0) + 1); return TOKEN;
  } }; } } };
  t.mock.method(globalThis, 'fetch', async () => new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } }));
  const ids = Array.from({ length: 129 }, (_, i) => i.toString(16).padStart(32, '0'));
  for (const uid of ids) assert.equal((await serveSautiStreamThumbnail(request(), env, { ...asset, stream_uid: uid }, {}, NOW)).status, 200);
  await serveSautiStreamThumbnail(request(), env, { ...asset, stream_uid: ids.at(-1) }, {}, NOW);
  assert.equal(counts.get(ids.at(-1)), 1);
  await serveSautiStreamThumbnail(request(), env, { ...asset, stream_uid: ids[0] }, {}, NOW);
  assert.equal(counts.get(ids[0]), 2, 'the oldest entry must have been evicted');
});

test('thumbnail cancellation reaches the provider and suppresses a late body that ignores its signal', async t => {
  const f = fixture(), controller = new AbortController(), reading = deferred();
  let bodyController, providerSignal, cancelled = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    f.calls.provider++; providerSignal = init.signal;
    return new Response(new ReadableStream({ start(c) { bodyController = c; }, pull() { reading.resolve(); }, cancel() { cancelled++; } }),
      { headers: { 'Content-Type': 'image/jpeg' } });
  });
  const pending = serveSautiStreamThumbnail(request(controller.signal), f.env, asset, {}, NOW);
  await reading.promise; controller.abort();
  assert.equal(providerSignal.aborted, true);
  bodyController.enqueue(JPEG);
  const response = await pending;
  assert.notEqual(response.status, 200); assert.equal(cancelled, 1);
});

test('an already cancelled thumbnail starts neither token generation nor provider fetch', async t => {
  const f = fixture(), controller = new AbortController(); thumbnails(t, f); controller.abort();
  assert.notEqual((await serveSautiStreamThumbnail(request(controller.signal), f.env, asset, {}, NOW)).status, 200);
  assert.equal(f.calls.tokens, 0); assert.equal(f.calls.provider, 0);
});

test('manifest child capabilities reuse one derived AES key per request and retain owner, path and expiry checks', async t => {
  const f = fixture();
  const descriptor = await sautiStreamPlaybackDescriptor(request(), f.env, asset, options, NOW);
  const derive = crypto.subtle.deriveKey.bind(crypto.subtle); let derivations = 0;
  t.mock.method(crypto.subtle, 'deriveKey', (...args) => { derivations++; return derive(...args); });
  t.mock.method(globalThis, 'fetch', async () => new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100000\n360/video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200000\n720/video.m3u8\n',
    { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }));
  const served = await serveSautiStreamHls(new Request(descriptor.url), f.env, asset, options, NOW);
  assert.equal(served.status, 200); assert.equal(derivations, 1);
  const body = await served.text();
  assert.equal((body.match(/\?c=/g) || []).length, 3);
  assert.doesNotMatch(body, /cloudflarestream|aaaa\.bbbb/);
  const child = new URL(body.split('\n').find(line => line.startsWith('/')), descriptor.url);
  assert.equal((await serveSautiStreamHls(new Request(child), f.env, asset, { ...options, accessScope: 'Bearer another-viewer' }, NOW)).status, 401);
  assert.equal((await serveSautiStreamHls(new Request(child), f.env, asset, options, NOW + 300)).status, 401);
  assert.equal((await serveSautiStreamHls(new Request(child), f.env, { ...asset, generation: ID }, options, NOW)).status, 401);
});
