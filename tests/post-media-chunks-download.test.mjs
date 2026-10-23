import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaChunkContract, putMediaChunk, assembleMediaChunks, cleanupMediaChunks, stageLegacyMediaBody } from '../src/sauti-media-chunks.js';
import { handleSautiMediaRequest, inspectMp4Bytes } from '../src/sauti-media-api.js';
import { POST_UPLOAD_PART_BYTES, POST_VIDEO_LIMIT, POST_IMAGE_LIMIT } from '../src/post-media-policy.js';
import { handleSautiRequest } from '../src/sauti-posts-api.js';

const ID='11111111-1111-4111-8111-111111111111',OWNER='22222222-2222-4222-8222-222222222222',POST='33333333-3333-4333-8333-333333333333';
const auth={Authorization:'Bearer valid.jwt.value'};
const u32=n=>Uint8Array.of(n>>>24,n>>>16&255,n>>>8&255,n&255);
function concat(...parts) {const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){result.set(p,o);o+=p.length;}return result;}
const ascii=s=>new TextEncoder().encode(s);
const box=(name,bytes)=>concat(u32(bytes.length+8),ascii(name),bytes);
function mp4(seconds=180,large=false) {
  const mvhd=new Uint8Array(100);const mv=new DataView(mvhd.buffer);mv.setUint32(12,1000);mv.setUint32(16,seconds*1000);
  const tkhd=new Uint8Array(84);const tv=new DataView(tkhd.buffer);tv.setUint32(76,1280*65536);tv.setUint32(80,720*65536);
  // Metadata after mdat exercises sparse/range validation of a large body.
  return concat(box('ftyp',concat(ascii('isom'),new Uint8Array(8))),
    ...(large?[box('mdat',new Uint8Array(POST_UPLOAD_PART_BYTES))]:[]),box('moov',concat(box('mvhd',mvhd),box('trak',box('tkhd',tkhd)))));
}
function row(size=POST_UPLOAD_PART_BYTES+256) {return {id:ID,owner_id:OWNER,post_id:null,object_key:`sauti/${OWNER}/${ID}.mp4`,
  media_kind:'video',content_type:'video/mp4',size_bytes:size,upload_status:'pending',expires_at:new Date(Date.now()+60000).toISOString()};}
function bucketFixture() {
  const objects=new Map(),calls=[];let revision=0;
  function object(entry,options={}) {
    if(!entry || (options.onlyIf?.etagMatches && options.onlyIf.etagMatches!==entry.etag))return null;
    const bytes=options.range?entry.bytes.subarray(options.range.offset,options.range.offset+options.range.length):entry.bytes;
    return {etag:entry.etag,httpEtag:`"${entry.etag}"`,size:entry.bytes.length,customMetadata:entry.metadata||{},
      body:new Blob([bytes]).stream(),arrayBuffer:async()=>bytes.slice().buffer,writeHttpMetadata(h){h.set('Content-Type','video/mp4');}};
  }
  const bucket={
    async head(key){calls.push(['head',key]);return object(objects.get(key));},
    async get(key,options={}){calls.push(['get',key,options]);return object(objects.get(key),options);},
    async put(key,body,options={}){calls.push(['put',key,options]);if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;
      const bytes=body instanceof Uint8Array?body.slice():new Uint8Array(await new Response(body).arrayBuffer());
      const entry={bytes,etag:`version${++revision}`,metadata:options.customMetadata};objects.set(key,entry);return object(entry);},
    async delete(keys){calls.push(['delete',keys]);for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);},
    async createMultipartUpload(key,options){calls.push(['multipart',key]);const chunks=[];return{
      async uploadPart(part,body){calls.push(['uploadPart',part]);chunks[part-1]=new Uint8Array(await new Response(body).arrayBuffer());return {partNumber:part,etag:`part${part}`};},
      async complete(parts){assert.equal(parts.length,chunks.length);return bucket.put(key,concat(...chunks),options);},
      async abort(){calls.push(['abort',key]);},
    };},
  };return{bucket,objects,calls};
}
function putRequest(bytes,extra={}) {return new Request(`https://sautilink.com/api/sauti-media/upload/${ID}`,{method:'PUT',headers:{'Content-Type':'video/mp4',...extra},body:bytes});}
async function uploadParts(f,r,bytes){for(let part=1;part<=Math.ceil(bytes.length/POST_UPLOAD_PART_BYTES);part++){
  await putMediaChunk(putRequest(bytes.subarray((part-1)*POST_UPLOAD_PART_BYTES,part*POST_UPLOAD_PART_BYTES)),f.bucket,r,part);
}}

