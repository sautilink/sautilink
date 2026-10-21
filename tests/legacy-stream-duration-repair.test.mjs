import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { LEGACY_VIDEO_REPAIRS as repairs, legacyDurationRepairSql, planLegacyStreamReset,
  resetLegacyStreamJob, assertLegacyRepairRow, assertLegacyRepairSource } from '../scripts/repair-legacy-stream-duration.mjs';

const NEW_GENERATION = 'a1000000-0000-4000-8000-000000000001';
const NOW = 1792570000;
const rowFor = (r) => ({ ...r, duration_ms: r.corrected_duration_ms, media_kind: 'video', content_type: 'video/mp4',
  upload_status: 'attached', post_author_id: r.owner_id, post_status: 'published', deleted_at: null,
  moderation_state: 'visible', is_discoverable: true, account_available: true });
const sourceFor = (r) => ({ etag: r.source_etag, size: r.size_bytes,
  customMetadata: { ownerId: r.owner_id, mediaId: r.id, validated: 'true' } });
function evidence(r = repairs[0]) {
  return { id: r.id, row: rowFor(r), source: sourceFor(r),
    record: { etag: 'saved-job-etag', data: { version: 2, kind: 'post', id: r.id, owner_id: r.owner_id,
      object_key: r.object_key, source_etag: r.source_etag, generation: r.deleted_generation,
      state: 'deleted', provider_deleted: true, operation_started: true, stream_uid: 'a'.repeat(32),
      duration_ms: r.old_duration_ms, max_duration_seconds: 2, updated_at: NOW - 60,
      upload_url: null, source_expires_at: NOW - 1 } },
    ledger: { version: 2, baseline_seconds: 0, reservations: {} }, providerAbsent: true,
    generation: NEW_GENERATION, now: NOW };
}

test('seven measured repairs conservatively reserve true duration and never retain prior provider capabilities', () => {
  assert.equal(repairs.length, 7);
  assert.deepEqual(repairs.map((r) => r.corrected_duration_ms), [30348, 30325, 30209, 30209, 21757, 30070, 30186]);
  for (const r of repairs) {
    const p = planLegacyStreamReset(evidence(r));
    assert.equal(p.data.duration_ms, r.corrected_duration_ms);
    assert.equal(p.data.max_duration_seconds, Math.ceil(r.corrected_duration_ms / 1000) + 1);
    assert.equal(p.data.generation, NEW_GENERATION);
    assert.equal(p.data.state, 'reserved');
    assert.equal(p.data.operation_started, false);
    assert.equal(p.options.onlyIf.etagMatches, 'saved-job-etag');
    for (const key of ['stream_uid', 'upload_url', 'provider_deleted', 'provider_upload_state']) assert.equal(Object.hasOwn(p.data, key), false);
  }
});

test('repair refuses changed identity, eligibility, durations or metadata in the current database', () => {
  const r = repairs[0];
  for (const [key, value] of Object.entries({ id: repairs[1].id, owner_id: repairs[1].owner_id,
    post_id: repairs[1].post_id, object_key: 'unrelated/file.mp4', media_kind: 'image', content_type: 'application/octet-stream',
    upload_status: 'ready', size_bytes: r.size_bytes + 1, width: 42, height: 42, finalized_at: '2026-01-01T00:00:00Z',
    duration_ms: r.old_duration_ms, post_author_id: repairs[1].owner_id, post_status: 'draft', deleted_at: '2026-01-01T00:00:00Z',
    moderation_state: 'removed', is_discoverable: false, account_available: false })) {
    assert.throws(() => assertLegacyRepairRow(r.id, { ...rowFor(r), [key]: value }), /DATABASE_CHANGED/, key);
  }
  assert.throws(() => assertLegacyRepairRow('a1000000-0000-4000-8000-000000000099', rowFor(r)), /ID_NOT_ALLOWLISTED/);
});

