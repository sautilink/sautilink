import assert from 'node:assert/strict';
import test from 'node:test';
import { readySautiPostStreamAsset } from '../src/sauti-stream-lifecycle.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const GENERATION = '44444444-4444-4444-8444-444444444444';
const UID = 'a'.repeat(32);
const row = { id: ID, owner_id: OWNER, post_id: POST, upload_status: 'attached', media_kind: 'video',
  object_key: `sauti/${OWNER}/${ID}.mp4`, duration_ms: 8000 };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const calls = [];
  const job = { version: 2, kind: 'post', id: ID, owner_id: OWNER, generation: GENERATION,
    object_key: row.object_key, stream_uid: UID, state: 'ready', source_etag: 'immutable-source' };
  const source = { etag: 'immutable-source', size: 100,
    customMetadata: { ownerId: OWNER, mediaId: ID, validated: 'true' } };
  const record = () => { const text = JSON.stringify(job); return { etag: 'job-version', size: text.length, text: async () => text }; };
  const env = { SAUTI_STREAM_ENABLED: 'true', SAUTI_STREAM_ORIGIN: 'https://customer-example.cloudflarestream.com',
    SAUTI_STREAM_SOURCE_KEY: 'a'.repeat(43), STREAM: { video() {}, upload() {} },
    SAUTI_MEDIA: { get: async key => { calls.push(['get', key]); return record(); },
      head: async key => { calls.push(['head', key]); return source; } } };
  return { env, job, source, record, calls };
}

test('post Stream readiness starts fresh job and source reads concurrently and awaits both', async () => {
  const f = fixture(), jobRead = deferred(), sourceRead = deferred();
  f.env.SAUTI_MEDIA.get = key => { f.calls.push(['get', key]); return jobRead.promise; };
  f.env.SAUTI_MEDIA.head = key => { f.calls.push(['head', key]); return sourceRead.promise; };
  let settled = false;
  const pending = readySautiPostStreamAsset(f.env, row).then(value => { settled = true; return value; });
  assert.deepEqual(f.calls, [['get', `stream-jobs/v2/post/${ID}.json`], ['head', row.object_key]]);
  assert.equal(settled, false);
  jobRead.resolve(f.record());
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false, 'a ready mapping cannot bypass the unfinished original-source check');
  sourceRead.resolve(f.source);
  assert.deepEqual(await pending, { kind: 'post', id: ID, generation: GENERATION, stream_uid: UID });
});

test('post Stream readiness does not cache a prior source or mapping permission result', async () => {
  const f = fixture();
  assert.ok(await readySautiPostStreamAsset(f.env, row));
  f.source.etag = 'replaced-source';
  assert.equal(await readySautiPostStreamAsset(f.env, row), null);
  assert.equal(f.calls.filter(([kind]) => kind === 'get').length, 2);
  assert.equal(f.calls.filter(([kind]) => kind === 'head').length, 2);
});

test('concurrent post Stream reads preserve source ETag, size and validation denials', async t => {
  const cases = [
    ['missing source', f => { f.env.SAUTI_MEDIA.head = async () => null; }],
    ['source read failure', f => { f.env.SAUTI_MEDIA.head = async () => { throw Error('unavailable'); }; }],
    ['empty ETag', f => { f.source.etag = ''; }],
    ['changed ETag', f => { f.source.etag = 'replaced'; }],
    ['zero size', f => { f.source.size = 0; }],
    ['negative size', f => { f.source.size = -1; }],
    ['oversized source', f => { f.source.size = 100_000_001; }],
    ['wrong owner', f => { f.source.customMetadata.ownerId = POST; }],
    ['wrong media', f => { f.source.customMetadata.mediaId = POST; }],
    ['unvalidated bytes', f => { f.source.customMetadata.validated = 'false'; }],
    ['missing validation metadata', f => { delete f.source.customMetadata; }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const f = fixture(); change(f);
    assert.equal(await readySautiPostStreamAsset(f.env, row), null);
    assert.equal(f.calls.filter(([kind]) => kind === 'get').length, 1);
  });
});

test('concurrent post Stream reads preserve every ready-job identity gate', async t => {
  for (const [name, patch] of Object.entries({ version: { version: 1 }, kind: { kind: 'story' },
    id: { id: POST }, owner: { owner_id: POST }, generation: { generation: 'invalid' },
    state: { state: 'deleted' }, provider: { stream_uid: 'invalid' }, object: { object_key: 'other.mp4' } })) {
    await t.test(name, async () => {
      const f = fixture(); Object.assign(f.job, patch);
      assert.equal(await readySautiPostStreamAsset(f.env, row), null);
      assert.equal(f.calls.filter(([kind]) => kind === 'head').length, 1);
    });
  }
  const f = fixture(); f.env.SAUTI_MEDIA.get = async () => null;
  assert.equal(await readySautiPostStreamAsset(f.env, row), null);
});

test('invalid canonical rows never start either storage read', async () => {
  for (const patch of [{ id: 'invalid' }, { owner_id: 'invalid' }, { post_id: null }, { upload_status: 'pending' },
    { media_kind: 'image' }, { object_key: 'foreign/key.mp4' }, { duration_ms: 0 }, { duration_ms: 120001 }]) {
    const f = fixture();
    assert.equal(await readySautiPostStreamAsset(f.env, { ...row, ...patch }), null);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture(); f.env.SAUTI_STREAM_ENABLED = 'false';
  assert.equal(await readySautiPostStreamAsset(f.env, row), null);
  assert.deepEqual(f.calls, []);
});