test('chunk upload uses fixed bounded parts, accepts identical retry and rejects replacement/oversize',async()=>{
  const f=bucketFixture(),r=row(POST_UPLOAD_PART_BYTES+1),part=new Uint8Array(POST_UPLOAD_PART_BYTES);
  assert.equal(mediaChunkContract(r).part_count,2);
  await putMediaChunk(putRequest(part),f.bucket,r,1);
  await putMediaChunk(putRequest(part),f.bucket,r,1);
  part[0]=1;await assert.rejects(putMediaChunk(putRequest(part),f.bucket,r,1),e=>e.code==='UPLOAD_PART_CHANGED');
  await assert.rejects(putMediaChunk(putRequest(new Uint8Array(2)),f.bucket,r,2),e=>e.code==='PART_TOO_LARGE');
  await assert.rejects(putMediaChunk(putRequest(new Uint8Array(1)),f.bucket,r,3),e=>e.code==='INVALID_UPLOAD_PART');
  assert.equal(mediaChunkContract({...r,size_bytes:POST_VIDEO_LIMIT+1}),null);
  assert.equal(mediaChunkContract({...r,size_bytes:POST_VIDEO_LIMIT}).part_count,32);
  assert.equal(mediaChunkContract({...r,media_kind:'image'}),null);
});

test('large MP4 completion inspects sparse metadata then streams canonical assembly and cleans staging',async()=>{
  const f=bucketFixture(),bytes=mp4(180,true),r=row(bytes.length);let inspected;
  await uploadParts(f,r,bytes);
  const result=await assembleMediaChunks(f.bucket,r,inspectMp4Bytes,async value=>{inspected=value;return true;});
  assert.equal(result.duration_ms,180000);assert.equal(inspected.width,1280);
  assert.deepEqual(f.objects.get(r.object_key).bytes,bytes);
  assert.equal(f.objects.get(r.object_key).metadata.validated,'true');
  assert.deepEqual([...f.objects.keys()].filter(k=>k.startsWith('post-upload-parts/')),[`post-upload-parts/v1/${OWNER}/${ID}/assembly`]);
  await assert.rejects(assembleMediaChunks(f.bucket,r,inspectMp4Bytes,async()=>true),e=>e.code==='UPLOAD_ASSEMBLING',
    'a delayed request holding an old pending row must not overwrite the completed canonical object');
  const reads=f.calls.filter(([kind])=>kind==='get');const assembling=f.calls.findIndex(([kind])=>kind==='multipart');
  assert.ok(f.calls.slice(0,assembling).filter(([kind])=>kind==='get').every(([, ,options])=>options.range.length<1024));
  assert.ok(reads.every(([, ,options])=>options.onlyIf?.etagMatches),'every staging read binds its immutable version');
  assert.equal(f.calls.filter(([kind])=>kind==='uploadPart').length,2);
});

test('invalid completion never creates canonical media; failed metadata preserves private bytes for authorized cleanup',async()=>{
  for(const mode of ['missing','changed','duration','commit']){
    const f=bucketFixture(),bytes=mp4(mode==='duration'?181:30,true),r=row(bytes.length);
    await uploadParts(f,r,bytes);
    if(mode==='missing')f.objects.delete(`post-upload-parts/v1/${OWNER}/${ID}/2`);
    if(mode==='changed')f.objects.get(`post-upload-parts/v1/${OWNER}/${ID}/1`).metadata.ownerId=POST;
    await assert.rejects(assembleMediaChunks(f.bucket,r,inspectMp4Bytes,async()=>mode!=='commit'));
    assert.equal(f.objects.has(r.object_key),mode==='commit',mode);
    assert.equal(f.objects.has(`post-upload-parts/v1/${OWNER}/${ID}/assembly`),mode==='commit');
    await cleanupMediaChunks(f.bucket,r);
    assert.deepEqual([...f.objects.keys()],mode==='commit'?[r.object_key]:[],
      'chunk cleanup removes staging only; canonical cleanup requires the existing authorized row cancellation');
  }
});