test('repair refuses a replaced, resized or unvalidated R2 source', () => {
  const r = repairs[0];
  for (const source of [null, { ...sourceFor(r), etag: 'replaced' }, { ...sourceFor(r), size: r.size_bytes + 1 },
    ...['ownerId', 'mediaId', 'validated'].map((key) => ({ ...sourceFor(r), customMetadata: { ...sourceFor(r).customMetadata, [key]: 'wrong' } }))]) {
    assert.throws(() => assertLegacyRepairSource(r.id, source), /SOURCE_CHANGED/);
  }
});

test('only confirmed deleted original generations with released storage reservations may be reset', () => {
  const f = evidence();
  for (const [key, value] of Object.entries({ version: 1, kind: 'story', id: repairs[1].id, owner_id: repairs[1].owner_id,
    object_key: 'wrong.mp4', source_etag: 'replaced', generation: 'not-a-uuid', state: 'delete_pending',
    provider_deleted: false, operation_started: false, stream_uid: 'bad', duration_ms: 1000, max_duration_seconds: 30 })) {
    assert.throws(() => planLegacyStreamReset({ ...f, record: { ...f.record, data: { ...f.record.data, [key]: value } } }), /JOB_NOT_CONFIRMED_DELETED/, key);
  }
  for (const state of ['ready', 'processing', 'unknown', 'importing', 'reserved', 'capacity_wait']) {
    assert.throws(() => planLegacyStreamReset({ ...f, record: { ...f.record, data: { ...f.record.data, state } } }), /JOB_NOT_CONFIRMED_DELETED/);
  }
  assert.throws(() => planLegacyStreamReset({ ...f, providerAbsent: false }), /JOB_NOT_CONFIRMED_DELETED/);
  assert.throws(() => planLegacyStreamReset({ ...f, record: { ...f.record, etag: '' } }), /JOB_NOT_CONFIRMED_DELETED/);
  assert.throws(() => planLegacyStreamReset({ ...f, generation: repairs[0].deleted_generation }), /INVALID_NEW_GENERATION/);
  assert.throws(() => planLegacyStreamReset({ ...f, now: f.record.data.updated_at }), /INVALID_NEW_GENERATION/);
  for (const reservations of [{ [`post/${f.id}/${repairs[0].deleted_generation}`]: 2 }, { unrelated: -1 }, []]) {
    assert.throws(() => planLegacyStreamReset({ ...f, ledger: { ...f.ledger, reservations } }), /RESERVATION_NOT_RELEASED/);
  }
});

function fakeBucket(f, conflict = false) {
  const writes = [];
  const objects = new Map([
    [`stream-jobs/v2/post/${f.id}.json`, { data: f.record.data, etag: f.record.etag }],
    ['stream-control/v2/storage-capacity.json', { data: f.ledger, etag: 'capacity-etag' }],
  ]);
  return { writes, async head() { return f.source; }, async get(key) {
    const r = objects.get(key);
    if (!r) return null;
    const text = JSON.stringify(r.data);
    return { etag: r.etag, size: text.length, text: async () => text };
  }, async put(key, text, options) {
    writes.push({ key, text, options });
    if (conflict || objects.get(key)?.etag !== options.onlyIf.etagMatches) return null;
    objects.set(key, { data: JSON.parse(text), etag: 'new-job-etag' });
    return { etag: 'new-job-etag' };
  } };
}

test('operator executor rechecks live dependencies, uses CAS and refuses to reapply a new generation', async () => {
  const f = evidence();
  const bucket = fakeBucket(f);
  const args = { bucket, id: f.id, readDatabaseRow: async () => f.row, verifyProviderAbsent: async () => true,
    generation: f.generation, now: f.now };
  assert.equal((await resetLegacyStreamJob(args)).state, 'reserved');
  assert.equal(bucket.writes.length, 1);
  assert.deepEqual(bucket.writes[0].options.onlyIf, { etagMatches: f.record.etag });
  await assert.rejects(resetLegacyStreamJob(args), /JOB_NOT_CONFIRMED_DELETED/);
  assert.equal(bucket.writes.length, 1);
});

