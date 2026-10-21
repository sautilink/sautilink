// One-off operator tooling, never imported by the Worker or exposed as an API.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const REPAIR_ID = 'legacy-stream-duration-20261021';
export const LEGACY_VIDEO_REPAIRS = Object.freeze(JSON.parse(await readFile(
  new URL('./repair-data/legacy-stream-duration-20261021.json', import.meta.url), 'utf8',
)).map((row) => Object.freeze({ ...row, object_key: `sauti/${row.owner_id}/${row.id}.mp4` })));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ETAG = /^[a-zA-Z0-9_-]{1,128}$/;
const JOB_PREFIX = 'stream-jobs/v2/post/';
const CAPACITY_KEY = 'stream-control/v2/storage-capacity.json';
const fail = (reason) => { throw new Error(`LEGACY_STREAM_REPAIR_${reason}`); };
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const specFor = (id) => LEGACY_VIDEO_REPAIRS.find((row) => row.id === id) || fail('ID_NOT_ALLOWLISTED');

/** Data-only repair: exactly seven rows, exact old metadata, no ACL/grant change. */
export function legacyDurationRepairSql() {
  const values = LEGACY_VIDEO_REPAIRS.map((r) => `(${literal(r.id)}::uuid,${literal(r.owner_id)}::uuid,${literal(r.post_id)}::uuid,${r.old_duration_ms},${r.corrected_duration_ms},${r.size_bytes}::bigint,${r.width},${r.height},${literal(r.finalized_at)}::timestamptz)`).join(',\n      ');
  return `-- ${REPAIR_ID}: ceil(max(ffprobe format/stream duration) * 1000).
-- Run only after current validated R2 source ETags and byte sizes match the manifest.
-- A DO statement is atomic; any changed/missing/ineligible row rolls all seven back.
do $repair$
declare expected record; current_row record;
begin
  perform set_config('lock_timeout','3s',true);
  for expected in select * from (values
      ${values}
    ) as r(id,owner_id,post_id,old_duration_ms,new_duration_ms,size_bytes,width,height,finalized_at)
    order by id
  loop
    select m.*,p.author_id as post_author_id,p.post_status,p.deleted_at,p.moderation_state,
      owner_profile.is_discoverable into current_row
    from public.social_post_media m
    join public.social_posts p on p.id=m.post_id
    join public.social_profiles owner_profile on owner_profile.id=m.owner_id
    where m.id=expected.id
    for update of m,p,owner_profile;
    if not found or current_row.owner_id<>expected.owner_id or current_row.post_id<>expected.post_id
      or current_row.object_key<>('sauti/'||expected.owner_id::text||'/'||expected.id::text||'.mp4')
      or current_row.media_kind<>'video' or current_row.content_type<>'video/mp4' or current_row.upload_status<>'attached'
      or current_row.size_bytes<>expected.size_bytes or current_row.width is distinct from expected.width
      or current_row.height is distinct from expected.height or current_row.finalized_at is distinct from expected.finalized_at
      or current_row.duration_ms is null or current_row.duration_ms not in(expected.old_duration_ms,expected.new_duration_ms)
      or current_row.post_author_id<>expected.owner_id or current_row.post_status<>'published'
      or current_row.deleted_at is not null or current_row.moderation_state<>'visible'
      or current_row.is_discoverable is not true or private.story_account_available(expected.owner_id) is not true
    then raise exception 'LEGACY_STREAM_REPAIR_PRECONDITION_FAILED: %',expected.id; end if;
    update public.social_post_media set duration_ms=expected.new_duration_ms
      where id=expected.id and duration_ms=expected.old_duration_ms;
  end loop;
end;
$repair$;\n`;
}

/** Live, scoped projection for the operator's privileged database reader. */
export function legacyDurationVerificationSql() {
  return `select m.*,p.author_id as post_author_id,p.post_status,p.deleted_at,p.moderation_state,
  owner_profile.is_discoverable,private.story_account_available(m.owner_id) as account_available
from public.social_post_media m join public.social_posts p on p.id=m.post_id
join public.social_profiles owner_profile on owner_profile.id=m.owner_id
where m.id in (${LEGACY_VIDEO_REPAIRS.map((r) => `${literal(r.id)}::uuid`).join(',')}) order by m.id;`;
}

export function assertLegacyRepairRow(id, row, corrected = true) {
  const r = specFor(id);
  const sameTime = Date.parse(row?.finalized_at) === Date.parse(r.finalized_at);
  if (!row || row.id !== id || row.owner_id !== r.owner_id || row.post_id !== r.post_id
    || row.object_key !== r.object_key || row.media_kind !== 'video' || row.content_type !== 'video/mp4'
    || row.upload_status !== 'attached' || Number(row.size_bytes) !== r.size_bytes
    || row.width !== r.width || row.height !== r.height || !sameTime
    || Number(row.duration_ms) !== (corrected ? r.corrected_duration_ms : r.old_duration_ms)
    || row.post_author_id !== r.owner_id || row.post_status !== 'published' || row.deleted_at !== null
    || row.moderation_state !== 'visible' || row.is_discoverable !== true || row.account_available !== true) fail('DATABASE_CHANGED');
  return r;
}

