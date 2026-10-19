// Entirely synthetic ISO-BMFF fixture; no real user media.
const cat=(...a)=>Buffer.concat(a), u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n>>>0);return b;}, u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));return b;};
const box=(type,...parts)=>{const data=cat(...parts);return cat(u32(data.length+8),Buffer.from(type),data);};
const full=(type,version,flags,...parts)=>box(type,u32((version<<24)|flags),...parts);
const desc=(tag,payload)=>cat(Buffer.from([tag,payload.length]),payload);
function header(type,version,scale,duration){return full(type,version,0,Buffer.alloc(version?16:8),u32(scale),version?u64(duration):u32(duration),Buffer.alloc(4));}
function track(id,handler,version=0,options={}){
 const tkhd=full('tkhd',version,7,Buffer.alloc(version?16:8),u32(id),u32(0),version?u64(1):u32(1),Buffer.alloc(60));
 const avcc=box('avcC',Buffer.from([1,100,0,31,255,225,0,1,0x67,1,0,1,0x68]));
 const config=desc(4,cat(Buffer.from([options.nonAac?0x6b:0x40,0x15]),Buffer.alloc(11),desc(5,Buffer.from([0x12,0x10]))));
 const esds=full('esds',0,0,desc(3,cat(u32(0).subarray(1),config,desc(6,Buffer.from([2])))));
 const entry=handler==='vide'?box(options.encrypted?'encv':'avc1',Buffer.alloc(78),avcc):box('mp4a',Buffer.alloc(28),esds);
 const stbl=box('stbl',full('stsd',0,0,u32(1),entry),full('stsz',0,0,u32(0),u32(0)),full('stco',0,0,u32(0)));
 return box('trak',tkhd,...(options.edit?[box('edts')]:[]),box('mdia',header('mdhd',version,scaleFor(handler),1),full('hdlr',0,0,u32(0),Buffer.from(handler),Buffer.alloc(12)),box('minf',stbl)));
}
const scaleFor=()=>1000;
export function fixture({version=0,encrypted=false,edit=false,rap=true,duration=1000,offsetDelta=0,emptyTrun=false,audioFirst=false,largeJump=false,nonAac=false,mixedNal=false}={}){
 const videoId=audioFirst?2:1, trex=id=>full('trex',0,0,u32(id),u32(1),u32(0),u32(0),u32(0x01010000));
 const moov=box('moov',header('mvhd',version,1000,1),...(audioFirst?[track(1,'soun',version,{nonAac})]:[]),track(videoId,'vide',version,{encrypted,edit}),box('mvex',...(audioFirst?[trex(1)]:[]),trex(videoId)));
 const ftyp=box('ftyp',Buffer.from('isom'),u32(0),Buffer.from('isomavc1'));
 let output=cat(ftyp,moov);
 for(let index=0;index<2;index++){
  const base=largeJump&&index===1?0:index*2000;
  const sample=(isRap)=>cat(u32(1),Buffer.from([isRap?0x65:0x61]));
  const videoData=cat(sample(false),sample(rap),...(mixedNal?[sample(false)]:[])),audioData=Buffer.from([0]);
  const tfhd=id=>full('tfhd',0,0x020020,u32(id),u32(0x01010000));
  const tfdt=full('tfdt',1,0,u64(base));
  const make=(videoOffset,audioOffset)=>box('moof',full('mfhd',0,0,u32(index+1)),
   ...(audioFirst?[box('traf',tfhd(1),tfdt,full('trun',1,0x701,u32(1),u32(audioOffset),u32(2000),u32(1),u32(0x02000000)))]:[]),
   box('traf',tfhd(videoId),tfdt,...(emptyTrun?[full('trun',0,0,u32(0))]:[]),
    full('trun',1,0x701,u32(2),u32(videoOffset+offsetDelta),u32(duration),u32(5),u32(0x01010000),u32(duration),u32(mixedNal?10:5),u32(rap?0x02000000:0x01010000))));
  const dummy=make(0,0),offset=dummy.length+8;
  output=cat(output,make(offset+(audioFirst?1:0),offset),box('mdat',...(audioFirst?[audioData]:[]),videoData));
 }
 return new Uint8Array(output);
}
