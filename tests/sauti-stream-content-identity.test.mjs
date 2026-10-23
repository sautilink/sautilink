import test from 'node:test';
import assert from 'node:assert/strict';
import { sautiStreamContentIdentityPath } from '../src/sauti-stream-content-identity.js';
import { sautiStreamPlaybackDescriptor, serveSautiStreamHls } from '../src/sauti-stream-playback.js';

const UID = 'a'.repeat(32), ID = '11111111-1111-4111-8111-111111111111';
const GENERATION = '22222222-2222-4222-8222-222222222222', NOW = 1792560000;
const origin = 'https://customer-example.cloudflarestream.com';
function metadata(time = 0) {
  return { type: 'segment', videoID: UID, ownerID: 123, track: 'video-track', rendition: '720', muxing: 'stable-mux',
    segmentDurationSecs: 4, unknownSelector: { codec: 'avc', version: 2 },
    token: { exp: String(NOW + 3600 + time), kid: 'stable-provider-key', nbf: String(NOW + time), sub: UID,
      unknownClaim: { scope: 'unchanged' } } };
}
const payload = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const path = (value = metadata(), signature = 'provider_signature_one', rest = '') => `video/720/seg_0.mp4?p=${payload(value)}&s=${signature}${rest}`;
const identity = value => sautiStreamContentIdentityPath(value, 'uid', UID);

test('only proven token time claims and signature rotate outside the binary content identity', () => {
  const first = path(), second = path(metadata(40), 'provider_signature_two');
  assert.notEqual(first, second);
  assert.equal(identity(first), identity(second));
  assert.notEqual(identity(first), first);
  assert.match(identity(first), /stable-provider-key/);
  assert.match(identity(first), /unknownSelector/);
  assert.match(identity(first), /unknownClaim/);
  assert.doesNotMatch(identity(first), /provider_signature|"exp":|"nbf":/);
  const reordered = metadata(40);
  reordered.unknownSelector = { version: 2, codec: 'avc' };
  assert.equal(identity(first), identity(path(reordered, 'provider_signature_two')), 'JSON object key order is not a routing selector');
});

test('path, every routing selector, unknown token claim and unknown ordered query remain distinct', () => {
  const original = identity(path());
  for (const change of [
    value => { value.track = 'other-track'; }, value => { value.rendition = '360'; },
    value => { value.muxing = 'different-mux'; }, value => { value.unknownSelector.version++; },
    value => { value.token.unknownClaim.scope = 'different'; }, value => { value.token.kid = 'other-key'; },
    value => { value.token.iat = String(NOW); }, value => { value.unknownSelector.order = [1,2]; },
  ]) {
    const changed = metadata(); change(changed);
    assert.notEqual(identity(path(changed)), original);
  }
  assert.notEqual(identity(path().replace('seg_0.mp4', 'seg_1.mp4')), original);
  assert.notEqual(identity(path().replace('video/720/', 'audio/128/')), original);
  assert.notEqual(identity(path(metadata(), undefined, '&quality=720')), identity(path(metadata(), undefined, '&quality=360')));
  assert.notEqual(identity(path(metadata(), undefined, '&selector=1&selector=2')), identity(path(metadata(), undefined, '&selector=2&selector=1')));
  assert.notEqual(identity(path(metadata(), undefined, '&unknown=x&other=y')), identity(path(metadata(), undefined, '&other=y&unknown=x')));
});

test('unfamiliar, malformed, duplicate or unsafe signing envelopes retain their full original identity', () => {
  const malformed = [
    'not-json', '{"videoID":"' + UID + '","videoID":"other"}',
    ' ' + JSON.stringify(metadata()), JSON.stringify(metadata()).replace('"ownerID":123', '"ownerID":1.23e2'),
    { ...metadata(), videoID: 'b'.repeat(32) }, { ...metadata(), token: { ...metadata().token, sub: 'b'.repeat(32) } },
    { ...metadata(), token: { ...metadata().token, kid: '' } },
    { ...metadata(), token: { ...metadata().token, exp: 'invalid' } },
    { ...metadata(), token: { ...metadata().token, nbf: null } },
    { ...metadata(), token: { ...metadata().token, nbf: String(NOW + 7200) } },
    { ...metadata(), token: [] },
  ];
  for (const value of malformed) { const original = path(value); assert.equal(identity(original), original); }
  for (const suffix of ['&p=duplicate', '&s=duplicate', '&%70=duplicate', '&%73=duplicate']) {
    const original = path(metadata(), undefined, suffix); assert.equal(identity(original), original);
  }
  for (const original of [path().replace('?p=', '?%70='), path().replace('&s=', '&%73='), path().replace('seg_0.mp4', 'variant.m3u8'), 'video/720/seg_0.mp4', 'x'.repeat(2049)])
    assert.equal(identity(original), original);
  assert.equal(sautiStreamContentIdentityPath(path(), 'token', UID), path());
  assert.equal(sautiStreamContentIdentityPath(path(), 'uid', 'invalid'), path());
});

