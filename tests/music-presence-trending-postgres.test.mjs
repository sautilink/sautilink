import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const migration=await readFile(new URL('../supabase/migrations/20261125181124_music_presence_trending_notifications.sql',import.meta.url),'utf8');
const gate=await readFile(new URL('./fixtures/dm-peer-activity-gate.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema private; create schema auth; create schema cron;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 create table social_profiles(id uuid primary key,is_discoverable boolean default true);
 create table social_member_preferences(user_id uuid primary key,activity_status boolean default true,
   notify_followers boolean default true,notify_post_activity boolean default true,notify_sautify boolean default true);
 create table social_posts(id uuid primary key,author_id uuid references social_profiles(id),visibility text default 'public',
  circle_id uuid,reply_to_post_id uuid,parent_post_id uuid,post_status text default 'published',deleted_at timestamptz,
  moderation_state text default 'visible',created_at timestamptz default now(),like_count integer default 0,
  comment_count integer default 0,repost_count integer default 0,audio_selection jsonb);
 create table social_notifications(id bigint generated always as identity primary key,recipient_id uuid,actor_id uuid,
  post_id uuid references social_posts(id),notification_type text constraint social_notifications_type_allowed check(notification_type in ('like')),
  notification_event text);
 create table dm_conversations(member_one_id uuid,member_two_id uuid);
 create table social_blocks(blocker_id uuid,blocked_id uuid);
 create table private.member_activity_phase37(user_id uuid primary key,last_active_at timestamptz);
 insert into social_profiles(id) values('${id(1)}'),('${id(2)}'),('${id(3)}');
 insert into social_member_preferences(user_id) values('${id(1)}'),('${id(2)}'),('${id(3)}');
 insert into dm_conversations values('${id(1)}','${id(2)}');
 insert into private.member_activity_phase37 values('${id(2)}','2026-11-25T13:40:00Z');`);
 await db.exec(gate+';'+migration);
 return db;
}
test('Trending groups newly charted posts, ranks correctly, excludes private/hidden/old content and deduplicates re-entry',async()=>{
 const db=await fixture();try{
  await db.exec(`insert into social_posts(id,author_id,like_count,comment_count) values
   ('${id(10)}','${id(1)}',5,0),('${id(11)}','${id(1)}',1,4),('${id(12)}','${id(2)}',2,0);
   insert into social_posts(id,author_id,visibility) values('${id(13)}','${id(3)}','followers');
   insert into social_posts(id,author_id,circle_id) values('${id(14)}','${id(3)}','${id(99)}');
   insert into social_posts(id,author_id,moderation_state) values('${id(15)}','${id(3)}','hidden');
   insert into social_posts(id,author_id,created_at) values('${id(16)}','${id(3)}',now()-interval '8 days');`);
  assert.equal((await db.query('select private.notify_trending_achievements_v1() as n')).rows[0].n,2);
  const notices=(await db.query('select * from social_notifications order by recipient_id')).rows;
  assert.equal(notices[0].recipient_id,id(1));assert.equal(notices[0].actor_id,null);
  assert.equal(notices[0].post_id,id(11));
  assert.deepEqual(notices[0].event_data,{post_count:2,best_rank:1,post_ids:[id(11),id(10)],chart:'Trending'});
  assert.equal(notices[1].event_data.post_count,1);
  assert.equal((await db.query('select private.notify_trending_achievements_v1() as n')).rows[0].n,0);
  await db.exec(`update social_posts set visibility='followers' where id='${id(11)}'; select private.notify_trending_achievements_v1();
    update social_posts set visibility='public' where id='${id(11)}';select private.notify_trending_achievements_v1();`);
  assert.equal((await db.query('select count(*)::integer n from social_notifications')).rows[0].n,2);
  await db.exec(`update social_member_preferences set notify_post_activity=false where user_id='${id(3)}';
    insert into social_posts(id,author_id) values('${id(17)}','${id(3)}');select private.notify_trending_achievements_v1();`);
  assert.equal((await db.query('select count(*)::integer n from social_notifications')).rows[0].n,2);
  const grants=(await db.query(`select has_function_privilege('anon','private.notify_trending_achievements_v1()','execute') a,
    has_function_privilege('authenticated','private.notify_trending_achievements_v1()','execute') b,
    has_table_privilege('authenticated','private.trending_post_achievements','select') c`)).rows[0];
  assert.deepEqual(grants,{a:false,b:false,c:false});
 }finally{await db.close();}
});
test('Last seen requires both opt-ins, an existing conversation and no block in either direction',async()=>{
 const db=await fixture();try{
  await db.exec(`set request.jwt.claim.sub='${id(1)}'`);
  const status=async()=>(await db.query('select dm_peer_activity_native_v2($1) as value',[id(2)])).rows[0].value;
  const visible=await status();assert.equal(visible.visibility,'visible');assert.equal(new Date(visible.last_seen_at).toISOString(),'2026-11-25T13:40:00.000Z');
  for(const owner of [1,2]){
   await db.exec(`update social_member_preferences set activity_status=false where user_id='${id(owner)}'`);
   assert.deepEqual(await status(),{visibility:'hidden'});
   await db.exec(`update social_member_preferences set activity_status=true where user_id='${id(owner)}'`);
  }
  for(const [a,b] of [[1,2],[2,1]]){
   await db.exec(`insert into social_blocks values('${id(a)}','${id(b)}')`);assert.deepEqual(await status(),{visibility:'hidden'});
   await db.exec('delete from social_blocks');
  }
  await db.exec('delete from dm_conversations');assert.deepEqual(await status(),{visibility:'hidden'});
  assert.equal((await db.query(`select has_function_privilege('anon','dm_peer_activity_native_v2(uuid)','execute') a`)).rows[0].a,false);
  const functions=(await db.query(`select pg_get_functiondef('profile_activity_feed_phase33(text,text,integer,integer)'::regprocedure) d`)).rows[0].d;
  assert.match(functions,/'audio_selection', row.audio_selection/);assert.doesNotMatch(functions,/SECURITY DEFINER/);
 }finally{await db.close();}
});
