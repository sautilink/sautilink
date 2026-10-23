import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const read = path => readFile(new URL(`../${path}`,import.meta.url),'utf8');
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const POST='33333333-3333-4333-8333-333333333333';
const LEGACY_POST='66666666-6666-4666-8666-666666666666';
const DELETE_POST='77777777-7777-4777-8777-777777777777';
const id=n=>`44444444-4444-4444-8444-${String(n).padStart(12,'0')}`;
async function user(db,owner,sql,args=[]) {
  await db.exec('begin');
  try {await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]); await db.exec('set local role authenticated');
    const result=await db.query(sql,args); await db.exec('commit'); return result;
  } catch(error) {await db.exec('rollback'); throw error;}
}
test('PostgreSQL post limits allow10/180s/250MiB, reject bypasses and preserve old images and owner RLS',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;create schema private;
      grant usage on schema public,auth,private to anon,authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.social_profiles(id uuid primary key);
      insert into public.social_profiles values('${OWNER}'),('${OTHER}');
      create table public.social_posts(id uuid primary key default gen_random_uuid(),author_id uuid,body text default '',circle_id uuid,
        visibility text default 'public',post_status text default 'published',reply_access text,quote_post_id uuid,parent_post_id uuid,client_request_id uuid);
      alter table public.social_posts enable row level security;
      create policy posts_read on public.social_posts for select to anon,authenticated using(visibility='public' or author_id=auth.uid());
      create policy posts_insert on public.social_posts for insert to authenticated with check(author_id=auth.uid());
      grant select on public.social_posts to anon,authenticated;`);
    await db.exec(await read('supabase/migrations/20260902013000_enable_phase27_sauti_media.sql'));
    await db.exec(await read('supabase/migrations/20260910064000_allow_five_post_media_items.sql'));
    await db.exec(`insert into public.social_posts(id,author_id,body) values('${POST}','${OWNER}','Post fixture'),
      ('${LEGACY_POST}','${OWNER}','Legacy fixture'),('${DELETE_POST}','${OWNER}','Delete fixture');
      insert into public.social_post_media(id,owner_id,object_key,media_kind,content_type,size_bytes,post_id,position,upload_status,finalized_at,attached_at)
      values('${id(99)}','${OWNER}','sauti/${OWNER}/${id(99)}.jpg','image','image/jpeg',8388608,'${LEGACY_POST}',0,'attached',now(),now()),
      ('${id(98)}','${OWNER}','sauti/${OWNER}/${id(98)}.jpg','image','image/jpeg',8388608,'${DELETE_POST}',0,'attached',now(),now());`);
    await db.exec(await read('supabase/migrations/20261023043819_expand_post_media_policy.sql'));
    assert.equal((await db.query('select size_bytes from public.social_post_media')).rows[0].size_bytes,8388608);
    // Retaining reads alone is insufficient: the old NOT VALID CHECK still
    // rejected these ordinary updates to an unchanged historical payload.
    await user(db,OWNER,'update public.social_post_media set alt_text=$1 where id=$2',['Revised accessible description',id(99)]);
    await user(db,OWNER,'update public.social_post_media set width=640,height=480 where id=$1',[id(99)]);
    await db.query("update public.social_posts set post_status='hidden' where id=$1",[LEGACY_POST]);
    // Existing payload annotations survive while identity/type/size changes do
    // not turn grandfathering into a direct Data API upload-limit escape.
    await assert.rejects(db.query('update public.social_post_media set size_bytes=7340032 where id=$1',[id(99)]),/POST_IMAGE_SIZE_LIMIT/);
    await assert.rejects(db.query("update public.social_post_media set content_type='image/png' where id=$1",[id(99)]),/POST_IMAGE_SIZE_LIMIT/);
    await assert.rejects(db.query('update public.social_post_media set id=$1 where id=$2',[id(97),id(99)]),/POST_IMAGE_SIZE_LIMIT/);
    await assert.rejects(db.query('update public.social_post_media set owner_id=$1 where id=$2',[OTHER,id(99)]),/POST_IMAGE_SIZE_LIMIT/);
    await db.exec('begin');
    await db.query('update public.social_post_media set size_bytes=4194304 where id=$1',[id(99)]);
    await assert.rejects(db.query('update public.social_post_media set size_bytes=8388608 where id=$1',[id(99)]),/POST_IMAGE_SIZE_LIMIT/);
    await db.exec('rollback');
    await user(db,OWNER,"update public.social_post_media set post_id=null,position=null,upload_status='ready',attached_at=null where id=$1",[id(99)]);
    await user(db,OWNER,"update public.social_post_media set expires_at=now()-interval '1 second' where id=$1",[id(99)]);
    await user(db,OWNER,'delete from public.social_post_media where id=$1',[id(99)]);
    await db.query('delete from public.social_posts where id=$1',[DELETE_POST]);
    assert.equal((await db.query('select count(*)::int n from public.social_post_media')).rows[0].n,0,
      'expired upload cleanup and post cascade deletion must retain their behavior for historical8MiB images');
    const insert="insert into public.social_post_media(id,owner_id,object_key,media_kind,content_type,size_bytes) values($1,$2,$3,$4,$5,$6)";
    const media=(n,kind,size,owner=OWNER)=>[id(n),owner,`sauti/${owner}/${id(n)}.${kind==='video'?'mp4':'jpg'}`,kind,kind==='video'?'video/mp4':'image/jpeg',size];
    await user(db,OWNER,insert,media(1,'video',262144000));
    await user(db,OWNER,"update public.social_post_media set duration_ms=180000 where id=$1",[id(1)]);
    await assert.rejects(user(db,OWNER,"update public.social_post_media set duration_ms=180001 where id=$1",[id(1)]),/duration_shape/);
    await assert.rejects(user(db,OWNER,insert,media(12,'video',262144001)),/size_bounds/);
    await assert.rejects(user(db,OWNER,insert,media(12,'image',5242881)),/POST_IMAGE_SIZE_LIMIT/);
    await assert.rejects(db.query("insert into public.social_post_media(id,owner_id,object_key,media_kind,content_type,size_bytes,created_at) values($1,$2,$3,$4,$5,$6,'2000-01-01')",media(12,'image',8388608)),/POST_IMAGE_SIZE_LIMIT/);
    await assert.rejects(user(db,OTHER,insert,media(12,'image',1024)),/row-level security/);
    assert.equal((await user(db,OTHER,'select * from public.social_post_media')).rows.length,0);
    for(let n=2;n<=11;n++) await user(db,OWNER,insert,media(n,'image',5242880));
    await assert.rejects(db.query('update public.social_post_media set size_bytes=5242881 where id=$1',[id(2)]),/POST_IMAGE_SIZE_LIMIT/);
    await assert.rejects(db.query("update public.social_post_media set media_kind='image',content_type='image/jpeg',object_key=$1 where id=$2",[`sauti/${OWNER}/${id(1)}.jpg`,id(1)]),/POST_IMAGE_SIZE_LIMIT/);
    const attach="update public.social_post_media set post_id=$1,position=$2,upload_status='attached',finalized_at=now(),attached_at=now() where id=$3";
    for(let n=1;n<=10;n++) await user(db,OWNER,attach,[POST,n-1,id(n)]);
    await assert.rejects(user(db,OWNER,attach,[POST,9,id(11)]),/POST_MEDIA_LIMIT/);
    await assert.rejects(user(db,OWNER,'update public.social_post_media set position=10 where id=$1',[id(10)]),/position_bounds|attach_shape/);
    await assert.rejects(user(db,OWNER,"insert into public.social_posts(author_id,body,media_count) values($1,'Limit',11)",[OWNER]),/media_count_bounds/);
    assert.equal((await db.query('select count(*)::int n from public.social_post_media where post_id=$1',[POST])).rows[0].n,10);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.social_post_media'::regclass")).rows[0].relrowsecurity,true);
  } finally {await db.close();}
});
