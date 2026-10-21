import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveStreamSeconds, streamCapacityStatus, streamHmac } from '../src/sauti-stream-provider.js';
import { prepareSautiStreamVideo, reconcileSautiStreamJob, readySautiPostStreamAsset, serveSautiStreamSource,
  deleteSautiStreamVideo, getSautiStreamJob, createSautiStoryStreamUpload, readySautiStoryStreamAsset,
  sautiStoryStreamUploadStatus } from '../src/sauti-stream-lifecycle.js';
import { sautiStreamPlaybackDescriptor, serveSautiStreamHls, rewriteSautiStreamManifest, serveSautiStreamThumbnail } from '../src/sauti-stream-playback.js';
import { handleSautiMediaRequest } from '../src/sauti-media-api.js';
import { validatedStreamDescriptor, hlsQualityLevels, hlsLevelForPreference } from '../src/sauti-stream-web-player.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const UID = 'a'.repeat(32);
const NOW = 1792560000;
const origin = 'https://customer-example.cloudflarestream.com';
const row = { id: ID, owner_id: OWNER, post_id: POST, media_kind: 'video', upload_status: 'attached',
  object_key: `sauti/${OWNER}/${ID}.mp4`, duration_ms: 8000, size_bytes: 8, width: 1280, height: 720 };

function fixture() {
  const objects = new Map();
  let revision = 0;
  const bytes = new TextEncoder().encode('mp4bytes');
  objects.set(row.object_key, { value: bytes, etag: 'source1', metadata: { ownerId: OWNER, mediaId: ID, validated: 'true' } });
  const object = (item, options) => {
    if (!item || (options?.onlyIf?.etagMatches && item.etag !== options.onlyIf.etagMatches)) return null;
    const value = options?.range ? item.value.slice(options.range.offset, options.range.offset + options.range.length) : item.value;
    return { etag: item.etag, size: item.value.length, customMetadata: item.metadata || {},
      body: new Blob([value]).stream(), text: async () => new TextDecoder().decode(value),
      json: async () => JSON.parse(new TextDecoder().decode(value)) };
  };
  const bucket = {
    async get(key, options) { return object(objects.get(key), options); },
    async head(key) { return object(objects.get(key)); },
    async put(key, value, options = {}) {
      const old = objects.get(key);
      if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches) return null;
      if (options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
      const entry = { value: new TextEncoder().encode(value), etag: `rev${++revision}` };
      objects.set(key, entry); return object(entry);
    },
    async delete(key) { objects.delete(key); },
    async list({ prefix }) { return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
  };
  const calls = { uploads: [], deletes: [], direct: [], details: 0, tokens: 0 };
  let provider;
  const stream = {
    async upload(url, params) {
      calls.uploads.push({ url, params });
      provider = { id: UID, ...params, readyToStream: false, status: { state: 'downloading' }, duration: 8 };
      return provider;
    },
    async createDirectUpload(params) {
      calls.direct.push(params);
      provider = { id: UID, ...params, duration: 20, readyToStream: false, status: { state: 'pendingupload' } };
      return { id: UID, uploadURL: `https://upload.cloudflarestream.com/${UID}` };
    },
    videos: { async list() { return provider ? [provider] : []; } },
    video(id) {
      assert.equal(id, UID);
      return { async details() { calls.details++; return provider; },
        async delete() { calls.deletes.push(id); }, async generateToken() { calls.tokens++; return 'aaaa.bbbb.cccc'; } };
    },
  };
  const env = { SAUTI_MEDIA: bucket, STREAM: stream, SAUTI_STREAM_ENABLED: 'true', SAUTI_STREAM_ORIGIN: origin,
    SAUTI_STREAM_SOURCE_KEY: 'A'.repeat(43), SAUTI_STREAM_STORAGE_SECONDS: '60000', SAUTI_STREAM_INITIAL_SECONDS: '0' };
  return { env, objects, calls, ready() { provider.readyToStream = true; provider.status = { state: 'ready' }; provider.input = { width: 1280, height: 720 }; },
    provider() { return provider; } };
}

async function readyPost(f) {
  const record = await prepareSautiStreamVideo(f.env, row, NOW);
  f.ready();
  await reconcileSautiStreamJob(f.env, record, NOW + 16);
  return readySautiPostStreamAsset(f.env, row);
}

test('Story upload provisioning accepts both exact provider origins and rejects URL extras', async () => {
  for (const host of ['upload.cloudflarestream.com', 'upload.videodelivery.net']) {
    const valid = `https://${host}/${UID}`;
    for (const [url, accepted] of [[valid, true], [`http://${host}/${UID}`, false],
      [`https://${host}:443/${UID}`, false], [`https://${host}:444/${UID}`, false],
      [`${valid}?extra=1`, false], [`${valid}#fragment`, false], [`${valid}/extra`, false],
      [`https://user@${host}/${UID}`, false], [`https://sub.${host}/${UID}`, false],
      [`https://${host}/bad`, false]]) {
      const f = fixture(); const original = f.env.STREAM.createDirectUpload.bind(f.env.STREAM);
      f.env.STREAM.createDirectUpload = async params => ({ ...await original(params), uploadURL: url });
      const result = await createSautiStoryStreamUpload(f.env, { id: ID, owner_id: OWNER }, NOW);
      assert.equal(Boolean(result), accepted, url);
      assert.equal(f.calls.direct.length, 1);
      assert.equal(f.calls.deletes.length, accepted ? 0 : 1);
      assert.equal((await streamCapacityStatus(f.env)).reserved_seconds, accepted ? 30 : 0);
    }
  }
});

test('one attached canonical source is imported exactly once under concurrent reads', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 12 }, () => prepareSautiStreamVideo(f.env, row, NOW)));
  assert.equal(f.calls.uploads.length, 1);
  assert.equal(f.calls.uploads[0].params.requireSignedURLs, true);
  assert.equal(f.calls.uploads[0].params.creator, OWNER);
  assert.equal(new URL(f.calls.uploads[0].url).origin, 'https://sautilink.com');
  assert.equal((await streamCapacityStatus(f.env)).reserved_seconds, 9);
});