test('older canonical first-writer wins over a later multipart completion without overwrite or deletion',async()=>{
  const f=bucketFixture(),bytes=mp4(30,true),r=row(bytes.length);
  await uploadParts(f,r,bytes);
  const original=mp4(25,true);
  const complete=f.bucket.createMultipartUpload;
  let committed=false;
  f.bucket.createMultipartUpload=async(...args)=>{
    const upload=await complete(...args);
    return {...upload,async complete(parts){
      const result=await upload.complete(parts);
      // Reproduce an old Worker which selected the pending row before this
      // completion and finalized the canonical key while parts were assembling.
      await f.bucket.put(r.object_key,original,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{ownerId:OWNER,mediaId:ID,validated:'true'}});
      return result;
    }};
  };
  await assert.rejects(assembleMediaChunks(f.bucket,r,inspectMp4Bytes,async()=>{committed=true;return false;}),e=>e.code==='UPLOAD_ALREADY_STORED');
  assert.equal(committed,false,'the losing assembly must not attempt a metadata commit');
  assert.deepEqual(f.objects.get(r.object_key).bytes,original,'the already-published original is unchanged');
  assert.equal(f.calls.some(([kind,keys])=>kind==='delete'&&(Array.isArray(keys)?keys:[keys]).includes(r.object_key)),false);
  assert.equal(f.objects.has(`post-upload-parts/v1/${OWNER}/${ID}/assembled.mp4`),false);
  assert.equal(f.calls.find(([kind])=>kind==='multipart')[1],`post-upload-parts/v1/${OWNER}/${ID}/assembled.mp4`);
  assert.equal(f.calls.filter(([kind,key])=>kind==='put'&&key===r.object_key).at(-1)[2].onlyIf.etagDoesNotMatch,'*');
});

test('concurrent completions cannot overwrite a canonical object or mutate staged parts',async()=>{
  const f=bucketFixture(),bytes=mp4(30,true),r=row(bytes.length);await uploadParts(f,r,bytes);
  let unblock;const hold=new Promise(done=>{unblock=done;});const create=f.bucket.createMultipartUpload;
  f.bucket.createMultipartUpload=async(...args)=>{await hold;return create(...args);};
  const first=assembleMediaChunks(f.bucket,r,inspectMp4Bytes,async()=>true);
  while(!f.objects.has(`post-upload-parts/v1/${OWNER}/${ID}/assembly`))await new Promise(done=>setImmediate(done));
  await assert.rejects(assembleMediaChunks(f.bucket,r,inspectMp4Bytes,async()=>true),e=>e.code==='UPLOAD_ASSEMBLING');
  await assert.rejects(putMediaChunk(putRequest(bytes.subarray(0,POST_UPLOAD_PART_BYTES)),f.bucket,r,1),e=>e.code==='UPLOAD_ASSEMBLING');
  unblock();await first;assert.equal(f.calls.filter(([kind])=>kind==='multipart').length,1);
});

test('older whole-PUT clients are staged in8MiB parts rather than a full-video buffer',async()=>{
  const f=bucketFixture(),bytes=mp4(30,true),r=row(bytes.length);
  await stageLegacyMediaBody(putRequest(bytes),f.bucket,r);
  assert.equal(f.objects.get(`post-upload-parts/v1/${OWNER}/${ID}/1`).bytes.length,POST_UPLOAD_PART_BYTES);
  assert.equal(f.objects.get(`post-upload-parts/v1/${OWNER}/${ID}/2`).bytes.length,bytes.length-POST_UPLOAD_PART_BYTES);
  await assembleMediaChunks(f.bucket,r,inspectMp4Bytes,async()=>true);
  assert.deepEqual(f.objects.get(r.object_key).bytes,bytes);
  await assert.rejects(stageLegacyMediaBody(putRequest(new Uint8Array(1)),f.bucket,row(100_000_001)),e=>e.code==='CHUNK_UPLOAD_REQUIRED');
});

