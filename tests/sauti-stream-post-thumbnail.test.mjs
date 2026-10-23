import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSautiMediaRequest, sautiVideoPosterObjectKey, servePublicSautiMediaPreview } from '../src/sauti-media-api.js';

const ORIGIN = 'https://customer-example.cloudflarestream.com';
const OWNER = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const GENERATION = '44444444-4444-4444-8444-444444444444';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x02]);
const LEGACY_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
let count = 0;

function fixture(t) {
  const id = `11111111-1111-4111-8111-${String(++count).padStart(12, '0')}`;
  const row = { id, owner_id: OWNER, post_id: POST, object_key: `sauti/${OWNER}/${id}.mp4`, media_kind: 'video',
    content_type: 'video/mp4', upload_status: 'attached', size_bytes: 100, width: 720, height: 1280, duration_ms: 8000 };
  const uid = count.toString(16).padStart(32, 'a');
  const job = { version: 2, kind: 'post', id, owner_id: OWNER, generation: GENERATION, object_key: row.object_key,
    stream_uid: uid, state: 'ready', source_etag: 'original-etag' };
  const source = { size: 100, etag: 'original-etag', customMetadata: { ownerId: OWNER, mediaId: id, validated: 'true' } };
  const calls = { sourceGets: 0, sourceHeads: 0, jobGets: 0, transforms: 0, provider: 0, tokens: 0, posterPuts: 0, authReads: 0 };
  const state = { allowed: true, poster: null, providerStatus: 200, providerType: 'image/jpeg', providerBytes: JPEG, providerResponse: null };
  const posterKey = sautiVideoPosterObjectKey(row.object_key);
  const env = { SAUTI_STREAM_ENABLED: 'true', SAUTI_STREAM_ORIGIN: ORIGIN, SAUTI_STREAM_SOURCE_KEY: 'a'.repeat(43),
    STREAM: { upload() {}, video(actual) { assert.equal(actual, uid); return { async generateToken() { calls.tokens++; return 'aaaa.bbbb.cccc'; } }; } },
    SAUTI_MEDIA: {
      async head(key) {
        if (key === posterKey) return state.poster ? { size: state.poster.length } : null;
        if (key === row.object_key) { calls.sourceHeads++; return source; }
        throw new Error('Unexpected R2 HEAD');
      },
      async get(key) {
        if (key === `stream-jobs/v2/post/${id}.json`) { calls.jobGets++; const body = JSON.stringify(job); return { etag: 'job-etag', size: body.length, async text() { return body; } }; }
        if (key === row.object_key) { calls.sourceGets++; return { body: new Uint8Array([1, 2, 3]), etag: source.etag, size: source.size }; }
        if (key === posterKey) return state.poster ? { body: state.poster, size: state.poster.length } : null;
        throw new Error('Unexpected R2 GET');
      },
      async put(key, body) { assert.equal(key, posterKey); calls.posterPuts++; state.poster = new Uint8Array(body); },
    },
    MEDIA: { input() { calls.transforms++; return { transform() { return { output() { return { async media() { return LEGACY_JPEG; } }; } }; } }; } },
  };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = new URL(url);
    if (target.origin === 'https://rggpyiterdbbugluejcs.supabase.co') { calls.authReads++; return Response.json(state.allowed ? [row] : []); }
    assert.equal(target.origin, ORIGIN); calls.provider++;
    assert.equal(target.pathname, '/aaaa.bbbb.cccc/thumbnails/thumbnail.jpg');
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    assert.equal(options.redirect, 'manual');
    if (state.providerResponse) return state.providerResponse(options);
    return new Response(options.method === 'HEAD' ? null : state.providerBytes, { status: state.providerStatus, headers: { 'Content-Type': state.providerType } });
  });
  const request = (method = 'GET') => new Request(`https://sautilink.com/api/sauti-media/${id}?poster=1`, { method, headers: { Authorization: `Bearer viewer-${id}` } });
  return { id, row, job, source, calls, state, env, request };
}

test('ready private Stream cold posters avoid original bytes, local transforms and R2 writes', async (t) => {
  const f = fixture(t);
  const response = await handleSautiMediaRequest(f.request(), f.env);
  assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), JPEG);
  assert.match(response.headers.get('Cache-Control'), /^private, no-store/);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg'); assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'poster-stream');
  assert.equal(f.calls.authReads, 1); assert.equal(f.calls.sourceHeads, 1); assert.equal(f.calls.jobGets, 1);
  assert.equal(f.calls.provider, 1); assert.equal(f.calls.sourceGets, 0); assert.equal(f.calls.transforms, 0); assert.equal(f.calls.posterPuts, 0);
  assert.ok(![...response.headers.values()].join(' ').includes('aaaa.bbbb.cccc'));
});