export function assertLegacyRepairSource(id, source) {
  const r = specFor(id);
  if (!source || source.etag !== r.source_etag || source.size !== r.size_bytes
    || source.customMetadata?.ownerId !== r.owner_id || source.customMetadata?.mediaId !== id
    || source.customMetadata?.validated !== 'true') fail('SOURCE_CHANGED');
  return r;
}

/** Pure plan; a terminal job is never generally retried by the production lifecycle. */
export function planLegacyStreamReset({ id, row, source, record, ledger, providerAbsent, generation, now }) {
  const r = assertLegacyRepairRow(id, row);
  assertLegacyRepairSource(id, source);
  const job = record?.data;
  if (!ETAG.test(record?.etag || '') || !job || job.version !== 2 || job.kind !== 'post' || job.id !== id
    || job.owner_id !== r.owner_id || job.object_key !== r.object_key || job.source_etag !== r.source_etag
    || job.generation !== r.deleted_generation || job.state !== 'deleted' || job.provider_deleted !== true
    || job.operation_started !== true || !/^[0-9a-f]{32}$/.test(job.stream_uid || '')
    || job.duration_ms !== r.old_duration_ms || job.max_duration_seconds !== 2 || providerAbsent !== true) fail('JOB_NOT_CONFIRMED_DELETED');
  if (!ledger || ledger.version !== 2 || !ledger.reservations || typeof ledger.reservations !== 'object'
    || Array.isArray(ledger.reservations) || !Number.isSafeInteger(ledger.baseline_seconds) || ledger.baseline_seconds < 0
    || Object.values(ledger.reservations).some((v) => !Number.isSafeInteger(v) || v < 1)
    || Object.keys(ledger.reservations).some((key) => key.startsWith(`post/${id}/`))) fail('RESERVATION_NOT_RELEASED');
  if (!UUID.test(generation || '') || generation === job.generation || !Number.isSafeInteger(now) || now <= job.updated_at) fail('INVALID_NEW_GENERATION');
  const data = { version: 2, kind: 'post', id, owner_id: r.owner_id, generation,
    object_key: r.object_key, source_etag: r.source_etag, source_expires_at: now + 900,
    created_at: now, updated_at: now, state: 'reserved', duration_ms: r.corrected_duration_ms,
    max_duration_seconds: Math.min(120, Math.ceil(r.corrected_duration_ms / 1000) + 1), operation_started: false,
    repair_id: REPAIR_ID, repaired_from_generation: job.generation };
  return { key: `${JOB_PREFIX}${id}.json`, data,
    options: { onlyIf: { etagMatches: record.etag }, httpMetadata: { contentType: 'application/json' } } };
}

async function readJson(bucket, key) {
  const object = await bucket.get(key);
  if (!object?.etag || object.size <= 0 || object.size > 2 * 1024 * 1024) fail('INVALID_STORED_RECORD');
  return { data: JSON.parse(await object.text()), etag: object.etag };
}

/** Inject a real R2 binding/proxy and privileged read-only DB/provider adapters.
 * No credentials, provider upload, deletion, SQL execution, or public endpoint here.
 * A timeout/unknown outcome must be inspected, never blindly retried.
 */
export async function resetLegacyStreamJob({ bucket, id, readDatabaseRow, verifyProviderAbsent,
  generation = randomUUID(), now = Math.floor(Date.now() / 1000) }) {
  const r = specFor(id);
  if (!bucket?.get || !bucket?.head || !bucket?.put || typeof readDatabaseRow !== 'function'
    || typeof verifyProviderAbsent !== 'function') fail('MISSING_OPERATOR_ADAPTER');
  const record = await readJson(bucket, `${JOB_PREFIX}${id}.json`);
  const providerAbsent = await verifyProviderAbsent(record.data?.stream_uid);
  const [row, source, capacity] = await Promise.all([
    readDatabaseRow(id), bucket.head(r.object_key), readJson(bucket, CAPACITY_KEY),
  ]);
  const plan = planLegacyStreamReset({ id, row, source, record, ledger: capacity.data, providerAbsent, generation, now });
  const saved = await bucket.put(plan.key, JSON.stringify(plan.data), plan.options);
  if (!saved?.etag) fail('JOB_CAS_CONFLICT');
  return { id, generation, state: 'reserved', duration_ms: r.corrected_duration_ms, etag: saved.etag };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !['--sql', '--verification-sql'].includes(process.argv[2])) {
    console.error('Usage: node scripts/repair-legacy-stream-duration.mjs --sql | --verification-sql (prints only; never applies)');
    process.exitCode = 1;
  } else console.log(process.argv[2] === '--sql' ? legacyDurationRepairSql() : legacyDurationVerificationSql());
}