test('pending, unattached, invalid duration and unvalidated objects do not import', async () => {
  const f = fixture();
  for (const patch of [{ upload_status: 'ready' }, { post_id: null }, { duration_ms: 120001 }, { duration_ms: 0 }, { object_key: 'https://evil.test/file.mp4' }]) {
    assert.equal(await prepareSautiStreamVideo(f.env, { ...row, ...patch }, NOW), null);
  }
  f.objects.get(row.object_key).metadata.validated = 'false';
  assert.equal(await prepareSautiStreamVideo(f.env, row, NOW), null);
  assert.equal(f.calls.uploads.length, 0);
});

test('global CAS capacity includes uncertain/inflight imports and never increases plan', async () => {
  const f = fixture(); f.env.SAUTI_STREAM_STORAGE_SECONDS = '10';
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => reserveStreamSeconds(f.env, `test/${index}`, 3)));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal((await streamCapacityStatus(f.env)).reserved_seconds, 9);
  assert.equal(await reserveStreamSeconds(f.env, 'test/0', 3), true);
  assert.equal(await reserveStreamSeconds(f.env, 'test/0', 4), false);
});

test('ambiguous provider upload is reconciled by unique generation without replay', async () => {
  const f = fixture(); const actual = f.env.STREAM.upload;
  f.env.STREAM.upload = async (...args) => { await actual(...args); throw new Error('lost response'); };
  await prepareSautiStreamVideo(f.env, row, NOW);
  await prepareSautiStreamVideo(f.env, row, NOW + 16);
  assert.equal(f.calls.uploads.length, 1);
  assert.equal((await getSautiStreamJob(f.env, 'post', ID)).data.stream_uid, UID);
});

test('processing returns no ready asset, exact source generation becomes ready', async () => {
  const f = fixture(); const pending = await prepareSautiStreamVideo(f.env, row, NOW);
  assert.equal(await readySautiPostStreamAsset(f.env, row), null);
  f.ready(); await reconcileSautiStreamJob(f.env, pending, NOW + 16);
  assert.equal((await readySautiPostStreamAsset(f.env, row)).stream_uid, UID);
  f.objects.get(row.object_key).etag = 'replaced';
  assert.equal(await readySautiPostStreamAsset(f.env, row), null);
});

