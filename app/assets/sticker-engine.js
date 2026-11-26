import {makeStickerToken,splitStickerTokens,stickerIds,insertStickerToken,trustedStickerAsset} from './sticker-token-codec.js';
import {installStickerDraftEditor} from './sticker-draft-editor.js';

// The existing SautiLink text transport is intentionally preserved.
// Old clients see readable tokens; upgraded Web clients render approved media.
const API='https://stickers.sautilink.com';
const scopes=[
 ['message-thread-feed','.dm-message:not(.deleted) > p'],
 ['conversation-thread','.comment-body,.sauti-comment-body'],
 ['circle-stream-feed','.sauti-card-body,.comment-body,.sauti-comment-body'],
 ['stream-feed','.sauti-card-body,.sauti-caption-text,.sauti-comment-body'],
 ['discover-sauti-feed','.sauti-card-body,.sauti-caption-text,.sauti-comment-body'],
 ['saved-sauti-feed','.sauti-card-body,.sauti-caption-text,.sauti-comment-body'],
 ['profile-surface','.profile-activity-body,.sauti-card-body,.sauti-caption-text']
];
const inputs=[
 ['sauti-body','sauti-composer','sauti-submit'],
 ['message-body','message-composer','message-send'],
 ['conversation-reply-body','conversation-reply-form','conversation-reply-submit'],
 ['circle-sauti-body','circle-sauti-composer','circle-sauti-submit']
];
const cache=new Map(),pending=new WeakMap(),animations=new Map();
let dialog,grid,search,packs,status,target,mode='sticker',version=0,controller,playerPromise,scanFrame=0;
let lite=false;try{lite=localStorage.getItem('sautilink.stickers.lite')==='1';}catch{}
const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function el(tag,cls='',text=''){
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(text)node.textContent=text;
 return node;
}
const safeSticker=s=>trustedStickerAsset(s,API);
function stickerPreview(s){
 try { const u=new URL(s.preview_url);return u.origin===API&&!u.search&&!u.hash&&/^\/assets\/[a-z0-9/_-]+\.webp$/.test(u.pathname)?u.href:null; } catch {return null;}
}
async function api(path,signal){
 const response=await fetch(API+path,{method:'GET',mode:'cors',credentials:'omit',headers:{accept:'application/json'},signal});
 if(!response.ok)throw Error('Sticker service unavailable');
 return response.json();
}
async function resolveIds(ids){
 const missing=[...new Set(ids)].filter(id=>!cache.has(id)).slice(0,80);
 for(let i=0;i<missing.length;i+=60){
  const batch=missing.slice(i,i+60);
  const json=await api('/api/v1/stickers?limit=60&ids='+encodeURIComponent(batch.join(',')));
  for(const id of batch)cache.set(id,null);
  for(const s of json.data||[])if(batch.includes(s.id)&&safeSticker(s))cache.set(s.id,s);
 }
 return cache;
}
function player(){
 if(playerPromise)return playerPromise;
 playerPromise=new Promise((resolve,reject)=>{
  if(window.lottie?.loadAnimation)return resolve(window.lottie);
  const script=el('script');script.src='/app/assets/vendor/lottie_light_canvas.min.js';script.async=true;
  script.onload=()=>window.lottie?.loadAnimation?resolve(window.lottie):reject(Error('Player invalid'));
  script.onerror=()=>reject(Error('Player unavailable'));document.head.append(script);
 }).catch(error=>{playerPromise=null;throw error;});
 return playerPromise;
}
function cleanup(){
 for(const [node,animation] of animations){
  if(!node.isConnected||lite||reduced()){
   try{animation.destroy();}catch{}
   animations.delete(node);
   if(node.isConnected)node.replaceChildren(el('span','sl-sticker-fallback',node.dataset.fallback||'✨'));
  }
 }
}
async function mountMotion(node,sticker,url){
 let placeholder;
 try{
  if(Number.isInteger(sticker.render_revision)&&sticker.render_revision>0&&sticker.render_revision<=9999){const versioned=new URL(url);versioned.searchParams.set('v',String(sticker.render_revision));url=versioned.href;}
  const [lottie,response]=await Promise.all([player(),fetch(url,{mode:'cors',credentials:'omit'})]);
  if(!response.ok)throw Error('Motion unavailable');
  const text=await response.text();if(text.length>512000)throw Error('Motion too large');
  const data=JSON.parse(text);
  if(!Array.isArray(data.layers)||data.layers.length>16||data.layers.some(l=>l.ty!==4)||
     !Array.isArray(data.assets)||data.assets.length||data.w>512||data.h>512||
     !Number.isFinite(data.fr)||data.fr<1||data.fr>60||(data.op-data.ip)/data.fr>5)throw Error('Motion format invalid');
  if(!node.isConnected||lite||reduced())return;
  placeholder=el('span','sl-sticker-canvas');node.replaceChildren(placeholder);
  animations.set(node,lottie.loadAnimation({
   container:placeholder,renderer:'canvas',loop:true,autoplay:true,animationData:data,
   rendererSettings:{clearCanvas:true}
  }));
 }catch{
  if(placeholder?.parentNode===node)node.replaceChildren(el('span','sl-sticker-fallback',node.dataset.fallback||'✨'));
 }
}
function media(s,{inline=false,large=false,preview=false}={}){
 const node=el('span','sl-sticker-render'+(inline?' inline':'')+(large?' large':''));
 node.setAttribute('role','img');node.setAttribute('aria-label',s.title||'Sticker');
 node.dataset.fallback=s.emoji||'✨';
 node.append(el('span','sl-sticker-fallback',node.dataset.fallback));
 const thumbnail=preview&&stickerPreview(s);
 const url=thumbnail||safeSticker(s);
 if(!url||lite||reduced())return node;
 if(thumbnail||s.format!=='lottie'){
  const image=el('img');image.src=url;image.alt='';image.loading='lazy';image.decoding='async';
  image.onerror=()=>image.replaceWith(el('span','sl-sticker-fallback',node.dataset.fallback));node.replaceChildren(image);
 }else{
  const start=()=>{if(node.isConnected)void mountMotion(node,s,url);};
  if('IntersectionObserver' in window){
   const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){io.disconnect();start();}},{rootMargin:'120px'});
   io.observe(node);
  }else queueMicrotask(start);
 }
 return node;
}
function hydrate(node,{force=false}={}){
 if(!node.isConnected)return;
 if(!force&&node.querySelector('.sl-sticker-render'))return;
 const raw=force?(node.dataset.slStickerSource||node.textContent):node.textContent;
 if(!/\[\[sl-sticker:[a-z0-9-]+\]\]|:slv-[a-z0-9-]+:/.test(raw))return;
 const marker={raw};pending.set(node,marker);
 void resolveIds(stickerIds(raw)).then(found=>{
  if(!node.isConnected||pending.get(node)!==marker)return;
  if(!force&&node.textContent!==raw)return;
  const fragment=document.createDocumentFragment();let replaced=false;
  for(const part of splitStickerTokens(raw)){
   const s=part.id&&found.get(part.id);
   if(!s||(part.type==='inline'&&!s.inline_emoji)){
    fragment.append(document.createTextNode(part.value??part.raw));continue;
   }
   fragment.append(media(s,{inline:part.type==='inline',large:part.type==='sticker'}));
   replaced=true;
  }
  if(replaced){node.dataset.slStickerSource=raw;node.replaceChildren(fragment);const only=splitStickerTokens(raw).every(p=>p.id||!String(p.value||'').trim());node.closest('.dm-message')?.classList.toggle('sticker-only',only);}
 }).catch(()=>{/* Preserve readable tokens when offline. */});
}
function scanFeed(node,selector){
 for(const body of node.querySelectorAll(selector))hydrate(body);
 for(const form of node.querySelectorAll('form[data-comment-form]')){
  mountButton(form,form.querySelector('textarea'),form.querySelector('button[type=submit]'));
 }
 cleanup();
}
function scanAll(){
 scanFrame=0;
 for(const [id,selector] of scopes){const root=document.getElementById(id);if(root)scanFeed(root,selector);}
}
function queueScan(){if(!scanFrame)scanFrame=requestAnimationFrame(scanAll);}
function mountButton(form,input,send){
 if(!form||!input||!send||form.querySelector('.sl-sticker-open'))return;
 installStickerDraftEditor(input,async part=>{await resolveIds([part.id]);const s=cache.get(part.id);return s?media(s,{preview:true,inline:part.type==='inline'}):null;});
 const button=el('button','sl-sticker-open','☺');
 button.type='button';button.title='Stickers and animated emoji';button.setAttribute('aria-label','Choose a sticker');
 button.addEventListener('click',()=>open(input));send.before(button);
}
function initButtons(){
 for(const [inputId,formId,submitId] of inputs){
  mountButton(document.getElementById(formId),document.getElementById(inputId),document.getElementById(submitId));
 }
}
function makeDialog(){
 dialog=el('dialog','sl-sticker-dialog');dialog.id='sl-sticker-dialog';
 dialog.setAttribute('aria-label','SautiLink Sticker Picker');
 const head=el('div','sl-sticker-dialog-head');
 const heading=el('strong','', 'SautiLink Stickers');
 const close=el('button','','×');close.type='button';close.setAttribute('aria-label','Close');
 close.addEventListener('click',()=>dialog.close());head.append(heading,close);
 const tabs=el('div','sl-sticker-tabs');
 for(const [value,label] of [['sticker','Stickers'],['inline','Motion emoji']]){
  const button=el('button','',label);button.type='button';button.dataset.mode=value;
  button.setAttribute('aria-pressed',String(mode===value));
  button.addEventListener('click',()=>{mode=value;for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.mode===value));void list();});
  tabs.append(button);
 }
 const filters=el('div','sl-sticker-filters');
 search=el('input');search.type='search';search.maxLength=80;search.placeholder='Search stickers / Tafuta';
 search.setAttribute('aria-label','Search stickers');
 packs=el('select');packs.setAttribute('aria-label','Sticker pack');
 const any=el('option','','All packs');any.value='';packs.append(any);
 const label=el('label','sl-sticker-lite');const liteInput=el('input');liteInput.type='checkbox';liteInput.checked=lite;
 liteInput.addEventListener('change',()=>{
  lite=liteInput.checked;try{localStorage.setItem('sautilink.stickers.lite',lite?'1':'0');}catch{}
  cleanup();void list();for(const [id,selector] of scopes){
   const root=document.getElementById(id);if(root)for(const body of root.querySelectorAll(selector))if(body.dataset.slStickerSource)hydrate(body,{force:true});
  }
 });
 label.append(liteInput,document.createTextNode(' Lite'));
 filters.append(search,packs,label);
 grid=el('div','sl-sticker-grid');status=el('p','sl-sticker-status');
 status.setAttribute('role','status');dialog.append(head,tabs,filters,grid,status);document.body.append(dialog);
 dialog.addEventListener('close',()=>{version++;controller?.abort();target=null;});
 dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
 let timeout;
 search.addEventListener('input',()=>{clearTimeout(timeout);timeout=setTimeout(()=>void list(),220);});
 packs.addEventListener('change',()=>void list());
}
async function list(){
 const id=++version;
 controller?.abort();controller=new AbortController();
 grid.replaceChildren();status.textContent='Loading stickers…';
 const pack=mode==='inline'?'sautilink-motion-originals':packs.value;
 const path='/api/v1/stickers?limit=60'+(pack?'&pack='+encodeURIComponent(pack):'')+
  (search.value?'&q='+encodeURIComponent(search.value.trim()):'');
 try{
  const result=await api(path,controller.signal);
  if(id!==version||!dialog.open)return;
  for(const s of result.data||[]){
   if((mode==='inline'&&!s.inline_emoji)||!safeSticker(s))continue;
   cache.set(s.id,s);
   const button=el('button','sl-sticker-option');button.type='button';button.setAttribute('aria-label',s.title);
   button.append(media(s,{preview:true}),el('small','',s.title));
   button.addEventListener('click',()=>choose(s));grid.append(button);
  }
  status.textContent=grid.children.length+' stickers available';
 }catch(e){if(id===version&&dialog.open&&e.name!=='AbortError')status.textContent='Could not load stickers. Try again.';}
}
function choose(s){
 if(!target||!target.isConnected)return;
 let token;
 try{token=makeStickerToken(s.id,mode);}catch{return;}
 if(!insertStickerToken(target,token)){
  status.textContent='Could not insert sticker. Check message length and permissions.';return;
 }
 target.dispatchEvent(new Event('input',{bubbles:true}));
 target.dispatchEvent(new CustomEvent('sautilink:sticker-draft-inserted',{bubbles:true,detail:{
  type:mode==='inline'?'inline_emoji':'sticker',sticker_id:s.id,pack_id:s.pack_id
 }}));
 const input=target;dialog.close();input.focus({preventScroll:true});
}
async function open(input){
 if(!input||input.disabled||input.readOnly)return;
 if(!dialog)makeDialog();target=input;
 mode=input.id==='message-body'?'sticker':'inline';
 for(const button of dialog.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
 search.value='';packs.value='';
 dialog.showModal();status.textContent='Loading packs…';
 try{
  if(packs.options.length===1){
   const response=await api('/api/v1/packs');
   if(!dialog.open)return;
   for(const p of response.data||[]){
    if(!/^[a-z0-9-]{1,90}$/.test(p.id))continue;
    const option=el('option','',p.name);option.value=p.id;packs.append(option);
   }
  }
  if(dialog.open)void list();
 }catch{if(dialog.open)status.textContent='Sticker service is currently unavailable.';}
}
function start(){
 initButtons();
 for(const [id,selector] of scopes){
  const root=document.getElementById(id);if(!root)continue;
  const observer=new MutationObserver(()=>queueScan());
  observer.observe(root,{childList:true,subtree:true,characterData:true});
  scanFeed(root,selector);
 }
 document.addEventListener('sautilink:comment-sheet-toggle',queueScan);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cleanup();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
