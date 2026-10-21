import assert from 'node:assert/strict';
import test from 'node:test';
import { createMediaServerTiming } from '../src/media-server-timing.js';
import { handleSautiMediaRequest } from '../src/sauti-media-api.js';
import { handleStoriesRequest } from '../src/stories-api.js';

const TIMING = /^rls;dur=\d+\.\d, ready;dur=\d+\.\d, hls;dur=\d+\.\d, edge;dur=\d+\.\d$/;
const ID = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const GENERATION = '44444444-4444-4444-8444-444444444444';
const UID = 'a'.repeat(32), TOKEN = 'Bearer timing-private-token', ORIGIN = 'https://customer-example.cloudflarestream.com';
const binary = new Uint8Array([1, 2, 3, 4]);
function numericOnly(response) {
  const value = response.headers.get('Server-Timing');
  assert.match(value, TIMING);
  assert.doesNotMatch(value, /timing-private-token|request-id|https?:|Bearer|[a-f0-9]{32}|error|desc=/i);
  for (const match of value.matchAll(/dur=(\d+\.\d)/g)) assert.ok(Number(match[1]) >= 0 && Number(match[1]) <= 120000);
}

test('media timing records only fixed numeric stages and preserves success status headers and body', async () => {
  let now = 0; const timing = createMediaServerTiming(() => now);
  assert.equal(await timing.rls(async () => { now += 10; return 7; }), 7);
  await timing.ready(async () => { now += 7.5; });
  await timing.hls(async () => { now += 2; });
  const response = timing.response(new Response(binary, { status: 206, statusText: 'Partial Content',
    headers: { 'Content-Range': 'bytes 0-3/10', 'Cache-Control': 'no-store', 'Server-Timing': 'request-id;desc="https://secret.test/Bearer-token"' } }));
  assert.equal(response.status, 206); assert.equal(response.statusText, 'Partial Content');
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-3/10');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Server-Timing'), 'rls;dur=10.0, ready;dur=7.5, hls;dur=2.0, edge;dur=19.5');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), binary);
  numericOnly(response);
});

test('media timing never adds headers to denied/error responses and preserves thrown errors', async () => {
  const timing = createMediaServerTiming(); const error = Error('https://secret.test/private-token request-id');
  await assert.rejects(timing.rls(async () => { throw error; }), value => value === error);
  for (const status of [201, 204, 301, 304, 400, 401, 403, 404, 410, 416, 429, 500, 502, 503]) {
    const original = new Response([204, 304].includes(status) ? null : 'unchanged error', { status });
    const response = timing.response(original);
    assert.equal(response, original); assert.equal(response.headers.has('Server-Timing'), false);
  }
});

test('media timing clamps clock rollback nonfinite readings and excessive durations to finite numbers', async () => {
  for (const ending of [-100, NaN, Infinity, 1e12]) {
    let now = 100; const timing = createMediaServerTiming(() => now);
    await timing.hls(async () => { now = ending; });
    numericOnly(timing.response(new Response('body')));
  }
});