test('first ready rendition while remaining renditions encode is retained until fully ready', async () => {
  const f = fixture(); const pending = await prepareSautiStreamVideo(f.env, row, NOW);
  f.provider().readyToStream = true;
  f.provider().status = { state: 'inprogress', pctComplete: '39' };
  await reconcileSautiStreamJob(f.env, pending, NOW + 16);
  assert.equal(f.calls.deletes.length, 0, 'Cloudflare partial readiness must not delete a healthy video');
  assert.equal((await getSautiStreamJob(f.env, 'post', ID)).data.state, 'processing');
  assert.equal(await readySautiPostStreamAsset(f.env, row), null);
  f.ready();
  await reconcileSautiStreamJob(f.env, await getSautiStreamJob(f.env, 'post', ID), NOW + 32);
  assert.equal((await readySautiPostStreamAsset(f.env, row)).stream_uid, UID);
});

test('direct upload provisioning, accepted bytes and a fresh safe retry are distinct', async () => {
  const f = fixture(); const owner = { id: ID, owner_id: OWNER };
  await createSautiStoryStreamUpload(f.env, owner, NOW);
  const provisioned = await sautiStoryStreamUploadStatus(f.env, owner, NOW + 1);
  assert.equal(provisioned.uploaded, false);
  assert.equal(provisioned.processing, false);
  assert.equal(provisioned.retry_upload, false, 'No provider observation exists yet');
  const waiting = await sautiStoryStreamUploadStatus(f.env, owner, NOW + 16);
  assert.equal(waiting.awaiting_upload, true);
  assert.equal(waiting.retry_upload, true);
  assert.equal(waiting.uploaded, false);
  const stale = await sautiStoryStreamUploadStatus(f.env, owner, NOW + 22);
  assert.equal(stale.retry_upload, false, 'Stale pendingupload is insufficient to replay a one-time POST');
  f.provider().status = { state: 'queued' };
  const accepted = await sautiStoryStreamUploadStatus(f.env, owner, NOW + 32);
  assert.equal(accepted.uploaded, true);
  assert.equal(accepted.processing, true);
  assert.equal(accepted.awaiting_upload, false);
  assert.equal(accepted.retry_upload, false);
  f.ready();
  const ready = await sautiStoryStreamUploadStatus(f.env, owner, NOW + 48);
  assert.equal(ready.ready, true);
  assert.equal(ready.uploaded, true);
  assert.equal(ready.processing, false);
  assert.equal(f.calls.direct.length, 1, 'Status reads never provision a second provider upload');
});

test('rejected or expired direct uploads are terminal and never offered for retry', async () => {
  const f = fixture(); const owner = { id: ID, owner_id: OWNER };
  await createSautiStoryStreamUpload(f.env, owner, NOW);
  f.provider().status = { state: 'error', errorReasonCode: 'ERR_MALFORMED_VIDEO' };
  const rejected = await sautiStoryStreamUploadStatus(f.env, owner, NOW + 16);
  assert.equal(rejected.failed, true); assert.equal(rejected.retry_upload, false);
  assert.equal(rejected.uploaded, false); assert.equal(f.calls.deletes.length, 1);
  const expired = fixture(); await createSautiStoryStreamUpload(expired.env, owner, NOW);
  const state = await sautiStoryStreamUploadStatus(expired.env, owner, NOW + 601);
  assert.equal(state.failed, true); assert.equal(state.retry_upload, false);
});

test('private origin source validates HMAC, TTL, ETag and Range byte fidelity', async () => {
  const f = fixture(); await prepareSautiStreamVideo(f.env, row, NOW);
  const url = f.calls.uploads[0].url;
  const full = await serveSautiStreamSource(new Request(url), f.env, ID, NOW + 1);
  assert.equal(full.status, 200); assert.equal(await full.text(), 'mp4bytes');
  const partial = await serveSautiStreamSource(new Request(url, { headers: { Range: 'bytes=3-5' } }), f.env, ID, NOW + 1);
  assert.equal(partial.status, 206); assert.equal(await partial.text(), 'byt');
  assert.equal(partial.headers.get('Content-Range'), 'bytes 3-5/8');
  assert.equal((await serveSautiStreamSource(new Request(`${url}&extra=x`), f.env, ID, NOW + 1)).status, 404);
  assert.equal((await serveSautiStreamSource(new Request(url.replace(/s=[^&]+/, `s=${'B'.repeat(43)}`)), f.env, ID, NOW + 1)).status, 404);
  assert.equal((await serveSautiStreamSource(new Request(url), f.env, ID, NOW + 901)).status, 404);
  f.objects.get(row.object_key).etag = 'wrong';
  assert.equal((await serveSautiStreamSource(new Request(url), f.env, ID, NOW + 1)).status, 404);
});

