import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const uid=n=>`d1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const session=n=>`d2000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request=n=>`d3000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const worker='offline-default-publisher-test-worker-key-0000000000';

test('PostgreSQL Story discovery separates official default publishers from orange business verification',async()=>{
  const db=new PGlite();
  async function roleQuery(n,sql,args=[],role='authenticated') {
    return db.transaction(async tx=>{
      await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [n?uid(n):'',JSON.stringify(n?{sub:uid(n),session_id:session(n),role}:{role})]);
      await tx.exec(`set local role ${role}`);return tx.query(sql,args);
    });
  }
  const rpc=async(n,name,args=[])=> (await roleQuery(n,`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as value`,args)).rows[0].value;
  const publish=async n=>{
    const pending=await rpc(n,'stories_reserve',['image','image/jpeg',1024,request(n)]);
    return rpc(n,'stories_publish',[pending.id,worker,128,128,null,null,'Synthetic Story']);
  };
  const feed=async()=>new Set((await rpc(2,'stories_feed')).map(story=>story.owner_id));
  try {
    await db.exec(await read('tests/fixtures/stories-schema.sql'));
    await db.exec(await read('supabase/migrations/20261021061842_enable_native_stories.sql'));
    await db.exec(await read('supabase/migrations/20261021064257_harden_story_publication_quota.sql'));
    for(let n=1;n<=5;n++) {
      await db.query('insert into auth.users(id) values($1)',[uid(n)]);
      await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session(n),uid(n)]);
      await db.query('insert into public.social_profiles(id,username,display_name,is_verified,verification_badge_type) values($1,$2,$3,$4,$5)',
        [uid(n),`member${n}`,`Member ${n}`,n===1||n===5,n===1?'team':'standard']);
    }
    const priorAcl=(await db.query("select proacl from pg_proc where oid='private.stories_feed_v1(text)'::regprocedure")).rows[0].proacl;
    await db.exec(await read('supabase/migrations/20261023055815_separate_story_default_publishers.sql'));
    assert.deepEqual((await db.query('select user_id from private.story_default_publishers')).rows.map(row=>row.user_id),[uid(1)],'seed only currently verified team accounts');
    assert.deepEqual((await db.query("select proacl from pg_proc where oid='private.stories_feed_v1(text)'::regprocedure")).rows[0].proacl,priorAcl);
    // Simulate a later business/brand approval and a later badge recolouring.
    await db.query("update public.social_profiles set is_verified=true,verification_badge_type='team' where id in ($1,$2)",[uid(3),uid(5)]);
    await db.query("insert into private.story_worker_credentials values('stories-worker-v1',encode(sha256(convert_to($1,'UTF8')),'hex'),true)",[worker]);
    const official=await publish(1),brand=await publish(3),unverified=await publish(4);await publish(5);
    assert.deepEqual(await feed(),new Set([uid(1)]));
    assert.equal((await rpc(2,'stories_get',[brand.id])).id,brand.id,'public direct reads remain public for signed-in viewers');
    assert.deepEqual((await rpc(2,'stories_feed',['member3'])).map(story=>story.id),[brand.id],'profile-specific discovery remains available');
    assert.equal((await rpc(3,'stories_feed')).some(story=>story.id===brand.id),true,'authors retain their own Stories');
    await db.query('insert into public.social_follows values($1,$2)',[uid(2),uid(3)]);
    assert.deepEqual(await feed(),new Set([uid(1),uid(3)]));
    await db.query('delete from public.social_follows');

    for(const role of ['anon','authenticated']) {
      await assert.rejects(roleQuery(2,'select * from private.story_default_publishers',[],role),/permission denied/);
      await assert.rejects(roleQuery(2,'insert into private.story_default_publishers(user_id) values($1)',[uid(3)],role),/permission denied/);
      await assert.rejects(roleQuery(2,'delete from private.story_default_publishers',[],role),/permission denied/);
      for(const permission of ['SELECT','INSERT','UPDATE','DELETE']) assert.equal(
        (await db.query('select has_table_privilege($1,$2,$3) as allowed',[role,'private.story_default_publishers',permission])).rows[0].allowed,false);
    }
    const rls=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='private.story_default_publishers'::regclass")).rows[0];
    assert.deepEqual(rls,{relrowsecurity:true,relforcerowsecurity:true});
    await roleQuery(null,'insert into private.story_default_publishers(user_id) values($1)',[uid(4)],'service_role');
    assert.deepEqual(await feed(),new Set([uid(1)]),'registry entries also require current verification');
    await db.query('update public.social_profiles set is_verified=true where id=$1',[uid(4)]);
    assert.deepEqual(await feed(),new Set([uid(1),uid(4)]),'explicit publisher authority is independent of badge colour');
    await db.query('update public.social_profiles set is_verified=false where id=$1',[uid(4)]);
    assert.equal((await rpc(2,'stories_get',[unverified.id])).id,unverified.id,'unverified public Story remains directly readable');
    await db.query("update public.social_profiles set verification_badge_type='standard' where id=$1",[uid(1)]);
    assert.deepEqual(await feed(),new Set([uid(1)]),'existing default publisher survives a colour-only classification change');
    await db.query('update public.social_profiles set is_verified=false where id=$1',[uid(1)]);
    assert.deepEqual(await feed(),new Set());
    assert.equal((await rpc(2,'stories_get',[official.id])).id,official.id);
    await roleQuery(null,'delete from private.story_default_publishers where user_id=$1',[uid(4)],'service_role');
  } finally {await db.close();}
});
