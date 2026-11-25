import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=await readFile(new URL('../supabase/functions/sautilink-push-dispatch/index.ts',import.meta.url),'utf8');
const fn=stripTypeScriptTypes(source.slice(source.indexOf('async function buildSocialPayload('),source.indexOf('async function buildMessagePayload(')));
const post='00000000-0000-4000-8000-000000000010',recipient='00000000-0000-4000-8000-000000000001';
async function payload(count,{visible=true,enabled=true}={}){
 const context=vm.createContext({clean:x=>String(x??'').trim(),isUuid:x=>/^[0-9a-f-]{36}$/.test(x),
  getActor:async()=>null,actorName:()=> 'SautiLink',memberNoticeCopy:()=>'',
  adminRest:async path=>({ok:true,body:path.startsWith('social_notifications?') ? [{notification_type:'trending',notification_event:'trending_chart_entry',post_id:post,event_data:{post_count:count,best_rank:2}}]
    :path.startsWith('social_posts?') ? visible?[{id:post}]:[]
    :path.startsWith('social_profiles?') ? [{id:recipient}]
    :[{notify_post_activity:enabled}]})});
 vm.runInContext(fn+';globalThis.build=buildSocialPayload;',context);
 return context.build('1',recipient);
}
test('real push builder celebrates singular/plural achievements and opens the original post',async()=>{
 const single=await payload(1),multiple=await payload(3);
 assert.match(single.body,/Your post made the Trending Charts · #2/);
 assert.match(multiple.body,/3 of your posts made the Trending Charts/);
 assert.equal(single.route,`/post/${post}`);assert.equal(single.type,'trending');
});
test('a withdrawn/private post or disabled activity notifications cancel a queued achievement push',async()=>{
 assert.equal(await payload(1,{visible:false}),null);
 assert.equal(await payload(1,{enabled:false}),null);
});