function apiFixture() {
  const f=bucketFixture();f.current=row(8);f.user=OWNER;f.post={id:POST,author_id:OWNER};f.reads=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(input);f.reads.push([url.pathname,url.search,init.headers]);
    if(url.pathname==='/auth/v1/user')return Response.json({id:f.user});
    if(url.pathname==='/rest/v1/social_post_media'){
      if(init.method==='POST')return Response.json([JSON.parse(init.body)]);
      if(init.method==='PATCH'){
        f.current={...f.current,...JSON.parse(init.body)};
        if(f.losePatchAck)throw Error('response disappeared after database ACK');
        return Response.json([{id:ID}]);
      }
      return Response.json(f.current?[f.current]:[]);
    }
    if(url.pathname==='/rest/v1/social_posts'){
      assert.equal(url.searchParams.get('visibility'),'eq.public');assert.equal(url.searchParams.get('circle_id'),'is.null');
      assert.equal(url.searchParams.get('parent_post_id'),'is.null');assert.equal(url.searchParams.get('post_status'),'eq.published');
      assert.equal(url.searchParams.get('moderation_state'),'eq.visible');assert.equal(url.searchParams.get('deleted_at'),'is.null');
      return Response.json(f.post?[f.post]:[]);
    }throw Error(`unexpected ${url.pathname}`);
  };
  f.restore=()=>{globalThis.fetch=original;};f.env={SAUTI_MEDIA:f.bucket,SAUTI_MEDIA_BEGIN_LIMITER:{limit:async()=>({success:true})}};
  return f;
}

test('HTTP upload bounds and fresh ownership reject unauthorized/expired/whole large requests',async()=>{
  const f=apiFixture();try{
    let response=await handleSautiMediaRequest(putRequest(new Uint8Array(8)),f.env);assert.equal(response.status,401);
    f.current={...row(POST_UPLOAD_PART_BYTES+1),owner_id:POST};
    response=await handleSautiMediaRequest(putRequest(new Uint8Array(1),auth),f.env);assert.equal(response.status,404);
    f.current={...row(POST_UPLOAD_PART_BYTES+1),expires_at:new Date(Date.now()-1000).toISOString()};
    response=await handleSautiMediaRequest(putRequest(new Uint8Array(1),auth),f.env);assert.equal(response.status,410);
    f.current=row(100_000_001);
    response=await handleSautiMediaRequest(putRequest(new Uint8Array(1),auth),f.env);assert.equal(response.status,413);
    for(const [content_type,size_bytes] of [['video/mp4',POST_VIDEO_LIMIT+1],['image/jpeg',POST_IMAGE_LIMIT+1]]){
      response=await handleSautiMediaRequest(new Request('https://sautilink.com/api/sauti-media/begin',{method:'POST',headers:auth,body:JSON.stringify({content_type,size_bytes})}),f.env);
      assert.equal(response.status,413);
    }
    assert.equal(f.calls.filter(([kind])=>kind==='put').length,0);
  }finally{f.restore();}
});

test('whole PUT compatibility and multipart completion survive a lost metadata ACK without deleting bytes',async()=>{
  const f=apiFixture();try{
    const bytes=mp4(30,true);f.current=row(bytes.length);f.losePatchAck=true;
    let response=await handleSautiMediaRequest(putRequest(bytes,auth),f.env);assert.equal(response.status,200);
    assert.equal(f.current.upload_status,'uploaded');assert.deepEqual(f.objects.get(f.current.object_key).bytes,bytes);
    const complete=new Request(`https://sautilink.com/api/sauti-media/upload/${ID}?complete=1`,{method:'PUT',headers:auth});
    response=await handleSautiMediaRequest(complete,f.env);assert.equal(response.status,200);
    assert.equal(f.calls.filter(([kind])=>kind==='multipart').length,1);
  }finally{f.restore();}
});