test('post deletion revokes playback and source, deletes Stream and releases capacity', async () => {
  const f = fixture(); await readyPost(f);
  await deleteSautiStreamVideo(f.env, row);
  assert.equal(await readySautiPostStreamAsset(f.env, row), null);
  assert.equal((await serveSautiStreamSource(new Request(f.calls.uploads[0].url), f.env, ID, NOW + 1)).status, 404);
  await deleteSautiStreamVideo(f.env, row);
  assert.equal(f.calls.deletes.length, 1);
  assert.equal((await streamCapacityStatus(f.env)).reserved_seconds, 0);
});

test('delete racing an upload does not resurrect ready mapping or leak a copy', async () => {
  const f = fixture(); const actual = f.env.STREAM.upload;
  let release; const wait = new Promise((resolve) => { release = resolve; });
  f.env.STREAM.upload = async (...args) => { const video = await actual(...args); await wait; return video; };
  const importing = prepareSautiStreamVideo(f.env, row, NOW);
  while (!f.calls.uploads.length) await new Promise((resolve) => setImmediate(resolve));
  await deleteSautiStreamVideo(f.env, row); release(); await importing;
  assert.equal((await getSautiStreamJob(f.env, 'post', ID)).data.state, 'deleted');
  assert.equal(f.calls.deletes.length, 1);
});

test('Stories direct uploads are owner bound, signed-only, 30 seconds and idempotent', async () => {
  const f = fixture();
  const upload = await createSautiStoryStreamUpload(f.env, { id: ID, owner_id: OWNER }, NOW);
  assert.equal(upload.stream_uid, UID); assert.equal(f.calls.direct[0].maxDurationSeconds, 30);
  assert.equal(f.calls.direct[0].requireSignedURLs, true);
  assert.equal((await createSautiStoryStreamUpload(f.env, { id: ID, owner_id: OWNER }, NOW + 1)).upload_url, upload.upload_url);
  assert.equal(await createSautiStoryStreamUpload(f.env, { id: ID, owner_id: POST }, NOW + 1), null);
  f.ready();
  assert.equal((await readySautiStoryStreamAsset(f.env, { id: ID, owner_id: OWNER }, NOW + 16)).duration_ms, 20000);
  await deleteSautiStreamVideo(f.env, { id: ID, owner_id: OWNER }, 'story');
  assert.equal((await streamCapacityStatus(f.env)).reserved_seconds, 0);
});

test('Stories duration or creator tampering cannot publish and triggers cleanup', async () => {
  const f = fixture(); await createSautiStoryStreamUpload(f.env, { id: ID, owner_id: OWNER }, NOW);
  f.ready(); f.provider().duration = 30.01;
  assert.equal(await readySautiStoryStreamAsset(f.env, { id: ID, owner_id: OWNER }, NOW + 16), null);
  assert.equal(f.calls.deletes.length, 1);
});

test('manifest rewrites variant, audio, MAP, key and segment URLs and hides provider token', async () => {
  const input = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/playlist.m3u8"\n#EXT-X-I-FRAME-STREAM-INF:URI="iframe.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="key.key"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-STREAM-INF:BANDWIDTH=123\n360/playlist.m3u8\nsegment.ts?x=1\n';
  const paths = [];
  const output = await rewriteSautiStreamManifest(input, { manifestUrl: `${origin}/aaaa.bbbb.cccc/manifest/video.m3u8`, providerOrigin: origin,
    providerToken: 'aaaa.bbbb.cccc', uid: UID, rewrite: async (path) => { paths.push(path); return `/gateway/${paths.length}`; } });
  assert.deepEqual(paths, ['manifest/audio/playlist.m3u8', 'manifest/iframe.m3u8', 'manifest/key.key', 'manifest/init.mp4', 'manifest/360/playlist.m3u8', 'manifest/segment.ts?x=1']);
  assert.doesNotMatch(output, /cloudflarestream|aaaa\.bbbb|segment\.ts/);
  assert.match(output, /URI="\/gateway\/1"/);
});

