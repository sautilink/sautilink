import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { buildOriginalMp4Index as build } from '../scripts/lib/original-mp4-index.mjs';
import { fixture } from './fixtures/original-mp4-index-fixture.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('version0 repairs fixed-width movie/track/media headers without mutating source',()=>{
 const source=fixture(),before=hash(source),r=build(source,{repairDurationHeaders:true});assert.ok(r);assert.equal(hash(source),before);
 assert.equal(r.completeDurationMs,4000);assert.equal(r.headerPatches.length,3);assert.equal(r.entries.length,2);
 assert.deepEqual(r.entries.map(e=>[e.time,e.trafNumber,e.trunNumber,e.sampleNumber]),[['1000',1,1,2],['3000',1,1,2]]);
 for(const p of r.headerPatches)assert.equal(p.length,4);
});
test('version1 headers retain64-bit slot widths and complete durations',()=>{const r=build(fixture({version:1}),{repairDurationHeaders:true});assert.ok(r);assert.ok(r.headerPatches.every(p=>p.length===8));assert.equal(r.completeDurationMs,4000);});
test('TFRA uses real1-based traf/trun/sample coordinates, not hardcodedfirst sample',()=>{
 const r=build(fixture({audioFirst:true,emptyTrun:true}),{repairDurationHeaders:true});assert.ok(r);
 assert.ok(r.entries.every(e=>e.trackId===2&&e.trafNumber===2&&e.trunNumber===2&&e.sampleNumber===2));
});
test('append-only prototype preserves every original prefix byte',()=>{const source=fixture(),r=build(source);assert.ok(r);assert.equal(r.headerPatches.length,0);assert.deepEqual(r.bytes.subarray(0,source.length),source);});
test('MFRO exact16-byte footer contains total MFRA length and TFRA is version1',()=>{
 const r=build(fixture());const b=Buffer.from(r.bytes);assert.equal(b.readUInt32BE(b.length-16),16);assert.equal(b.toString('ascii',b.length-12,b.length-8),'mfro');
 assert.equal(b.readUInt32BE(b.length-4),r.appendedSize);assert.equal(b.toString('ascii',r.originalSize+12,r.originalSize+16),'tfra');assert.equal(b[r.originalSize+16],1);
});
test('already indexed input is refused instead of duplicating footer',()=>assert.equal(build(build(fixture()).bytes),null));
test('nonrandom-access video is refused',()=>assert.equal(build(fixture({rap:false})),null));
test('encrypted sample entry is refused',()=>assert.equal(build(fixture({encrypted:true})),null));
test('mp4a with a non-AAC object type is refused',()=>assert.equal(build(fixture({audioFirst:true,nonAac:true})),null));
test('forbidden-zero-bit NAL cannot be indexed as IDR',()=>{const x=fixture(),n=Buffer.from(x).indexOf(Buffer.from([0,0,0,1,0x65]));x[n+4]=0xe5;assert.equal(build(x),null);});
test('mixed IDR and non-IDR VCL in one declared-sync sample is refused',()=>assert.equal(build(fixture({mixedNal:true})),null));
test('edit-list timelines are refused until explicitly implemented',()=>assert.equal(build(fixture({edit:true})),null));
test('zero sample duration is refused',()=>assert.equal(build(fixture({duration:0})),null));
test('out-of-object sample offsets are refused',()=>assert.equal(build(fixture({offsetDelta:100000})),null));
test('backwards decode discontinuity larger than one sample is refused',()=>assert.equal(build(fixture({largeJump:true})),null));
test('invalid NAL byte length cannot create a sync index',()=>{const x=fixture();const needle=Buffer.from([0,0,0,1,0x65]);const offset=Buffer.from(x).indexOf(needle);assert.ok(offset>0);x[offset+3]=255;assert.equal(build(x),null);});
test('missing SPS is refused instead of indexing an unusable configuration',()=>{const x=fixture();const avcc=Buffer.from(x).indexOf(Buffer.from('avcC'));x[avcc+9]=0xe0;assert.equal(build(x),null);});
test('malformed/truncated atom and oversized atom bounds are refused',()=>{
 const x=fixture();for(const end of [0,1,7,15,x.length-1,x.length-3,x.length-7])assert.equal(build(x.subarray(0,end)),null);
 const y=x.slice();new DataView(y.buffer).setUint32(0,0xffffffff);assert.equal(build(y),null);
});
test('size-zero final atom is refused because it would absorb appended bytes',()=>{const x=fixture();let p=0;while(p<x.length){const v=new DataView(x.buffer).getUint32(p);if(p+v===x.length){new DataView(x.buffer).setUint32(p,0);break;}p+=v;}assert.equal(build(x),null);});
test('reserved trun flags are refused',()=>{const x=fixture();const t=Buffer.from(x).indexOf(Buffer.from('trun'));x[t+7]|=0x08;assert.equal(build(x),null);});
