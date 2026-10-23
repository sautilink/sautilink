import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const uid = (n) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const session = (n) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = (n) => `a3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = 'offline-stories-worker-fixture-only-0000000000000000';

test('actual PostgreSQL Stories enforce session, ownership, rolling quotas, audience, expiry and worker-only asset lifecycle', { timeout: 120_000 }, async (t) => {
  const db = new PGlite();
  let checks = 0;
  const equal = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
  const rejects = async (promise, expression) => { await assert.rejects(promise, expression); checks++; };
  async function roleQuery(n, sql, args = [], role = 'authenticated') {
    return db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [n ? uid(n) : '', JSON.stringify(n ? { sub: uid(n), session_id: session(n), role } : { role })]);
      await tx.exec(`set local role ${role}`);
      return tx.query(sql, args);
    });
  }
  const rpc = async (n, name, args = [], role = 'authenticated') =>
    (await roleQuery(n, `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args, role)).rows[0].value;
  const reserve = (n, req, kind = 'image') => rpc(n, 'stories_reserve', [kind, kind === 'image' ? 'image/jpeg' : 'video/mp4', 1024, request(req)]);
  const publish = (n, id, kind = 'image', caption = 'Test caption', worker = key) => rpc(n, 'stories_publish',
    [id, worker, 128, 128, kind === 'video' ? 30_000 : null, kind === 'video' ? 'a'.repeat(32) : null, caption]);
  try {
    await db.exec(await read('tests/fixtures/stories-schema.sql'));
    await db.exec(await read('supabase/migrations/20261021061842_enable_native_stories.sql'));
    await db.exec(await read('supabase/migrations/20261021064257_harden_story_publication_quota.sql'));
    for (let n = 1; n <= 8; n++) {
      await db.query('insert into auth.users(id) values($1)', [uid(n)]);
      await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(n), uid(n)]);
      await db.query('insert into public.social_profiles(id,username,display_name,is_verified,verification_badge_type,is_discoverable) values($1,$2,$3,$4,$5,$6)',
        [uid(n), `member${n}`, `Member ${n}`, n === 4 || n === 5, n === 4 ? 'team' : 'standard', n !== 6]);
    }
    await db.exec(await read('supabase/migrations/20261023045902_separate_story_default_publishers.sql'));
    await db.query("insert into private.story_worker_credentials values('stories-worker-v1',encode(sha256(convert_to($1,'UTF8')),'hex'),true)", [key]);
    await db.query('insert into public.social_follows values($1,$2)', [uid(2), uid(1)]);

    await t.test('private storage has deny-by-default RLS and wrappers are invokers', async () => {
      equal((await db.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('stories','story_views','story_reactions','story_notification_receipts','story_worker_credentials') and c.relrowsecurity and c.relforcerowsecurity")).rows[0].n, 5);
      equal((await db.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'stories_%' and p.prosecdef")).rows[0].n, 0);
      await rejects(roleQuery(2, 'select * from private.stories'), /permission denied/);
      await rejects(roleQuery(2, 'select * from private.story_worker_credentials'), /permission denied/);
      await rejects(rpc(null, 'stories_feed', [], 'anon'), /permission denied/);
      await rejects(rpc(null, 'stories_cleanup', ['wrong-key'.repeat(8), 10], 'anon'), /STORIES_WORKER_REQUIRED/);
    });
    await t.test('stale sessions, banned users and pending deletion cannot use Stories', async () => {
      await db.query("update auth.sessions set not_after=now()-interval '1 second' where user_id=$1", [uid(7)]);
      await rejects(reserve(7, 700), /AUTH_REQUIRED/);
      await db.query('update auth.sessions set not_after=null where user_id=$1', [uid(7)]);
      await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1", [uid(7)]);
      await rejects(rpc(7, 'stories_feed'), /AUTH_REQUIRED/);
      await db.query('update auth.users set banned_until=null where id=$1', [uid(7)]);
      await db.query("insert into public.social_account_deletion_requests values($1,'pending')", [uid(7)]);
      await rejects(reserve(7, 701), /AUTH_REQUIRED/);
      await db.query('delete from public.social_account_deletion_requests where user_id=$1', [uid(7)]);
    });

    const pending = await reserve(1, 1);
    const story = await publish(1, pending.id);
    const team = await publish(4, (await reserve(4, 4)).id);
    const blue = await publish(5, (await reserve(5, 5)).id);
    const stranger = await publish(3, (await reserve(3, 3)).id);
    const hidden = await publish(6, (await reserve(6, 6)).id);
    await t.test('owner/session and Worker attestation gate upload, publication and media pointers', async () => {
      const own = await reserve(1, 2, 'video');
      equal((await reserve(1, 2, 'video')).id, own.id);
      await rejects(rpc(1, 'stories_reserve', ['video', 'video/mp4', 2048, request(2)]), /STORY_REQUEST_CONFLICT/);
      await rejects(rpc(2, 'stories_upload', [own.id]), /STORY_UPLOAD_UNAVAILABLE/);
      await rejects(publish(1, own.id, 'video', 'x', 'wrong-key'.repeat(8)), /STORIES_WORKER_REQUIRED/);
      await rejects(publish(2, own.id, 'video'), /STORY_UNAVAILABLE/);
      await rejects(rpc(1, 'stories_publish', [own.id, key, 128, 128, 30_001, 'a'.repeat(32), 'x']), /INVALID_STORY_PUBLICATION/);
      await publish(1, own.id, 'video');
      equal((await publish(1, own.id, 'video', 'replacement')).caption, 'Test caption');
      equal((await rpc(1, 'stories_upload', [own.id])).status, 'published');
      await rejects(rpc(2, 'stories_asset', [story.id, 'bad'.repeat(20)]), /STORIES_WORKER_REQUIRED/);
      const publicResult = await rpc(2, 'stories_get', [story.id]);
      equal('object_key' in publicResult, false); equal('stream_uid' in publicResult, false);
      equal((await rpc(2, 'stories_asset', [story.id, key])).object_key, pending.object_key);
    });
    await t.test('feed includes followed and official team, while every live public Story is directly readable', async () => {
      const feed = await rpc(2, 'stories_feed');
      equal(new Set(feed.map((s) => s.owner_id)), new Set([uid(1), uid(4)]));
      equal((await rpc(2, 'stories_get', [blue.id])).id, blue.id);
      equal((await rpc(2, 'stories_get', [stranger.id])).id, stranger.id);
      equal((await rpc(2, 'stories_feed', ['member3'])).map((s) => s.id), [stranger.id]);
      await rejects(rpc(2, 'stories_get', [hidden.id]), /STORY_UNAVAILABLE/);
      equal((await rpc(6, 'stories_get', [hidden.id])).id, hidden.id);
      await db.query('insert into public.social_mutes values($1,$2)', [uid(2), uid(4)]);
      equal((await rpc(2, 'stories_feed')).some((s) => s.id === team.id), false);
      equal((await rpc(2, 'stories_get', [team.id])).id, team.id);
      await db.query('delete from public.social_mutes');
      await db.query('insert into public.social_blocks values($1,$2)', [uid(1), uid(2)]);
      await rejects(rpc(2, 'stories_get', [story.id]), /STORY_UNAVAILABLE/);
      await rejects(rpc(2, 'stories_asset', [story.id, key]), /STORY_UNAVAILABLE/);
      await db.query('delete from public.social_blocks');
      await db.query('insert into public.social_blocks values($1,$2)', [uid(2), uid(1)]);
      await rejects(rpc(2, 'stories_get', [story.id]), /STORY_UNAVAILABLE/);
      await db.query('delete from public.social_blocks');
    });
    await t.test('views deduplicate, exclude self and expose names only to the owner', async () => {
      await rpc(1, 'stories_view', [story.id]);
      await rpc(2, 'stories_view', [story.id]); await rpc(2, 'stories_view', [story.id]);
      await rpc(3, 'stories_view', [story.id]);
      equal((await rpc(1, 'stories_get', [story.id])).view_count, 2);
      equal((await rpc(2, 'stories_get', [story.id])).view_count, null);
      equal((await rpc(1, 'stories_viewers', [story.id, 0])).viewers.map((x) => x.id).sort(), [uid(2), uid(3)]);
      await rejects(rpc(2, 'stories_viewers', [story.id, 0]), /STORY_OWNER_REQUIRED/);
      await db.query('insert into public.social_blocks values($1,$2)', [uid(3), uid(1)]);
      equal((await rpc(1, 'stories_viewers', [story.id, 0])).viewers.map((x) => x.id), [uid(2)]);
      await db.query('delete from public.social_blocks');
    });
    await t.test('reactions and pushes deduplicate and respect preferences, mutes and privacy', async () => {
      await rpc(2, 'stories_react', [story.id, 'love']); await rpc(2, 'stories_react', [story.id, 'love']);
      equal((await db.query('select count(*)::int as n from public.social_notifications where story_id=$1', [story.id])).rows[0].n, 1);
      equal((await db.query('select count(*)::int as n from public.push_delivery_queue')).rows[0].n, 1);
      const firstNotice = (await db.query('select id from public.social_notifications where story_id=$1', [story.id])).rows[0].id;
      equal(await rpc(null, 'stories_push_authorize', [story.id, uid(2), uid(1), firstNotice], 'service_role'), true);
      await rejects(rpc(1, 'stories_push_authorize', [story.id, uid(2), uid(1), firstNotice]), /permission denied/);
      await rpc(2, 'stories_react', [story.id, 'dislike']);
      equal((await roleQuery(1, 'select notification_type from public.social_notifications')).rows[0].notification_type, 'story_dislike');
      equal((await db.query('select count(*)::int as n from public.push_delivery_queue')).rows[0].n, 1);
      await rejects(rpc(1, 'stories_react', [story.id, 'love']), /STORY_SELF_REACTION/);
      await rejects(rpc(2, 'stories_react', [story.id, 'like']), /INVALID_STORY_REACTION/);
      await db.query('insert into public.social_member_preferences values($1,false)', [uid(1)]);
      equal(await rpc(null, 'stories_push_authorize', [story.id, uid(2), uid(1), firstNotice], 'service_role'), false);
      equal((await roleQuery(1, 'select * from public.social_notifications')).rows.length, 0);
      await rpc(3, 'stories_react', [story.id, 'love']);
      equal((await db.query('select count(*)::int as n from public.social_notifications where actor_id=$1', [uid(3)])).rows[0].n, 0);
      await db.query('update public.social_member_preferences set notify_post_activity=true');
      await db.query('insert into public.social_mutes values($1,$2)', [uid(1), uid(3)]);
      await rpc(3, 'stories_react', [story.id, 'dislike']);
      equal((await db.query('select count(*)::int as n from public.social_notifications where actor_id=$1', [uid(3)])).rows[0].n, 0);
      await db.query('delete from public.social_mutes');
      await rpc(6, 'stories_react', [story.id, 'love']);
      equal((await db.query('select count(*)::int as n from public.social_notifications where actor_id=$1', [uid(6)])).rows[0].n, 0);
      await rpc(2, 'stories_react', [story.id, null]); await rpc(2, 'stories_react', [story.id, 'love']);
      equal((await db.query('select count(*)::int as n from public.push_delivery_queue')).rows[0].n, 1, 'toggle loops must not spam another push');
      equal((await roleQuery(1, 'select notification_type from public.social_notifications')).rows[0].notification_type, 'story_like');
      await rpc(2, 'stories_react', [story.id, null]); await rpc(2, 'stories_react', [story.id, 'dislike']);
      equal((await roleQuery(1, 'select notification_type from public.social_notifications')).rows[0].notification_type, 'story_dislike');
      equal((await db.query('select count(*)::int as n from public.push_delivery_queue')).rows[0].n, 1);
    });
    await t.test('caption edits preserve expiry, foreign owners cannot edit/delete and delete never resets quota', async () => {
      const expiry = story.expires_at;
      equal((await rpc(1, 'stories_edit', [story.id, 'Edited'])).expires_at, expiry);
      await rejects(rpc(2, 'stories_edit', [story.id, 'x']), /STORY_UNAVAILABLE/);
      await rejects(rpc(2, 'stories_delete', [story.id]), /STORY_UNAVAILABLE/);
      await rejects(rpc(1, 'stories_edit', [story.id, 'x'.repeat(501)]), /INVALID_STORY_CAPTION/);
      await rpc(1, 'stories_delete', [story.id]);
      await rejects(rpc(2, 'stories_get', [story.id]), /STORY_UNAVAILABLE/);
      await reserve(1, 11); await reserve(1, 12); await reserve(1, 13);
      await rejects(reserve(1, 14), /STORY_DAILY_LIMIT/);
      await reserve(1, 21, 'video'); await rejects(reserve(1, 22, 'video'), /STORY_DAILY_LIMIT/);
      equal((await rpc(1, 'stories_quota')).images_used, 4); equal((await rpc(1, 'stories_quota')).videos_used, 2);
      await db.query("update private.stories set upload_expires_at=now()-interval '1 second' where owner_id=$1 and status='pending'", [uid(1)]);
      equal((await rpc(1, 'stories_quota')).images_used, 1, 'abandoned expired reservations must release their temporary slot');
      const delayed = await reserve(1, 15);
      await db.query("update private.stories set created_at=now()-interval '25 hours' where id=$1", [delayed.id]);
      await publish(1, delayed.id);
      await db.query("update private.stories set published_at=now()-interval '23 hours 30 minutes',expires_at=now()+interval '30 minutes' where id=$1", [delayed.id]);
      equal((await rpc(1, 'stories_quota')).images_used, 2, 'publication, including deleted publications, owns its full rolling 24-hour quota');
    });
    await t.test('expiry is instant, cleanup repeats until acknowledged, purges interaction data and preserves quota ledger', async () => {
      await db.query("update private.stories set published_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' where id=$1", [team.id]);
      await rejects(rpc(2, 'stories_get', [team.id]), /STORY_UNAVAILABLE/);
      const expired = await rpc(null, 'stories_cleanup', [key, 100], 'anon');
      equal(expired.some((s) => s.id === team.id), true); equal(expired.some((s) => s.id === story.id), true);
      equal((await rpc(null, 'stories_cleanup', [key, 100], 'anon')).some((s) => s.id === story.id), true);
      await rejects(rpc(null, 'stories_cleanup_ack', [story.id, 'bad'.repeat(20)], 'anon'), /STORIES_WORKER_REQUIRED/);
      await rpc(null, 'stories_cleanup_ack', [story.id, key], 'anon');
      equal((await db.query('select count(*)::int as n from private.story_views where story_id=$1', [story.id])).rows[0].n, 0);
      equal((await db.query('select caption from private.stories where id=$1', [story.id])).rows[0].caption, '');
      equal((await rpc(1, 'stories_quota')).images_used, 2);
      equal((await rpc(null, 'stories_cleanup', [key, 100], 'anon')).some((s) => s.id === story.id), false);
      await rejects(rpc(null, 'stories_cleanup_ack', [blue.id, key], 'anon'), /STORY_CLEANUP_UNAVAILABLE/);
      // Profile purge cannot erase the only pointer needed to remove its media.
      await db.query('delete from public.social_profiles where id=$1', [uid(5)]);
      equal((await rpc(null, 'stories_cleanup', [key, 100], 'anon')).some((s) => s.id === blue.id), true);
    });
    await t.test('worker media scan exposes only canonical attached active media metadata', async () => {
      const post = 'b1000000-0000-4000-8000-000000000001';
      const media = 'b2000000-0000-4000-8000-000000000001';
      await db.query('insert into public.social_posts(id,author_id) values($1,$2)', [post,uid(1)]);
      await db.query("insert into public.social_post_media values($1,$2,$3,$4,'video','attached',1024,128,128,30000)", [media, uid(1), post,`sauti/${uid(1)}/${media}.mp4`]);
      await rejects(rpc(null, 'stories_video_backfill', ['bad'.repeat(20), null, 25], 'anon'), /STORIES_WORKER_REQUIRED/);
      equal((await rpc(null, 'stories_video_backfill', [key, null, 25], 'anon')).map((s) => s.id), [media]);
      equal(await rpc(null, 'stories_asset_state', [key, 'post', media], 'anon'), true);
      await db.query("update public.social_posts set moderation_state='removed' where id=$1", [post]);
      equal(await rpc(null, 'stories_asset_state', [key, 'post', media], 'anon'), false);
      equal(await rpc(null, 'stories_video_backfill', [key, null, 25], 'anon'), []);
      equal(await rpc(null, 'stories_asset_state', [key, 'story', team.id], 'anon'), false);
    });
    t.diagnostic(`${checks} behavioral assertions against actual PostgreSQL roles, RLS, functions and constraints passed; all assets/accounts synthetic.`);
  } finally { await db.close(); }
});

test('actual PostgreSQL publication rejects expired delayed transactions and rechecks serialized rolling quota', { timeout: 120_000 }, async (t) => {
  const db = new PGlite();
  let cases = 0;
  const check = (value, message) => { assert.ok(value, message); cases++; };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function claims(tx) {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [uid(1), JSON.stringify({ sub: uid(1), session_id: session(1), role: 'authenticated' })]);
  }
  async function caller(sql, args = []) {
    return db.transaction(async (tx) => { await claims(tx); await tx.exec('set local role authenticated'); return tx.query(sql, args); });
  }
  const reserve = async (number, kind = 'video') => (await caller('select public.stories_reserve($1,$2,1024,$3) as value',
    [kind, kind === 'video' ? 'video/mp4' : 'image/jpeg', request(number)])).rows[0].value;
  const publication = (id, kind = 'video') => caller('select public.stories_publish($1,$2,128,128,$3,$4,\'Boundary\') as value',
    [id, key, kind === 'video' ? 30_000 : null, kind === 'video' ? 'a'.repeat(32) : null]);
  const delayedPublication = (id) => db.transaction(async (tx) => {
    // The deadline is assigned inside this synthetic transaction before dropping
    // privileges, so scheduler overhead cannot make the negative control flaky.
    await claims(tx);
    await tx.query("update private.stories set upload_expires_at=clock_timestamp()+interval '50 milliseconds' where id=$1", [id]);
    await tx.exec('set local role authenticated');
    await sleep(120);
    return tx.query('select public.stories_publish($1,$2,128,128,30000,$3,\'Boundary\') as value', [id, key, 'a'.repeat(32)]);
  });
  try {
    await db.exec(await read('tests/fixtures/stories-schema.sql'));
    await db.exec(await read('supabase/migrations/20261021061842_enable_native_stories.sql'));
    await db.query('insert into auth.users(id) values($1)', [uid(1)]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(1), uid(1)]);
    await db.query("insert into public.social_profiles(id,username,display_name) values($1,'boundary','Boundary')", [uid(1)]);
    await db.query("insert into private.story_worker_credentials values('stories-worker-v1',encode(sha256(convert_to($1,'UTF8')),'hex'),true)", [key]);

    const old = await reserve(1000);
    check((await delayedPublication(old.id)).rows[0].value.id === old.id, 'negative control reproduces publication AFTER upload expiry using the transaction-start clock');
    await db.exec('delete from private.stories');
    await db.exec(await read('supabase/migrations/20261021064257_harden_story_publication_quota.sql'));

    const expired = await reserve(1001);
    await assert.rejects(delayedPublication(expired.id), /STORY_UPLOAD_UNAVAILABLE/); cases++;
    check((await db.query('select status from private.stories where id=$1', [expired.id])).rows[0].status === 'pending', 'failed delayed publication cannot change state');
    await assert.rejects(db.transaction(async (tx) => {
      await claims(tx);
      await tx.query("update private.stories set upload_expires_at=clock_timestamp()+interval '50 milliseconds' where id=$1", [expired.id]);
      await tx.exec('set local role authenticated'); await sleep(120);
      return tx.query("select public.stories_reserve('video','video/mp4',1024,$1)", [request(1001)]);
    }), /STORY_UPLOAD_UNAVAILABLE/); cases++;

    await db.exec('delete from private.stories');
    const delayedReserve = await db.transaction(async (tx) => {
      await claims(tx); const start = (await tx.query('select now() as at')).rows[0].at;
      await tx.exec('set local role authenticated'); await sleep(120);
      const row = (await tx.query("select public.stories_reserve('image','image/jpeg',1024,$1) as value", [request(1002)])).rows[0].value;
      return { start, row };
    });
    check(Date.parse(delayedReserve.row.created_at) - new Date(delayedReserve.start).getTime() >= 80, 'a delayed reserve must get its actual creation time after lock acquisition');
    check(Date.parse(delayedReserve.row.upload_expires_at) - Date.parse(delayedReserve.row.created_at) === 3_600_000, 'upload window is a full hour after reservation');
    const delayedPublish = await db.transaction(async (tx) => {
      await claims(tx); const start = (await tx.query('select now() as at')).rows[0].at;
      await tx.exec('set local role authenticated'); await sleep(120);
      const row = (await tx.query("select public.stories_publish($1,$2,128,128,null,null,'Boundary') as value", [delayedReserve.row.id, key])).rows[0].value;
      return { start, row };
    });
    check(Date.parse(delayedPublish.row.published_at) - new Date(delayedPublish.start).getTime() >= 80, 'publication timestamp cannot predate time spent waiting inside its transaction');
    check(Date.parse(delayedPublish.row.expires_at) - Date.parse(delayedPublish.row.published_at) === 86_400_000, 'published Story gets a full 24 hours');
    const replay = (await publication(delayedReserve.row.id, 'image')).rows[0].value;
    check(replay.expires_at === delayedPublish.row.expires_at && replay.published_at === delayedPublish.row.published_at, 'published retry must preserve original timestamps');

    for (const [kind, cap] of [['video', 2], ['image', 4]]) {
      await db.exec('delete from private.stories');
      const pending = await reserve(kind === 'video' ? 2000 : 3000, kind);
      const type = kind === 'video' ? 'video/mp4' : 'image/jpeg';
      // Represent a quota-boundary interleaving that pre-fix reserve/publish
      // could leave behind: current pending upload plus a full publication cap.
      for (let n = 0; n < cap; n++) {
        const id = `b1000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`;
        await db.query(`with stamp as materialized(select clock_timestamp() as at)
          insert into private.stories(id,owner_id,client_key,media_kind,content_type,size_bytes,object_key,status,published_at,expires_at)
          select $1,$2,$3,$4,$5,1024,$6,'published',at,at+interval '24 hours' from stamp`,
          [id, uid(1), request(4000 + n), kind, type, `stories/${uid(1)}/${id}.${kind === 'video' ? 'mp4' : 'jpg'}`]);
      }
      await assert.rejects(publication(pending.id, kind), /STORY_DAILY_LIMIT/); cases++;
      await db.query("update private.stories set status='deleted',deleted_at=clock_timestamp() where id='b1000000-0000-4000-8000-000000000001'");
      await assert.rejects(publication(pending.id, kind), /STORY_DAILY_LIMIT/); cases++;
      await db.query("with stamp as materialized(select clock_timestamp()-interval '25 hours' as at) update private.stories set published_at=stamp.at,expires_at=stamp.at+interval '24 hours' from stamp where id='b1000000-0000-4000-8000-000000000001'");
      check((await publication(pending.id, kind)).rows[0].value.id === pending.id, `${kind} publishes only after another publication leaves its rolling window`);
    }
    t.diagnostic(`Pre-fix expired-transaction bypass reproduced; ${cases} actual PostgreSQL boundary assertions passed after hardening.`);
  } finally { await db.close(); }
});
