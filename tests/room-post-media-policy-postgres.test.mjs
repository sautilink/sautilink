import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationPath = 'supabase/migrations/20261023055827_expand_room_post_media_policy.sql';
const id = (kind, n) => `${kind}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = id(1, 1), AUTHOR = id(1, 2), OTHER = id(1, 3), OUTSIDER = id(1, 4), ROOM = id(2, 1);
const media = (n = 10) => Array.from({ length: n }, (_, i) => ({ id: id(3, i + 1), alt_text: `Fixture ${i + 1}` }));
const mixedFive = () => [...media(4), { id: id(3, 10), alt_text: 'Fixture video' }];
const submitSql = 'select public.room_submit_post_for_review($1,$2,$3,$4,$5,$6::jsonb) as result';
const submitArgs = (request, items = media()) => [ROOM, id(4, request), 'Ten attachments', 'everyone', null, JSON.stringify(items)];

async function user(db, owner, sql, args = [], role = 'authenticated', rollback = false) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner ?? '']);
    await db.exec(`set local role ${role}`);
    const result = await db.query(sql, args);
    await db.exec(rollback ? 'rollback' : 'commit');
    return result;
  } catch (error) { await db.exec('rollback'); throw error; }
}

async function fixture() {
  const db = new PGlite();
  await db.exec("select set_config('sautilink.security_test_fixture','room-post-media-v1',false)");
  await db.exec(await read('tests/fixtures/room-post-approval-v1.sql'));
  // Current production already exposes private-schema usage for an existing
  // staff helper. Queue table grants/RLS must still deny direct client access.
  await db.exec('grant usage on schema private to authenticated');
  await db.exec(await read('supabase/migrations/20261023055718_expand_post_media_policy.sql'));
  await db.query('insert into public.social_profiles(id,username) values($1,$2),($3,$4),($5,$6),($7,$8)',
    [OWNER,'room_owner',AUTHOR,'room_author',OTHER,'room_other',OUTSIDER,'room_outsider']);
  await db.query('insert into public.social_circles(id,owner_id,name,slug,post_approval_required) values($1,$2,$3,$4,true)',
    [ROOM, OWNER, 'Room policy fixture', 'room-policy-fixture']);
  await db.query("insert into public.social_circle_members(circle_id,member_id,member_role) values($1,$2,'owner'),($1,$3,'member'),($1,$4,'member')",
    [ROOM, OWNER, AUTHOR, OTHER]);
  for (let n = 1; n <= 12; n++) {
    const kind = n === 10 ? 'video' : 'image';
    await db.query(`insert into public.social_post_media(id,owner_id,object_key,media_kind,content_type,size_bytes,duration_ms)
      values($1,$2,$3,$4,$5,1048576,$6)`, [id(3,n), n === 12 ? OTHER : AUTHOR,
      `fixture/${n}.${kind === 'video' ? 'mp4' : 'jpg'}`, kind, kind === 'video' ? 'video/mp4' : 'image/jpeg', kind === 'video' ? 1000 : null]);
  }
  return db;
}

async function functionState(db) {
  return (await db.query(`select proowner::regrole::text as owner, proacl::text as acl,
    prosecdef, proconfig, proargdefaults::text as defaults, md5(prosrc) as source_hash,
    md5(pg_get_functiondef(oid)) as definition_hash
    from pg_proc where oid='public.room_submit_post_for_review(uuid,uuid,text,text,uuid,jsonb)'::regprocedure`)).rows[0];
}

test('actual Room RPC accepts ten mixed attachments atomically while preserving membership, holds, idempotency and private ACLs',
  { timeout: 120_000 }, async t => {
  const db = await fixture();
  try {
    const before = await functionState(db);
    assert.equal(before.definition_hash, '44e6612d77c8264038f5013014442825', 'fixture must match the reviewed live canonical definition');
    // Reproduce both old boundaries before changing the database, not just a
    // textual bound check: ten items and five mixed items were both rejected.
    await assert.rejects(user(db, AUTHOR, submitSql, submitArgs(1)), /INVALID_MEDIA/);
    await assert.rejects(user(db, AUTHOR, submitSql, submitArgs(2, mixedFive())), /MEDIA_LIMIT/);
    const oldFive = await user(db, AUTHOR, submitSql, submitArgs(3, media(5)), 'authenticated', true);
    assert.equal(oldFive.rows[0].result.submission.media_count, 5);

    await db.exec(await read(migrationPath));
    const after = await functionState(db);
    assert.deepEqual({ ...after, source_hash: before.source_hash, definition_hash: before.definition_hash }, before,
      'only reviewed function body bounds may change, never owner/ACL/defaults/security/search_path');
    assert.notEqual(after.source_hash, before.source_hash);
    const privileges = (await db.query(`select
      has_schema_privilege('authenticated','private','usage') as private_usage,
      has_table_privilege('authenticated','private.room_post_submissions','select') as queue_read,
      has_table_privilege('authenticated','private.room_post_submission_media','insert') as queue_write,
      has_function_privilege('anon','public.room_submit_post_for_review(uuid,uuid,text,text,uuid,jsonb)','execute') as anon_execute,
      has_function_privilege('authenticated','public.room_submit_post_for_review(uuid,uuid,text,text,uuid,jsonb)','execute') as auth_execute`)).rows[0];
    assert.deepEqual(privileges, { private_usage:true, queue_read:false, queue_write:false, anon_execute:false, auth_execute:true });
    assert.deepEqual((await db.query(`select relrowsecurity,relforcerowsecurity from pg_class
      where oid in('private.room_post_submissions'::regclass,'private.room_post_submission_media'::regclass)`)).rows,
      [{relrowsecurity:true,relforcerowsecurity:true},{relrowsecurity:true,relforcerowsecurity:true}]);

    await assert.rejects(user(db, AUTHOR, submitSql, submitArgs(4, media(11))), /INVALID_MEDIA/);
    await assert.rejects(user(db, AUTHOR, submitSql, submitArgs(5, [...media(9), media(1)[0]])), /INVALID_MEDIA/);
    await assert.rejects(user(db, AUTHOR, submitSql, submitArgs(6, [...media(9), {id:id(3,12)}])), /MEDIA_NOT_READY/);
    await assert.rejects(user(db, OUTSIDER, submitSql, submitArgs(7)), /ROOM_MEMBERSHIP_REQUIRED/);
    await assert.rejects(user(db, null, submitSql, submitArgs(8)), /AUTH_REQUIRED/);
    await assert.rejects(user(db, null, submitSql, submitArgs(9), 'anon'), /permission denied/);
    await db.query("update public.social_post_media set expires_at=now()-interval '1 second' where id=$1", [id(3,10)]);
    await assert.rejects(user(db, AUTHOR, submitSql, submitArgs(10)), /MEDIA_NOT_READY/);
    await db.query("update public.social_post_media set expires_at=now()+interval '1 hour' where id=$1", [id(3,10)]);
    for (const [a,b] of [[OWNER,AUTHOR],[AUTHOR,OWNER]]) {
      await db.query('insert into public.social_blocks values($1,$2)', [a,b]);
      await assert.rejects(user(db, AUTHOR, submitSql, submitArgs(11)), /ROOM_UNAVAILABLE/);
      await db.exec('delete from public.social_blocks');
    }
    await db.query("update public.social_circles set post_permission='staff_only' where id=$1", [ROOM]);
    await assert.rejects(user(db, AUTHOR, submitSql, submitArgs(12)), /ROOM_POST_STAFF_ONLY/);
    await db.query("update public.social_circles set post_permission='all_members' where id=$1", [ROOM]);

    const args = submitArgs(20);
    const submitted = (await user(db, AUTHOR, submitSql, args)).rows[0].result;
    assert.equal(submitted.submission.media_count, 10);
    assert.equal(submitted.submission.state, 'pending');
    assert.deepEqual((await user(db, AUTHOR, submitSql, args)).rows[0].result, submitted,
      'same request and snapshot must be idempotent after the limit change');
    const changed = [...args]; changed[2] = 'Different body';
    await assert.rejects(user(db, AUTHOR, submitSql, changed), /REQUEST_PAYLOAD_CONFLICT/);
    const submission = submitted.submission.id;
    assert.deepEqual((await db.query('select position from private.room_post_submission_media where submission_id=$1 order by position', [submission])).rows.map(row => row.position),
      [0,1,2,3,4,5,6,7,8,9]);
    assert.equal((await db.query('select count(*)::int n from public.social_posts')).rows[0].n, 0, 'pending media must not publish a post');
    await assert.rejects(user(db, AUTHOR, 'update public.social_post_media set width=123 where id=$1', [id(3,1)]), /MEDIA_HELD_FOR_ROOM_REVIEW/);
    await assert.rejects(user(db, AUTHOR, 'delete from public.social_post_media where id=$1', [id(3,1)]), /MEDIA_HELD_FOR_ROOM_REVIEW/);
    await assert.rejects(user(db, OTHER, 'select * from private.room_post_submissions'), /permission denied/);
    await assert.rejects(db.query(`insert into private.room_post_submission_media(submission_id,media_id,position)
      values($1,$2,10)`, [submission,id(3,11)]), /room_post_submission_media_position_check/);
    await assert.rejects(db.query(`insert into private.room_post_submissions(room_id,author_id,client_request_id,body,media_count,media_snapshot)
      values($1,$2,$3,'Overflow',11,$4::jsonb)`, [ROOM,AUTHOR,id(4,30),JSON.stringify(media(11))]), /room_post_submissions_media_count_check/);

    const decision = 'select public.room_decide_post_submission($1,$2,$3,1,\'approve\') as result';
    await assert.rejects(user(db, OTHER, decision, [ROOM,submission,id(5,1)]), /ROOM_STAFF_REQUIRED/);
    const approved = (await user(db, OWNER, decision, [ROOM,submission,id(5,1)])).rows[0].result;
    assert.equal(approved.submission.state, 'approved');
    assert.deepEqual((await user(db, OWNER, decision, [ROOM,submission,id(5,1)])).rows[0].result, approved);
    const post = (await db.query('select author_id,media_count from public.social_posts where id=$1', [approved.post_id])).rows[0];
    assert.deepEqual(post, {author_id:AUTHOR,media_count:10});
    const attached = (await db.query('select owner_id,upload_status,position from public.social_post_media where post_id=$1 order by position', [approved.post_id])).rows;
    assert.equal(attached.length, 10);
    assert.ok(attached.every((row,i) => row.owner_id===AUTHOR && row.upload_status==='attached' && row.position===i));
    assert.equal((await db.query('select count(*)::int n from private.room_post_submission_media')).rows[0].n, 0, 'atomic approval consumes all ten holds');
    assert.equal((await user(db, OUTSIDER, 'select * from public.social_posts')).rows.length, 0, 'Room posts remain member-only');
    assert.equal((await db.query("select count(*)::int n from private.room_post_decision_audit where action='approved'")).rows[0].n, 1);
    t.diagnostic('Both old limits reproduced; ten mixed files approved atomically; boundary, membership, private ACL, hold and idempotency checks passed.');
  } finally { await db.close(); }
});

test('Room migration fails closed on RPC or constraint drift without partially broadening bounds', {timeout:120_000}, async () => {
  for (const drift of ['function','constraint']) {
    const db = await fixture();
    try {
      if (drift === 'function') {
        const { rows } = await db.query("select pg_get_functiondef('public.room_submit_post_for_review(uuid,uuid,text,text,uuid,jsonb)'::regprocedure) as definition");
        await db.exec(rows[0].definition.replace('REQUEST_ID_REQUIRED','REQUEST_ID_CHANGED'));
      } else await db.exec(`alter table private.room_post_submissions drop constraint room_post_submissions_media_count_check,
        add constraint room_post_submissions_media_count_check check(media_count between 0 and 6)`);
      const before = await functionState(db);
      await assert.rejects(db.exec(await read(migrationPath)), new RegExp(`ROOM_POST_MEDIA_${drift==='function'?'FUNCTION':'CONSTRAINT'}_DRIFT`));
      await db.exec('rollback');
      assert.deepEqual(await functionState(db), before, 'failed transaction may not replace any function or privilege');
      const maxPosition = await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='private.room_post_submission_media'::regclass and conname='room_post_submission_media_position_check'");
      assert.match(maxPosition.rows[0].definition, /<= 4/);
    } finally { await db.close(); }
  }
});