for (const uri of ['https://evil.test/file.ts', '//evil.test/file.ts', 'data:text/plain,x', '../../other/segment.ts', '%252e%252e/segment.ts', 'https://customer-example.cloudflarestream.com/other/segment.ts']) {
  test(`manifest rejects escape or offsite resource ${uri}`, async () => {
    await assert.rejects(() => rewriteSautiStreamManifest(`#EXTM3U\n${uri}\n`, { manifestUrl: `${origin}/aaaa.bbbb.cccc/manifest/video.m3u8`,
      providerOrigin: origin, providerToken: 'aaaa.bbbb.cccc', uid: UID, rewrite: async (path) => path }));
  });
}

test('gateway capability is account/generation/path/time bound and never forwards bearer', async (t) => {
  const f = fixture(); const asset = await readyPost(f);
  const request = new Request(`https://sautilink.com/api/sauti-media/${ID}/playback`);
  const options = { basePath: `/api/sauti-media/${ID}/hls/`, accessScope: 'Bearer private-user-token' };
  const descriptor = await sautiStreamPlaybackDescriptor(request, f.env, asset, options, NOW);
  assert.equal(descriptor.expires_in, 300); assert.equal(new Date(descriptor.expires_at).getTime(), (NOW + 300) * 1000);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++; assert.equal(new URL(url).origin, origin); assert.equal(new Headers(init.headers).has('Authorization'), false);
    return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=123\nlow.m3u8\n');
  });
  const response = await serveSautiStreamHls(new Request(descriptor.url), f.env, asset, options, NOW + 1);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(await response.text(), /cloudflarestream|aaaa\.bbbb/);
  assert.equal((await serveSautiStreamHls(new Request(descriptor.url), f.env, asset, { ...options, accessScope: 'Bearer another-user' }, NOW + 1)).status, 401);
  assert.equal((await serveSautiStreamHls(new Request(descriptor.url), f.env, asset, options, NOW + 301)).status, 401);
  const differentPath = new URL(descriptor.url); differentPath.pathname = `${options.basePath}${'A'.repeat(43)}`;
  assert.equal((await serveSautiStreamHls(new Request(differentPath), f.env, asset, options, NOW + 1)).status, 401);
  assert.equal(calls, 1);
});