test('an existing R2 poster remains the first path and does no Stream lookup or transform', async (t) => {
  const f = fixture(t); f.state.poster = LEGACY_JPEG;
  const response = await handleSautiMediaRequest(f.request(), f.env);
  assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), LEGACY_JPEG);
  assert.equal(f.calls.sourceHeads + f.calls.jobGets + f.calls.provider + f.calls.transforms, 0);
  assert.match(response.headers.get('Cache-Control'), /^private, max-age=300/);
});

test('ready Stream HEAD returns no body without transforming or reading the full source', async (t) => {
  const f = fixture(t); const response = await handleSautiMediaRequest(f.request('HEAD'), f.env);
  assert.equal(response.status, 200); assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal(f.calls.provider, 1); assert.equal(f.calls.transforms + f.calls.sourceGets, 0);
});

test('wrong owner, generation, mapping state, source ETag or validation never authorizes the provider thumbnail', async (t) => {
  for (const change of [
    (f) => { f.job.owner_id = POST; }, (f) => { f.job.id = POST; }, (f) => { f.job.generation = 'invalid'; },
    (f) => { f.job.state = 'deleted'; }, (f) => { f.job.source_etag = 'stale'; },
    (f) => { f.source.customMetadata.ownerId = POST; }, (f) => { f.source.customMetadata.validated = 'false'; },
  ]) await t.test('strict ready mapping guard', async (t) => {
    const f = fixture(t); change(f);
    const response = await handleSautiMediaRequest(f.request(), f.env);
    assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), LEGACY_JPEG);
    assert.equal(f.calls.provider + f.calls.tokens, 0); assert.equal(f.calls.transforms, 1);
  });
});

test('an RLS denial returns no provider thumbnail and no original bytes', async (t) => {
  const f = fixture(t); f.state.allowed = false;
  const response = await handleSautiMediaRequest(f.request(), f.env);
  assert.equal(response.status, 404); assert.equal(f.calls.provider + f.calls.sourceGets + f.calls.transforms + f.calls.jobGets, 0);
});

test('provider failure and disabled Stream preserve the authorized legacy poster fallback', async (t) => {
  for (const mode of ['failure', 'disabled', 'wrong-content-type']) await t.test(mode, async (t) => {
    const f = fixture(t);
    if (mode === 'disabled') f.env.SAUTI_STREAM_ENABLED = 'false';
    else if (mode === 'failure') f.state.providerStatus = 503;
    else f.state.providerType = 'text/html';
    const response = await handleSautiMediaRequest(f.request(), f.env);
    assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), LEGACY_JPEG);
    assert.equal(f.calls.transforms, 1); assert.equal(f.calls.posterPuts, 1);
  });
});

test('the synthetic public-index row keeps its legacy path without weakening strict post readiness', async (t) => {
  const f = fixture(t);
  const response = await servePublicSautiMediaPreview(new Request(`https://sautilink.com/media/${f.id}?poster=1`), f.env, f.row);
  assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), LEGACY_JPEG);
  assert.equal(f.calls.provider + f.calls.tokens + f.calls.jobGets, 0); assert.equal(f.calls.transforms, 1);
});

test('a disconnected Stream poster aborts provider reads without starting the legacy source transform', async t => {
  const f = fixture(t), controller = new AbortController();
  let bodyController, signal, cancelled = 0, startRead;
  const reading = new Promise(resolve => { startRead = resolve; });
  f.state.providerResponse = options => {
    signal = options.signal;
    return new Response(new ReadableStream({ start(c) { bodyController = c; }, pull() { startRead(); }, cancel() { cancelled++; } }),
      { headers: { 'Content-Type': 'image/jpeg' } });
  };
  const pending = handleSautiMediaRequest(new Request(f.request(), { signal: controller.signal }), f.env);
  await reading; controller.abort(); assert.equal(signal.aborted, true);
  bodyController.enqueue(JPEG);
  const response = await pending;
  assert.equal(response.status, 404); assert.equal(cancelled, 1);
  assert.equal(f.calls.provider, 1);
  assert.equal(f.calls.sourceGets + f.calls.transforms + f.calls.posterPuts, 0);
});