test('canonicalization budget rejects deep or broad metadata conservatively', () => {
  const deep = metadata(); let current = deep;
  for (let index = 0; index < 10; index++) current = current.extra = {};
  const deepPath = path(deep); assert.equal(identity(deepPath), deepPath);
  const broad = metadata(); broad.extra = Array.from({ length: 257 }, () => 0);
  const broadPath = path(broad); assert.equal(identity(broadPath), broadPath);
});

test('gateway stable content path still forwards the exact sealed p/s and enforces scope, generation and expiry', async (t) => {
  const asset = { kind: 'post', id: ID, generation: GENERATION, stream_uid: UID };
  const env = { SAUTI_STREAM_ORIGIN: origin, SAUTI_STREAM_SOURCE_KEY: 'A'.repeat(43),
    STREAM: { video: () => ({ generateToken: async () => 'aaaa.bbbb.cccc' }) } };
  const options = { basePath: `/api/sauti-media/${ID}/hls/`, accessScope: 'Bearer first-session' };
  let time = 0; const forwarded = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    if (new URL(url).pathname.endsWith('/manifest/video.m3u8')) return new Response(`#EXTM3U\n${origin}/${UID}/${path(metadata(time), `signature_${time}_abcdefghijklmnop`)}\n`);
    forwarded.push(url);
    return new Response(Uint8Array.of(1,2,3), { headers: { 'Content-Type': 'video/mp4' } });
  });
  const descriptor = await sautiStreamPlaybackDescriptor(new Request('https://sautilink.com'), env, asset, options, NOW);
  async function resource() {
    const response = await serveSautiStreamHls(new Request(descriptor.url), env, asset, options, NOW + 1);
    assert.equal(response.status, 200);
    return new URL((await response.text()).split('\n').find(line => line && !line.startsWith('#')), descriptor.url);
  }
  const first = await resource(); time = 40; const second = await resource();
  assert.equal(first.pathname, second.pathname);
  assert.notEqual(first.search, second.search);
  assert.doesNotMatch(first.href, /video-track|stable-provider|signature_|cloudflarestream/);
  for (const target of [first, second]) {
    const response = await serveSautiStreamHls(new Request(target), env, asset, options, NOW + 2);
    assert.equal(response.status, 200); await response.arrayBuffer();
  }
  assert.equal(new URL(forwarded[0]).search, new URL(`${origin}/${path(metadata(0), 'signature_0_abcdefghijklmnop')}`).search);
  assert.equal(new URL(forwarded[1]).search, new URL(`${origin}/${path(metadata(40), 'signature_40_abcdefghijklmnop')}`).search);
  const calls = forwarded.length;
  assert.equal((await serveSautiStreamHls(new Request(second), env, asset, { ...options, accessScope: 'Bearer another-session' }, NOW + 2)).status, 401);
  assert.equal((await serveSautiStreamHls(new Request(second), env, { ...asset, generation: ID }, options, NOW + 2)).status, 401);
  assert.equal((await serveSautiStreamHls(new Request(second), env, asset, options, NOW + 301)).status, 401);
  const wrongPath = new URL(second); wrongPath.pathname = wrongPath.pathname.replace('/s_', '/m_');
  assert.equal((await serveSautiStreamHls(new Request(wrongPath), env, asset, options, NOW + 2)).status, 401);
  assert.equal(forwarded.length, calls, 'denied grants never reach the provider');

  // An already-issued v2 capability carries the full provider path and can still
  // use its old full-path digest during its original five-minute lifetime.
  const legacy = new URL(second);
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`uid\n${path(metadata(40), 'signature_40_abcdefghijklmnop')}`))).toString('base64url');
  legacy.pathname = `${options.basePath}s_${digest}`;
  assert.notEqual(legacy.pathname, second.pathname);
  const compatible = await serveSautiStreamHls(new Request(legacy), env, asset, options, NOW + 3);
  assert.equal(compatible.status, 200); await compatible.arrayBuffer();
  assert.equal((await serveSautiStreamHls(new Request(legacy), env, asset, options, NOW + 301)).status, 401);
});