test('gateway encrypts provider segment signatures and binds ciphertext to exact content/path', async (t) => {
  const f = fixture(); const asset = await readyPost(f);
  const options = { basePath: `/api/sauti-media/${ID}/hls/`, accessScope: 'Bearer current-session' };
  const descriptor = await sautiStreamPlaybackDescriptor(new Request('https://sautilink.com'), f.env, asset, options, NOW);
  const second = await sautiStreamPlaybackDescriptor(new Request('https://sautilink.com'), f.env, asset, options, NOW);
  assert.equal(new URL(descriptor.url).pathname, new URL(second.url).pathname);
  assert.notEqual(new URL(descriptor.url).search, new URL(second.url).search, 'Every encryption uses a fresh random nonce');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests++;
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.equal(new Headers(init.headers).has('Cookie'), false);
    assert.equal(init.redirect, 'manual');
    assert.equal(new URL(url).origin, origin);
    if (url.includes('manifest/video.m3u8')) {
      assert.equal(new URL(url).pathname, '/aaaa.bbbb.cccc/manifest/video.m3u8');
      return new Response('#EXTM3U\nvariant.m3u8\n');
    }
    if (url.includes('manifest/variant.m3u8')) {
      assert.equal(new URL(url).pathname, '/aaaa.bbbb.cccc/manifest/variant.m3u8');
      return new Response(`#EXTM3U\n#EXT-X-MAP:URI="../../${UID}/video/480/init.mp4?p=provider-private-metadata&s=provider-private-signature"\n../../${UID}/video/480/seg_1.mp4?p=provider-private-metadata&s=provider-private-signature\n`);
    }
    assert.ok([`/${UID}/video/480/init.mp4`, `/${UID}/video/480/seg_1.mp4`].includes(new URL(url).pathname),
      'Signed UID-rooted fragments retain their original provider path instead of being moved beneath the token');
    assert.equal(new URL(url).search, '?p=provider-private-metadata&s=provider-private-signature');
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } });
  });
  const master = await serveSautiStreamHls(new Request(descriptor.url), f.env, asset, options, NOW + 1);
  const masterText = await master.text(); assert.equal(master.status, 200);
  const variantPath = masterText.split('\n').find((line) => line && !line.startsWith('#'));
  const variant = await serveSautiStreamHls(new Request(new URL(variantPath, descriptor.url)), f.env, asset, options, NOW + 1);
  const variantText = await variant.text(); assert.equal(variant.status, 200);
  for (const text of [descriptor.url, masterText, variantText]) {
    assert.doesNotMatch(text, /provider-private|cloudflarestream|aaaa\.bbbb|video\/480/);
    for (const cap of text.matchAll(/[?&]c=([A-Za-z0-9_-]+)\./g)) {
      const reversible = Buffer.from(cap[1], 'base64url').toString('utf8');
      assert.ok(!reversible.includes(UID)); assert.doesNotMatch(reversible, /provider-private|video\/480|"p":/);
    }
  }
  const segmentPath = variantText.split('\n').find((line) => line && !line.startsWith('#'));
  assert.match(new URL(descriptor.url).pathname, /\/m_[A-Za-z0-9_-]{43}$/);
  assert.match(new URL(segmentPath, descriptor.url).pathname, /\/s_[A-Za-z0-9_-]{43}$/);
  assert.equal(descriptor.cache_key, asset.generation);
  assert.equal((await serveSautiStreamHls(new Request(new URL(segmentPath.replace('/s_', '/m_'), descriptor.url)), f.env, asset, options, NOW + 1)).status, 401);
  const segment = await serveSautiStreamHls(new Request(new URL(segmentPath, descriptor.url)), f.env, asset, options, NOW + 1);
  assert.equal(segment.status, 200); assert.deepEqual(new Uint8Array(await segment.arrayBuffer()), new Uint8Array([1, 2, 3]));
  const mapPath = /#EXT-X-MAP:URI="([^"]+)"/.exec(variantText)?.[1];
  assert.ok(mapPath);
  const map = await serveSautiStreamHls(new Request(new URL(mapPath, descriptor.url)), f.env, asset, options, NOW + 1);
  assert.equal(map.status, 200); assert.deepEqual(new Uint8Array(await map.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal(requests, 4);
  const staleGeneration = { ...asset, generation: ID };
  assert.equal((await serveSautiStreamHls(new Request(descriptor.url), f.env, staleGeneration, options, NOW + 1)).status, 401);
  // Even an otherwise signed old plaintext payload cannot enter the v2 gateway.
  const plaintext = Buffer.from(JSON.stringify({ v: 1, p: 'manifest/video.m3u8' })).toString('base64url');
  const forged = new URL(descriptor.url); forged.searchParams.set('c', `${plaintext}.${await streamHmac(f.env, plaintext)}`);
  assert.equal((await serveSautiStreamHls(new Request(forged), f.env, asset, options, NOW + 1)).status, 404);
  const wrongContent = new URL(descriptor.url); wrongContent.pathname = wrongContent.pathname.replace(ID, POST);
  assert.equal((await serveSautiStreamHls(new Request(wrongContent), f.env, { ...asset, id: POST },
    { ...options, basePath: `/api/sauti-media/${POST}/hls/` }, NOW + 1)).status, 404);
  assert.equal(requests, 4, 'Invalid grants never reach the provider');
});

test('provider root is encrypted and bound into the opaque path identity even when relative paths match', async (t) => {
  const f = fixture(); const asset = await readyPost(f);
  const options = { basePath: `/api/sauti-media/${ID}/hls/`, accessScope: 'Bearer current-session' };
  const descriptor = await sautiStreamPlaybackDescriptor(new Request('https://sautilink.com'), f.env, asset, options, NOW);
  const relative = 'video/480/segment.mp4?p=private-metadata&s=private-signature';
  const routes = [];
  await rewriteSautiStreamManifest(`#EXTM3U\n${origin}/aaaa.bbbb.cccc/${relative}\n${origin}/${UID}/${relative}\n`, {
    manifestUrl: `${origin}/aaaa.bbbb.cccc/manifest/video.m3u8`, providerOrigin: origin,
    providerToken: 'aaaa.bbbb.cccc', uid: UID, rewrite: async (path, root) => { routes.push({ path, root }); return '/rewritten'; },
  });
  assert.deepEqual(routes, [{ path: relative, root: 'token' }, { path: relative, root: 'uid' }]);
  const upstream = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.equal(new Headers(init.headers).has('Cookie'), false);
    if (url.endsWith('/manifest/video.m3u8')) return new Response(`#EXTM3U\n${origin}/aaaa.bbbb.cccc/${relative}\n${origin}/${UID}/${relative}\n`);
    upstream.push(url);
    return new Response(new Uint8Array([7]), { headers: { 'Content-Type': 'video/mp4' } });
  });
  const master = await serveSautiStreamHls(new Request(descriptor.url), f.env, asset, options, NOW + 1);
  assert.equal(master.status, 200);
  const urls = (await master.text()).split('\n').filter((line) => line && !line.startsWith('#')).map((line) => new URL(line, descriptor.url));
  assert.equal(urls.length, 2);
  assert.notEqual(urls[0].pathname, urls[1].pathname, 'A token-rooted and UID-rooted representation cannot alias in a private segment cache');
  const swapped = new URL(urls[0]); swapped.search = urls[1].search;
  assert.equal((await serveSautiStreamHls(new Request(swapped), f.env, asset, options, NOW + 1)).status, 401);
  assert.equal(upstream.length, 0);
  for (const url of urls) assert.equal((await serveSautiStreamHls(new Request(url), f.env, asset, options, NOW + 1)).status, 200);
  assert.deepEqual(upstream, [`${origin}/aaaa.bbbb.cccc/${relative}`, `${origin}/${UID}/${relative}`]);
});