function fixture(t, kind, { deny = false, providerStatus = 200, missingJob = false, expired = false } = {}) {
  const calls = []; let authorized = false;
  const row = { id: ID, owner_id: OWNER, post_id: POST, object_key: `sauti/${OWNER}/${ID}.mp4`,
    media_kind: 'video', upload_status: 'attached', duration_ms: 8000, stream_uid: UID,
    expires_at: new Date(Date.now() + (expired ? -1000 : 60000)).toISOString() };
  const job = { version: 2, kind, id: ID, owner_id: OWNER, generation: GENERATION,
    stream_uid: UID, object_key: row.object_key, source_etag: 'validated-source', state: 'ready' };
  const env = { SAUTI_STREAM_ENABLED: 'true', SAUTI_STREAM_ORIGIN: ORIGIN, SAUTI_STREAM_SOURCE_KEY: 'A'.repeat(43),
    SAUTI_STORIES_ENABLED: 'true', SAUTI_STORIES_WORKER_KEY: 'timing-worker-secret',
    STREAM: { upload() { throw Error('No imports allowed'); }, video() { return { generateToken: async () => 'aaaa.bbbb.cccc' }; } },
    SAUTI_MEDIA: {
      async get(key) { assert.ok(authorized, 'fresh RLS must succeed before storage reads'); calls.push('job');
        assert.equal(key, `stream-jobs/v2/${kind}/${ID}.json`); if (missingJob) return null;
        const text = JSON.stringify(job); return { etag: 'mapping', size: text.length, text: async () => text }; },
      async head(key) { assert.ok(authorized, 'fresh RLS must succeed before source checks'); calls.push('source');
        assert.equal(key, row.object_key); return { etag: 'validated-source', size: 100,
          customMetadata: { ownerId: OWNER, mediaId: ID, validated: 'true' } }; },
    } };
  t.mock.method(globalThis, 'fetch', async (value, options = {}) => {
    const url = new URL(value); const headers = new Headers(options.headers);
    if (url.hostname === 'rggpyiterdbbugluejcs.supabase.co') {
      calls.push('rls'); assert.equal(headers.get('Authorization'), TOKEN); authorized = !deny;
      if (kind === 'story') {
        assert.equal(url.pathname, '/rest/v1/rpc/stories_asset');
        return deny ? Response.json({ message: 'STORY_UNAVAILABLE https://private.test/request-id' }, { status: 404 }) : Response.json(row);
      }
      assert.equal(url.pathname, '/rest/v1/social_post_media'); return Response.json(deny ? [] : [row]);
    }
    assert.equal(url.origin, ORIGIN); assert.ok(authorized); calls.push('provider');
    assert.equal(headers.has('Authorization'), false); assert.equal(headers.has('Cookie'), false);
    if (providerStatus !== 200) return new Response('private upstream error', { status: providerStatus });
    if (url.pathname.endsWith('.m3u8')) return new Response('#EXTM3U\n#EXT-X-MAP:URI="../video/init.mp4"\n../video/segment.mp4\n', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    return new Response(binary, { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4', 'Content-Range': 'bytes 0-3/10', 'Accept-Ranges': 'bytes' } });
  });
  const base = kind === 'story' ? '/api/stories/' : '/api/sauti-media/';
  const request = (path, headers = {}) => new Request(new URL(path, 'https://sautilink.com'), {
    headers: { Authorization: TOKEN, Cookie: 'private-cookie', 'X-Request-ID': 'request-id', ...headers } });
  const handle = request => kind === 'story' ? handleStoriesRequest(request, env) : handleSautiMediaRequest(request, env);
  return { calls, request, handle, path: base + ID + '/playback', env };
}

for (const kind of ['post', 'story']) {
  test(`${kind} descriptor master and partial fragment expose only numeric timing after fresh RLS`, async t => {
    const f = fixture(t, kind);
    const descriptorResponse = await f.handle(f.request(f.path)); numericOnly(descriptorResponse);
    const descriptor = (await descriptorResponse.json()).data;
    assert.equal(descriptor.type, 'hls'); assert.equal('bootstrap' in descriptor, false);
    assert.equal(f.calls.filter(call => call === 'provider').length, 0, 'existing descriptor requests do not fetch additional playlists');
    assert.equal(descriptorResponse.headers.get('Cache-Control'), 'no-store');
    const master = await f.handle(f.request(descriptor.url)); assert.equal(master.status, 200); numericOnly(master);
    assert.equal(master.headers.get('Cache-Control'), 'no-store');
    const text = await master.text(); assert.ok(text.startsWith('#EXTM3U'));
    const fragmentUrl = text.split('\n').find(line => line && !line.startsWith('#'));
    const fragment = await f.handle(f.request(fragmentUrl, { Range: 'bytes=0-3' }));
    assert.equal(fragment.status, 206); numericOnly(fragment);
    assert.equal(fragment.headers.get('Content-Range'), 'bytes 0-3/10');
    assert.equal(fragment.headers.get('Content-Length'), '4');
    assert.deepEqual(new Uint8Array(await fragment.arrayBuffer()), binary);
    assert.equal(f.calls.filter(call => call === 'rls').length, 3, 'one new authorization lookup for every resource');
    assert.equal(f.calls[0], 'rls');
  });
  test(`${kind} opt-in bootstrap is timed inside the already authorized descriptor without provider secrets`, async t => {
    const f = fixture(t, kind);
    const response = await f.handle(f.request(f.path, { 'X-Sauti-Playback-Bootstrap': '1' }));
    assert.equal(response.status, 200); numericOnly(response);
    const data = (await response.json()).data;
    assert.equal(data.bootstrap.playlists.length, 1);
    assert.equal(data.bootstrap.playlists[0].url, data.url);
    assert.ok(data.bootstrap.playlists[0].body.startsWith('#EXTM3U'));
    assert.doesNotMatch(JSON.stringify(data.bootstrap), /customer-example|aaaa\.bbbb\.cccc|timing-private-token|private-cookie/);
    assert.equal(f.calls.filter(call => call === 'rls').length, 1);
    assert.equal(f.calls.filter(call => call === 'job').length, 1);
    assert.equal(f.calls.filter(call => call === 'provider').length, 1, 'bootstrap fetches only its rewritten playlist, never fragment bytes');
    assert.equal(f.calls[0], 'rls');
  });
  test(`${kind} denied opt-in bootstrap cannot reach storage or provider`, async t => {
    const f = fixture(t, kind, { deny: true });
    const response = await f.handle(f.request(f.path, { 'X-Sauti-Playback-Bootstrap': '1' }));
    assert.equal(response.status, 404); assert.equal(response.headers.has('Server-Timing'), false);
    assert.deepEqual(f.calls, ['rls']);
  });
  test(`${kind} auth RLS readiness and upstream errors do not expose timing headers`, async t => {
    const cases = [
      { denied: true, options: { deny: true }, expected: 404 },
      { denied: false, options: { missingJob: true }, expected: kind === 'story' ? 404 : 200 },
    ];
    for (const item of cases) {
      const f = fixture(t, kind, item.options);
      if (kind === 'post' && item.options.missingJob) f.env.SAUTI_STREAM_ENABLED = 'false';
      const response = await f.handle(f.request(f.path));
      assert.equal(response.status, item.expected);
      if (item.expected === 200) numericOnly(response); else assert.equal(response.headers.has('Server-Timing'), false);
      if (item.denied) assert.deepEqual(f.calls, ['rls']);
    }
    const f = fixture(t, kind, { providerStatus: 503 });
    const unauthorized = await f.handle(f.request(f.path, { Authorization: '', Cookie: '' }));
    assert.equal(unauthorized.status, 401); assert.equal(unauthorized.headers.has('Server-Timing'), false); assert.deepEqual(f.calls, []);
    const descriptor = (await (await f.handle(f.request(f.path))).json()).data;
    const failed = await f.handle(f.request(descriptor.url));
    assert.equal(failed.status, 502); assert.equal(failed.headers.has('Server-Timing'), false);
    const invalid = await f.handle(f.request(descriptor.url.replace(/\?c=.*/, '?c=invalid')));
    assert.equal(invalid.status, 404); assert.equal(invalid.headers.has('Server-Timing'), false);
  });
}

test('expired Stories fail before storage and do not expose timing headers', async t => {
  const f = fixture(t, 'story', { expired: true });
  const response = await f.handle(f.request(f.path));
  assert.equal(response.status, 404); assert.equal(response.headers.has('Server-Timing'), false);
  assert.deepEqual(f.calls, ['rls']);
});