test('operator executor makes no write for changed source or uncertain provider; CAS failure is surfaced', async () => {
  for (const change of ['source', 'provider', 'cas']) {
    const f = evidence();
    if (change === 'source') f.source.etag = 'changed';
    const bucket = fakeBucket(f, change === 'cas');
    await assert.rejects(resetLegacyStreamJob({ bucket, id: f.id, readDatabaseRow: async () => f.row,
      verifyProviderAbsent: async () => change !== 'provider', generation: f.generation, now: f.now }),
    change === 'source' ? /SOURCE_CHANGED/ : change === 'provider' ? /JOB_NOT_CONFIRMED_DELETED/ : /JOB_CAS_CONFLICT/);
    assert.equal(bucket.writes.length, change === 'cas' ? 1 : 0);
  }
});

async function fixture() {
  const db = new PGlite();
  await db.exec(`create schema private;
    create table public.social_profiles(id uuid primary key,is_discoverable boolean not null,available boolean not null);
    create table public.social_posts(id uuid primary key,author_id uuid not null,post_status text not null,deleted_at timestamptz,moderation_state text not null);
    create table public.social_post_media(id uuid primary key,owner_id uuid not null,post_id uuid not null,object_key text not null,
      media_kind text not null,content_type text not null,upload_status text not null,size_bytes bigint not null,
      width integer,height integer,finalized_at timestamptz,duration_ms integer,alt_text text default 'unchanged');
    create function private.story_account_available(p_id uuid) returns boolean language sql as
      'select available from public.social_profiles where id=p_id';`);
  for (const r of repairs) {
    await db.query('insert into public.social_profiles values($1,true,true) on conflict do nothing', [r.owner_id]);
    await db.query("insert into public.social_posts values($1,$2,'published',null,'visible')", [r.post_id, r.owner_id]);
    await db.query("insert into public.social_post_media values($1,$2,$3,$4,'video','video/mp4','attached',$5,$6,$7,$8,$9,'unchanged')",
      [r.id, r.owner_id, r.post_id, r.object_key, r.size_bytes, r.width, r.height, r.finalized_at, r.old_duration_ms]);
  }
  return db;
}

test('actual PostgreSQL data repair updates exactly seven durations and safely reruns without other mutations', { timeout: 60_000 }, async () => {
  const db = await fixture();
  try {
    const before = (await db.query('select * from public.social_post_media order by id')).rows;
    await db.exec(legacyDurationRepairSql());
    const after = (await db.query('select * from public.social_post_media order by id')).rows;
    assert.deepEqual(after, before.map((r) => ({ ...r, duration_ms: repairs.find((p) => p.id === r.id).corrected_duration_ms })));
    await db.exec(legacyDurationRepairSql());
    assert.deepEqual((await db.query('select * from public.social_post_media order by id')).rows, after);
  } finally { await db.close(); }
});

test('actual PostgreSQL mismatch on the last row rolls all earlier repairs back', { timeout: 60_000 }, async () => {
  const db = await fixture();
  try {
    await db.query('update public.social_post_media set size_bytes=size_bytes+1 where id=$1', [repairs.at(-1).id]);
    await assert.rejects(db.exec(legacyDurationRepairSql()), /PRECONDITION_FAILED/);
    assert.deepEqual((await db.query('select duration_ms from public.social_post_media order by id')).rows.map((r) => r.duration_ms), repairs.map((r) => r.old_duration_ms));
  } finally { await db.close(); }
});

test('actual PostgreSQL repair refuses moderated, undiscoverable, unavailable or missing source rows', { timeout: 60_000 }, async () => {
  const db = await fixture();
  try {
    for (const query of ["update public.social_posts set moderation_state='removed'", 'update public.social_profiles set is_discoverable=false',
      'update public.social_profiles set available=false', `delete from public.social_post_media where id='${repairs[0].id}'`]) {
      await db.exec('begin');
      await db.exec(query);
      await assert.rejects(db.exec(legacyDurationRepairSql()), /PRECONDITION_FAILED/);
      await db.exec('rollback');
    }
    assert.deepEqual((await db.query('select duration_ms from public.social_post_media order by id')).rows.map((r) => r.duration_ms), repairs.map((r) => r.old_duration_ms));
  } finally { await db.close(); }
});