test('edge-compatible manual requests reject every 3xx for playlists, fragments and thumbnails without forwarding credentials', async (t) => {
  const f = fixture(); const asset = await readyPost(f);
  const options = { basePath: `/api/sauti-media/${ID}/hls/`, accessScope: 'Bearer current-session' };
  const descriptor = await sautiStreamPlaybackDescriptor(new Request('https://sautilink.com'), f.env, asset, options, NOW);
  let status = 200; let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++;
    assert.equal(new URL(url).origin, origin);
    assert.equal(init.redirect, 'manual', 'Cloudflare Workers rejects redirect:error; redirects still must never be followed');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.equal(new Headers(init.headers).has('Cookie'), false);
    if (status !== 200) return new Response(null, { status, headers: { Location: 'https://evil.test/private', 'Content-Type': 'image/jpeg' } });
    return new Response(`#EXTM3U\n${origin}/${UID}/video/480/segment.mp4?p=signed&s=signature\n`);
  });
  const master = await serveSautiStreamHls(new Request(descriptor.url), f.env, asset, options, NOW + 1);
  const segmentPath = (await master.text()).split('\n').find((line) => line && !line.startsWith('#'));
  const fragment = new URL(segmentPath, descriptor.url);
  const secretHeaders = { Authorization: 'Bearer private-user-token', Cookie: 'private-session-cookie' };
  for (status = 300; status < 400; status++) {
    const previous = calls;
    assert.equal((await serveSautiStreamHls(new Request(descriptor.url, { headers: secretHeaders }), f.env, asset, options, NOW + 1)).status, 502);
    assert.equal((await serveSautiStreamHls(new Request(fragment, { headers: secretHeaders }), f.env, asset, options, NOW + 1)).status, 502);
    assert.equal((await serveSautiStreamThumbnail(new Request('https://sautilink.com', { headers: secretHeaders }), f.env,
      { ...asset, kind: 'story' }, { expiresAt: new Date((NOW + 10) * 1000).toISOString() }, NOW + 1)).status, 502);
    assert.equal(calls - previous, 3, `HTTP ${status} must not create a redirected request`);
  }
});

test('Stories capability cannot survive the 24-hour server expiry', async () => {
  const f = fixture(); const asset = { kind: 'story', id: ID, generation: POST, stream_uid: UID };
  const options = { basePath: `/api/stories/${ID}/hls/`, accessScope: 'Bearer user', expiresAt: new Date((NOW + 5) * 1000).toISOString() };
  const descriptor = await sautiStreamPlaybackDescriptor(new Request('https://sautilink.com'), f.env, asset, options, NOW);
  assert.equal(descriptor.expires_in, 5);
  assert.equal((await serveSautiStreamHls(new Request(descriptor.url), f.env, asset, options, NOW + 6)).status, 401);
});

