import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
async function source(path){return readFile(new URL(path,root),'utf8');}

test('sticker picker installed on the canonical Web app',async()=>{
 const html=await source('app/index.html');
 assert.match(html,/\/app\/assets\/sticker-engine\.css/);
 assert.match(html,/\/app\/assets\/sticker-engine\.js/);
 assert.match(html,/https:\/\/stickers\.sautilink\.com/);
 assert.match(html,/<textarea id="message-body"/);
 assert.match(html,/<textarea id="conversation-reply-body"/);
 assert.match(html,/<textarea id="circle-sauti-body"/);
});
test('all five conversation surfaces retain their existing submission transport',async()=>{
 const ui=await source('app/assets/sticker-engine.js');
 for(const selector of ['message-thread-feed','conversation-thread','circle-stream-feed',
   'message-body','conversation-reply-body','circle-sauti-body',
   'stream-feed','sauti-comment-body','comment-body','dm-message']){
  assert.ok(ui.includes(selector),'Missing selector '+selector);
 }
 assert.match(ui,/insertStickerToken/);
 assert.match(ui,/dispatchEvent\(new Event\('input'/);
 assert.ok(!ui.includes('.innerHTML'),'Sticker UI must not inject HTML');
 assert.ok(!ui.includes('.insert({') && !ui.includes('supabase.from('),'Sticker picker must not write to messaging backend');
});
test('CSP allows only the first-party sticker API and CDN in all Web artifact variants',async()=>{
 const html=await source('app/index.html');
 const headers=await source('_headers');
 const builder=await source('scripts/build-production-release.mjs');
 const policy='https://stickers.sautilink.com';
 for(const [name,text] of [['HTML CSP',html],['static headers',headers],['production builder',builder]]){
  assert.ok(text.includes("connect-src 'self' "+policy),name+' must allow API');
  assert.ok(text.includes("img-src 'self' "+policy),name+' must allow sticker images');
 }
 const player=await source('app/assets/vendor/lottie_light_canvas.min.js');
 assert.ok(player.length>50000 && player.length<350000);
 const license=await source('licenses/lottie-web-MIT.txt');
 assert.match(license,/MIT License/);
});
test('picker remains opt-in and safe for readonly or disabled forms',async()=>{
 const ui=await source('app/assets/sticker-engine.js');
 assert.match(ui,/input\.disabled\|\|input\.readOnly/);
 assert.match(ui,/makeStickerToken\(s\.id,mode\)/);
 assert.match(ui,/trustedStickerAsset\(s,API\)/);
 assert.match(ui,/prefers-reduced-motion/);
});