test('Shorts downloads stream only fresh-authorized public root video, support resume and bind source ETag',async()=>{
  const f=apiFixture();try{
    const bytes=mp4(30);f.current={...row(bytes.length),post_id:POST,upload_status:'attached'};
    await f.bucket.put(f.current.object_key,bytes,{customMetadata:{ownerId:OWNER,mediaId:ID,validated:'true'}});
    const request=(headers={},method='GET')=>new Request(`https://sautilink.com/api/sauti-media/${ID}/download`,{method,headers:{...auth,...headers}});
    let response=await handleSautiMediaRequest(request(),f.env);
    assert.equal(response.status,200);assert.match(response.headers.get('Content-Disposition'),/^attachment; filename="SautiLink-/);
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
    response=await handleSautiMediaRequest(request({Range:'bytes=2-5'}),f.env);assert.equal(response.status,206);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes.slice(2,6));
    response=await handleSautiMediaRequest(request({Range:'bytes=2-5','If-Range':'"stale"'}),f.env);assert.equal(response.status,200);await response.body.cancel();
    response=await handleSautiMediaRequest(request({Range:'bytes=999999-'}),f.env);assert.equal(response.status,416);
    response=await handleSautiMediaRequest(request({},'HEAD'),f.env);assert.equal(response.status,200);assert.equal(response.body,null);
    response=await handleSautiMediaRequest(new Request(`https://sautilink.com/api/sauti-media/${ID}/download`),f.env);assert.equal(response.status,401);
    f.post=null;response=await handleSautiMediaRequest(request(),f.env);assert.equal(response.status,404);
    f.post={id:POST,author_id:OWNER};f.current.upload_status='ready';response=await handleSautiMediaRequest(request(),f.env);assert.equal(response.status,404);
    f.current.upload_status='attached';const get=f.bucket.get;
    f.bucket.get=async(key,options)=>{f.objects.get(key).etag='replaced';return get(key,options);};
    response=await handleSautiMediaRequest(request(),f.env);assert.equal(response.status,404);
    assert.ok(f.reads.filter(([p])=>p==='/rest/v1/social_posts').length>=6);
  }finally{f.restore();}
});

test('post publish validates10 real attachments and rejects11 or historical oversized ready media before creation',async()=>{
  const original=globalThis.fetch;let creates=0;let oversized=false;
  const media=Array.from({length:11},(_,index)=>({id:`55555555-5555-4555-8555-${String(index).padStart(12,'0')}`}));
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname==='/auth/v1/user')return Response.json({id:OWNER});
    if(url.pathname==='/rest/v1/rpc/room_held_media_uploads')return Response.json([]);
    if(url.pathname==='/rest/v1/social_post_media'){
      const id=url.searchParams.get('id').slice(3);
      if(init.method==='PATCH')return Response.json([{id}]);
      return Response.json([{id,owner_id:OWNER,object_key:`sauti/${OWNER}/${id}.jpg`,media_kind:'image',content_type:'image/jpeg',size_bytes:oversized?POST_IMAGE_LIMIT+1:POST_IMAGE_LIMIT}]);
    }
    if(url.pathname==='/rest/v1/social_posts'&&init.method==='POST'){
      creates++;assert.equal(JSON.parse(init.body).media_count,10);return Response.json([{id:POST}]);
    }throw Error(`unexpected ${url.pathname}`);
  };
  const env={SAUTI_CREATE_LIMITER:{limit:async()=>({success:true})},SAUTI_MEDIA:{
    head:async key=>({size:POST_IMAGE_LIMIT,customMetadata:{ownerId:OWNER,mediaId:key.split('/').pop().slice(0,-4),validated:'true'}}),
  }};
  const request=items=>new Request('https://sautilink.com/api/sauti',{method:'POST',headers:auth,body:JSON.stringify({body:'Post',media:items})});
  try{
    let response=await handleSautiRequest(request(media),env);assert.equal(response.status,400);assert.equal(creates,0);
    response=await handleSautiRequest(request(media.slice(0,10)),env);assert.equal(response.status,201);assert.equal(creates,1);
    oversized=true;response=await handleSautiRequest(request(media.slice(0,1)),env);assert.equal(response.status,413);assert.equal(creates,1);
  }finally{globalThis.fetch=original;}
});