test('same authenticated session token refresh retains capability, another session cannot use it', async (t) => {
  const f = fixture(); const asset = await readyPost(f);
  const token = (session, issued) => `Bearer e30.${Buffer.from(JSON.stringify({ sub: OWNER, session_id: session, iat: issued })).toString('base64url')}.c2ln`;
  const options = { basePath: `/api/sauti-media/${ID}/hls/`, accessScope: token(POST, 1) };
  const descriptor = await sautiStreamPlaybackDescriptor(new Request('https://sautilink.com'), f.env, asset, options, NOW);
  t.mock.method(globalThis, 'fetch', async () => new Response('#EXTM3U\nsegment.ts\n'));
  assert.equal((await serveSautiStreamHls(new Request(descriptor.url), f.env, asset, { ...options, accessScope: token(POST, 2) }, NOW + 1)).status, 200);
  assert.equal((await serveSautiStreamHls(new Request(descriptor.url), f.env, asset, { ...options, accessScope: token(ID, 2) }, NOW + 1)).status, 401);
});

test('Story thumbnail is a bounded first-party JPEG with no provider token or bearer exposed', async (t) => {
  const f = fixture(); const asset = { kind: 'story', id: ID, generation: POST, stream_uid: UID };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).origin, origin); assert.equal(new Headers(init.headers).has('Authorization'), false);
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { headers: { 'Content-Type': 'image/jpeg' } });
  });
  const options = { expiresAt: new Date((NOW + 10) * 1000).toISOString() };
  const response = await serveSautiStreamThumbnail(new Request(`https://sautilink.com/api/stories/${ID}/thumbnail`), f.env, asset, options, NOW);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0xff, 0xd8, 0xff, 0x00]));
  assert.equal((await serveSautiStreamThumbnail(new Request('https://sautilink.com'), f.env, asset, options, NOW + 11)).status, 404);
});

test('malformed or additional URI attributes are rejected rather than leaking an unrewritten URL', async () => {
  for (const line of ['#EXT-X-KEY:URI=https://evil.test/key.key', '#EXT-X-MEDIA:URI="ok.m3u8",uri="https://evil.test/key.key"', '#EXT-X-CONTENT-STEERING:SERVER-URI="https://evil.test/a.json"']) {
    await assert.rejects(() => rewriteSautiStreamManifest(`#EXTM3U\n${line}\n`, { manifestUrl: `${origin}/aaaa.bbbb.cccc/manifest/video.m3u8`,
      providerOrigin: origin, providerToken: 'aaaa.bbbb.cccc', uid: UID, rewrite: async (path) => path }));
  }
});

test('media descriptor and HLS deny a user whose existing RLS row is unavailable', async (t) => {
  const f = fixture(); await readyPost(f);
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(new URL(url).hostname, 'rggpyiterdbbugluejcs.supabase.co'); return Response.json([]);
  });
  assert.equal((await handleSautiMediaRequest(new Request(`https://sautilink.com/api/sauti-media/${ID}/playback`, { headers: { Authorization: 'Bearer user' } }), f.env)).status, 404);
  assert.equal((await handleSautiMediaRequest(new Request(`https://sautilink.com/api/sauti-media/${ID}/hls/bWFuaWZlc3QvdmlkZW8ubTN1OA?c=x.y`, { headers: { Authorization: 'Bearer user' } }), f.env)).status, 404);
});

test('web validates exact first-party capabilities and uses actual rendition levels', () => {
  const descriptor = { type: 'hls', url: `https://sautilink.com/api/sauti-media/${ID}/hls/abc?c=abc.${'A'.repeat(43)}`, expires_in: 300, expires_at: new Date((NOW + 300) * 1000).toISOString() };
  assert.ok(validatedStreamDescriptor(descriptor, ID, 'https://sautilink.com', NOW * 1000));
  assert.equal(validatedStreamDescriptor({ ...descriptor, url: descriptor.url.replace('sautilink.com', 'evil.test') }, ID, 'https://sautilink.com', NOW * 1000), null);
  assert.equal(validatedStreamDescriptor({ ...descriptor, expires_at: new Date((NOW + 400) * 1000).toISOString() }, ID, 'https://sautilink.com', NOW * 1000), null);
  const levels = [{ width: 1280, height: 720 }, { width: 360, height: 640 }, { width: 960, height: 540 }];
  assert.deepEqual(hlsQualityLevels(levels), [360, 540, 720]);
  assert.equal(hlsLevelForPreference(levels, 'auto'), -1);
  assert.equal(hlsLevelForPreference(levels, '480'), 1);
  assert.equal(hlsLevelForPreference(levels, 'original'), 0);
  assert.equal(hlsLevelForPreference(levels, 'data-saver'), 1);
});
