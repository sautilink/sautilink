import assert from 'node:assert/strict';
import test from 'node:test';
import { getSautiStreamJob, reconcileSautiStreamJob, readySautiStoryStreamAsset, sautiStoryStreamUploadStatus } from '../src/sauti-stream-lifecycle.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const GENERATION = '33333333-3333-4333-8333-333333333333';
const UID = 'a'.repeat(32);
const NOW = 1792560000;
const owner = { id: ID, owner_id: OWNER };

function fixture(kind = 'story') {
  const objects = new Map(); let revision = 0;
  const calls = { details: 0, lists: 0, creates: 0, deletes: 0 };
  const job = { version: 2, kind, id: ID, owner_id: OWNER, generation: GENERATION, stream_uid: UID,
    state: 'processing', operation_started: true, created_at: NOW, updated_at: NOW,
    max_duration_seconds: kind === 'story' ? 30 : 120, upload_expires_at: NOW + 600, upload_url: 'https://upload.cloudflarestream.com/' + UID };
  const provider = { id: UID, creator: OWNER, requireSignedURLs: true, readyToStream: true, duration: 8,
    meta: { sauti_kind: kind, sauti_id: ID, sauti_generation: GENERATION },
    status: { state: 'inprogress', pctComplete: '39' }, input: { width: 640, height: 360 } };
  function store(key, value) { const text = JSON.stringify(value); const object = { etag: 'r' + (++revision), size: text.length, text: async () => text }; objects.set(key, object); return object; }
  const key = `stream-jobs/v2/${kind}/${ID}.json`; store(key, job);
  const env = { SAUTI_STREAM_ENABLED: 'true', SAUTI_STREAM_ORIGIN: 'https://customer-example.cloudflarestream.com', SAUTI_STREAM_SOURCE_KEY: 'A'.repeat(43),
    SAUTI_MEDIA: { get: async key => objects.get(key) || null, put: async (key, text, options) => {
      const old = objects.get(key); if (options?.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches) return null;
      return store(key, JSON.parse(text)); } },
    STREAM: { upload() { throw Error('No import allowed'); }, createDirectUpload() { calls.creates++; throw Error('No provisioning allowed'); },
      videos: { list: async () => { calls.lists++; return [provider]; } },
      video: id => { assert.equal(id, UID); return { details: async () => { calls.details++; return provider; }, delete: async () => { calls.deletes++; } }; } } };
  return { env, provider, job, calls, key, store, read: () => getSautiStreamJob(env, kind, ID) };
}

test('Story publishes its first playable quality with the same signed owner and generation checks', async () => {
  const f = fixture();
  const ready = await readySautiStoryStreamAsset(f.env, owner, NOW + 2);
  assert.equal(ready.state, 'ready'); assert.equal(ready.duration_ms, 8000);
  assert.equal(ready.provider_upload_state, 'inprogress'); assert.equal(ready.upload_url, null);
  assert.equal(f.calls.details, 1); assert.equal(f.calls.deletes, 0); assert.equal(f.calls.creates, 0);
  const status = await sautiStoryStreamUploadStatus(f.env, owner, NOW + 3);
  assert.equal(status.ready, true); assert.equal(status.uploaded, true); assert.equal(status.retry_upload, false);
});

test('known Story provider IDs poll at two seconds while posts and uncertain discovery retain fifteen seconds', async () => {
  const f = fixture(); f.provider.readyToStream = false;
  for (const [at, expected] of [[1, 0], [2, 1], [2, 1], [3, 1], [4, 2]]) {
    await reconcileSautiStreamJob(f.env, await f.read(), NOW + at); assert.equal(f.calls.details, expected);
  }
  const post = fixture('post');
  for (const at of [1, 2, 14]) { await reconcileSautiStreamJob(post.env, await post.read(), NOW + at); assert.equal(post.calls.details, 0); }
  await reconcileSautiStreamJob(post.env, await post.read(), NOW + 15);
  assert.equal(post.calls.details, 1); assert.equal((await post.read()).data.state, 'processing', 'post first-quality policy stays unchanged');
  const uncertain = fixture(); delete uncertain.job.stream_uid; uncertain.job.state = 'unknown'; uncertain.store(uncertain.key, uncertain.job);
  await reconcileSautiStreamJob(uncertain.env, await uncertain.read(), NOW + 2); assert.equal(uncertain.calls.lists, 0);
  await reconcileSautiStreamJob(uncertain.env, await uncertain.read(), NOW + 15); assert.equal(uncertain.calls.lists, 1);
  assert.equal(uncertain.calls.creates, 0, 'uncertain reconciliation never repeats a provisioning POST');
});

test('Story first-quality readiness accepts only explicit ready/inprogress states and a boolean playback flag', async t => {
  for (const state of ['queued', 'pendingupload', 'unknown', '', null]) await t.test(String(state), async () => {
    const f = fixture(); f.provider.status.state = state;
    assert.equal(await readySautiStoryStreamAsset(f.env, owner, NOW + 2), null);
    assert.equal((await f.read()).data.state, 'processing'); assert.equal(f.calls.deletes, 0);
  });
  for (const flag of [false, 'true', 1]) {
    const f = fixture(); f.provider.readyToStream = flag;
    assert.equal(await readySautiStoryStreamAsset(f.env, owner, NOW + 2), null);
  }
  const f = fixture(); f.provider.status.state = 'ready'; f.provider.duration = 30;
  assert.equal((await readySautiStoryStreamAsset(f.env, owner, NOW + 2)).duration_ms, 30000);
});

test('Story invalid duration, unsigned or mismatched metadata and provider errors still delete and cannot publish', async t => {
  const cases = [
    ...[0, -1, NaN, Infinity, 30.0001].map(duration => ['duration ' + duration, f => { f.provider.duration = duration; }]),
    ['unsigned', f => { f.provider.requireSignedURLs = false; }],
    ['wrong owner', f => { f.provider.creator = ID; }],
    ['wrong kind', f => { f.provider.meta.sauti_kind = 'post'; }],
    ['wrong id', f => { f.provider.meta.sauti_id = OWNER; }],
    ['wrong generation', f => { f.provider.meta.sauti_generation = OWNER; }],
    ['wrong provider id', f => { f.provider.id = 'b'.repeat(32); }],
    ['error state', f => { f.provider.status.state = 'error'; }],
    ['error reason', f => { f.provider.status.errorReasonCode = 'ERR_MALFORMED_VIDEO'; }],
    ['alternate error reason', f => { f.provider.status.errReasonCode = 'ERR_DURATION_EXCEED_CONSTRAINT'; }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const f = fixture(); change(f);
    assert.equal(await readySautiStoryStreamAsset(f.env, owner, NOW + 2), null);
    assert.equal((await f.read()).data.state, 'deleted'); assert.equal(f.calls.deletes, 1); assert.equal(f.calls.creates, 0);
    assert.equal((await sautiStoryStreamUploadStatus(f.env, owner, NOW + 3)).retry_upload, false);
  });
});

test('another Story owner cannot use readiness polling to publish or inspect the provider', async () => {
  const f = fixture();
  assert.equal(await readySautiStoryStreamAsset(f.env, { id: ID, owner_id: ID }, NOW + 2), null);
  assert.equal(f.calls.details, 0); assert.equal(f.calls.deletes, 0); assert.equal(f.calls.creates, 0);
});
