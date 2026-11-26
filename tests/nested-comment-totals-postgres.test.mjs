import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const migration=await readFile(new URL('../supabase/migrations/20261125173300_count_nested_replies_in_post_comments.sql',import.meta.url),'utf8');
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema private;
 create table public.social_posts(id uuid primary key,parent_post_id uuid references public.social_posts(id) on delete cascade,
 root_post_id uuid references public.social_posts(id) on delete cascade,body text default '',deleted_at timestamptz,
 post_status text default 'published',moderation_state text default 'visible',comment_count integer not null default 0);
 insert into public.social_posts(id) values('${uuid(1)}'),('${uuid(10)}');
 insert into public.social_posts(id,parent_post_id,root_post_id) values
 ('${uuid(2)}','${uuid(1)}','${uuid(1)}'),('${uuid(3)}','${uuid(1)}','${uuid(1)}'),
 ('${uuid(4)}','${uuid(1)}','${uuid(1)}'),('${uuid(5)}','${uuid(2)}','${uuid(1)}');
 update public.social_posts set comment_count=3 where id='${uuid(1)}';`);
 return db;
}
const count=async(db,n)=>(await db.query('select comment_count as n from public.social_posts where id=$1',[uuid(n)])).rows[0]?.n;

test('three comments plus a reply equals four, while preserving direct thread counts',async()=>{
 const db=await fixture();try{
  assert.equal(await count(db,1),3);await db.exec(migration);
  assert.equal(await count(db,1),4);assert.equal(await count(db,2),1);assert.equal(await count(db,10),0);
  await db.exec(`insert into public.social_posts(id,parent_post_id,root_post_id) values('${uuid(6)}','${uuid(5)}','${uuid(1)}')`);
  assert.equal(await count(db,1),5);assert.equal(await count(db,2),1);assert.equal(await count(db,5),1);
  await db.exec(`update public.social_posts set body='edited' where id='${uuid(6)}'`);
  assert.equal(await count(db,1),5);
  await db.exec(`delete from public.social_posts where id='${uuid(2)}'`);
  assert.equal(await count(db,1),2);assert.equal(await count(db,5),undefined);assert.equal(await count(db,6),undefined);
  await db.exec(migration);assert.equal(await count(db,1),2);
 }finally{await db.close();}
});

test('deleted, hidden and unpublished replies leave the total and restore exactly once',async()=>{
 const db=await fixture();try{
  await db.exec(migration);
  for(const [hidden,visible] of [
   ["deleted_at=now()","deleted_at=null"],
   ["moderation_state='hidden'","moderation_state='visible'"],
   ["post_status='draft'","post_status='published'"]
  ]){
   await db.exec(`update public.social_posts set ${hidden} where id='${uuid(5)}'`);
   assert.equal(await count(db,1),3);assert.equal(await count(db,2),0);
   await db.exec(`update public.social_posts set ${hidden} where id='${uuid(5)}'`);
   assert.equal(await count(db,1),3);
   await db.exec(`update public.social_posts set ${visible} where id='${uuid(5)}'`);
   assert.equal(await count(db,1),4);assert.equal(await count(db,2),1);
  }
  const privileges=await db.query(`select has_function_privilege('anon','private.sync_phase26_reply_counts()','execute') as anon,
    has_function_privilege('authenticated','private.sync_phase26_reply_counts()','execute') as authenticated`);
  assert.deepEqual(privileges.rows[0],{anon:false,authenticated:false});
 }finally{await db.close();}
});
