import { createAudioWaveform } from './audio-waveform.js';
export const CREATOR_FONTS = Object.freeze([
  ['Poppins','poppins'],['Montserrat','montserrat'],['Lora','lora'],['Merriweather','merriweather'],
  ['Playfair Display','playfairdisplay'],['Oswald','oswald'],['Anton','anton'],['Bebas Neue','bebasneue'],
  ['Abril Fatface','abrilfatface'],['Lobster','lobster'],['Pacifico','pacifico'],['Dancing Script','dancingscript'],
  ['Caveat','caveat'],['Kalam','kalam'],['Space Mono','spacemono'],
]);
export const CREATOR_FILTERS = Object.freeze([
  ['Original','none'],['Warm','sepia(.18) saturate(1.14)'],['Cool','hue-rotate(12deg) saturate(.9)'],
  ['Vivid','saturate(1.5) contrast(1.08)'],['Soft','contrast(.9) brightness(1.08)'],['Noir','grayscale(1) contrast(1.16)'],
  ['Film','sepia(.2) contrast(1.08) saturate(.8)'],['Fade','contrast(.8) brightness(1.1)'],
  ['Sunset','sepia(.3) saturate(1.35) hue-rotate(-12deg)'],['Golden','sepia(.35) saturate(1.2)'],
  ['Arctic','saturate(.65) hue-rotate(20deg) brightness(1.08)'],['Rose','sepia(.15) hue-rotate(-20deg) saturate(1.2)'],
  ['Chrome','contrast(1.2) saturate(.65)'],['Matte','contrast(.86) saturate(.85)'],['Pop','contrast(1.14) saturate(1.5)'],
  ['Vintage','sepia(.42) contrast(.93)'],['Dramatic','contrast(1.35) brightness(.92)'],['Mono','grayscale(1)'],
]);
const fonts = new Map();
const edited = new WeakSet();
function element(tag, cls = '', text = '') { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; }
function button(label, click, cls = '') { const node = element('button', cls, label); node.type = 'button'; node.addEventListener('click', click); return node; }
function wait(media, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('This media could not be opened. Try another file.')), 20000);
    const done = () => finish(); const failed = () => finish(new Error('This media format is unavailable in this browser.'));
    function finish(error) { clearTimeout(timer); media.removeEventListener(event, done); media.removeEventListener('error', failed); error ? reject(error) : resolve(); }
    media.addEventListener(event, done, { once: true }); media.addEventListener('error', failed, { once: true });
  });
}
async function loadFont(name) {
  const entry = CREATOR_FONTS.find(([label]) => label === name); if (!entry) return;
  if (!fonts.has(name)) fonts.set(name, (async () => {
    const face = new FontFace(name, `url('/app/assets/creator-fonts/${entry[1]}.woff2')`); await face.load(); document.fonts.add(face);
  })().catch(error => { fonts.delete(name); throw error; }));
  return fonts.get(name);
}
export function creatorCrop(width, height, ratio = 0, limit = 1920) {
  const aspect = ratio || width / height;
  const sw = Math.min(width, height * aspect), sh = Math.min(height, width / aspect);
  const scale = Math.min(1, limit / Math.max(sw, sh));
  return { sx:(width-sw)/2, sy:(height-sh)/2, sw, sh, width:Math.max(2,Math.floor(sw*scale/2)*2), height:Math.max(2,Math.floor(sh*scale/2)*2) };
}
export function drawCreatorFrame(canvas, media, state, limit = 1920) {
  const width = media.videoWidth || media.naturalWidth, height = media.videoHeight || media.naturalHeight;
  if (!width || !height) return;
  const crop = creatorCrop(width, height, state.ratio, limit);
  if (canvas.width !== crop.width || canvas.height !== crop.height) { canvas.width = crop.width; canvas.height = crop.height; }
  const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);
  const filter = CREATOR_FILTERS.find(([name]) => name === state.filter)?.[1] || 'none';
  if (!('filter' in ctx) && filter !== 'none') throw new Error('Filters are unavailable in this browser. Choose Original to continue.');
  ctx.filter = filter; ctx.drawImage(media,crop.sx,crop.sy,crop.sw,crop.sh,0,0,canvas.width,canvas.height); ctx.filter = 'none';
  for (const text of state.layers) {
    if (!text.text.trim()) continue;
    const scale = canvas.width / 360, size = text.size * scale;
    ctx.font = `${text.bold ? 700 : 400} ${size}px "${text.font}", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = text.text.split('\n').slice(0,12), widths = lines.map(line => ctx.measureText(line).width);
    const cardWidth = Math.min(canvas.width, Math.max(...widths,0) + size*.9), cardHeight = lines.length*size*1.2+size*.6;
    const x = text.x*canvas.width, y = text.y*canvas.height;
    if (text.card) {
      ctx.fillStyle = text.cardColor; ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(x-cardWidth/2,y-cardHeight/2,cardWidth,cardHeight,size*.25); ctx.fill(); }
      else ctx.fillRect(x-cardWidth/2,y-cardHeight/2,cardWidth,cardHeight);
    }
    ctx.fillStyle = text.color;
    lines.forEach((line,index) => ctx.fillText(line,x,y+(index-(lines.length-1)/2)*size*1.2,canvas.width*.94));
  }
}
function mp4Type() {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1,mp4a.40.2','video/mp4'].find(type => MediaRecorder.isTypeSupported(type)) || '';
}
async function exportVideo(file, state, progress, signal) {
  const mime = mp4Type(); if (!mime) throw new Error('This browser cannot export an edited MP4. Use the original video or try a supported browser.');
  const video = document.createElement('video'), canvas = document.createElement('canvas');
  const url = URL.createObjectURL(file); video.playsInline = true; video.preload = 'auto';
  let context, source, destination, stream, recorder, frame = 0, timer = 0;
  const chunks = []; let aborted = false;
  const abort = () => { aborted = true; video.pause(); if (recorder?.state === 'recording') recorder.stop(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const ready = wait(video,'loadeddata'); video.src = url; await ready;
    if (state.startMs > 0) { const seek = wait(video,'seeked'); video.currentTime = state.startMs/1000; await seek; }
    drawCreatorFrame(canvas,video,state,1280); stream = canvas.captureStream(25);
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      context = new AudioContext({ sampleRate:48000 }); source = context.createMediaElementSource(video); destination = context.createMediaStreamDestination();
      const gain = context.createGain(); gain.gain.value = state.volume; source.connect(gain); gain.connect(destination); await context.resume();
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    } else if (state.volume > 0) throw new Error('This browser cannot retain the original video audio. Use the original video.');
    if (signal.aborted) throw new Error('Export cancelled.');
    recorder = new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4500000,audioBitsPerSecond:128000});
    recorder.addEventListener('dataavailable',event => { if(event.data.size) chunks.push(event.data); });
    const result = new Promise((resolve,reject) => {
      recorder.addEventListener('error',() => reject(new Error('Video export failed. Try a shorter clip.')),{once:true});
      recorder.addEventListener('stop',resolve,{once:true});
    });
    const draw = () => {
      drawCreatorFrame(canvas,video,state,1280);
      progress(Math.min(1,(video.currentTime*1000-state.startMs)/state.durationMs));
      if (video.currentTime*1000 >= state.startMs+state.durationMs || video.ended) { if(recorder.state==='recording')recorder.stop();video.pause();return; }
      frame = requestAnimationFrame(draw);
    };
    recorder.start(200); await video.play(); draw();
    timer = setTimeout(abort,state.durationMs+20000); await result;
    if (aborted || signal.aborted) throw new Error('Export cancelled or timed out.');
    const blob = new Blob(chunks,{type:'video/mp4'});
    if (!blob.size || blob.size > 250*1024*1024) throw new Error('The exported video exceeds the upload limit. Choose a shorter clip.');
    return new File([blob],file.name.replace(/\.[^.]+$/,'')+'-edited.mp4',{type:'video/mp4',lastModified:Date.now()});
  } finally {
    clearTimeout(timer); cancelAnimationFrame(frame); signal.removeEventListener('abort',abort); video.pause(); video.removeAttribute('src'); video.load();
    if(recorder?.state==='recording')recorder.stop(); stream?.getTracks().forEach(track=>track.stop()); source?.disconnect();
    if(context&&context.state!=='closed')await context.close(); URL.revokeObjectURL(url);
  }
}

export async function editCreatorMedia(file) {
  if (edited.has(file) || !/^image\/(jpeg|png|webp)$|^video\/mp4$/.test(file.type)) return file;
  const videoFile = file.type === 'video/mp4'; const media = document.createElement(videoFile?'video':'img');
  const url = URL.createObjectURL(file); if(videoFile){media.playsInline=true;media.preload='auto';}
  try {
    const ready = wait(media,videoFile?'loadeddata':'load'); media.src = url; await ready;
    const duration = videoFile ? Math.round(media.duration*1000) : 0;
    if(videoFile&&(!Number.isFinite(duration)||duration<1000))throw new Error('The video duration could not be read.');
    const state = {ratio:0,filter:'Original',layers:[],startMs:0,durationMs:Math.min(duration,180000),volume:1};
    return await new Promise(resolve => {
      const dialog = element('dialog','creator-media-editor'); dialog.setAttribute('aria-label',videoFile?'Edit video':'Edit photo');
      const header = element('header'); header.append(element('h2','',videoFile?'Edit video':'Edit photo'));
      const canvas = element('canvas','creator-preview'); canvas.setAttribute('aria-label','Edited media preview');
      const status = element('p','creator-status'); status.setAttribute('role','status');
      const aborter = new AbortController(); let busy=false,closed=false,activeText=null,timeline,previewFrame=0,drag=null;
      const finish = value => { if(closed)return;closed=true;aborter.abort();cancelAnimationFrame(previewFrame);media.pause?.();timeline?.destroy();dialog.close();dialog.remove();if(value)edited.add(value);resolve(value); };
      const redraw = () => { try{drawCreatorFrame(canvas,media,state,videoFile?1280:1920);}catch(error){status.textContent=error.message;} };
      header.append(button('×',()=>finish(null),'creator-close'));
      const tools = element('section','creator-tools');
      const ratio = element('select'); ratio.setAttribute('aria-label','Crop ratio');
      for(const [name,value] of [['Original',0],['Square',1],['Portrait',.8],['Story',9/16],['Wide',16/9]]){const option=element('option','',name);option.value=String(value);ratio.append(option);}
      ratio.addEventListener('change',()=>{state.ratio=Number(ratio.value);redraw();});
      const filters = element('div','creator-filters'); filters.setAttribute('aria-label','Filters');
      for(const [name] of CREATOR_FILTERS){const item=button(name,()=>{state.filter=name;filters.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===item)));redraw();});item.setAttribute('aria-pressed',String(name==='Original'));filters.append(item);}
      const textPanel=element('section','creator-text-controls');textPanel.hidden=true;
      const text=element('textarea');text.rows=2;text.maxLength=240;text.placeholder='Your text';text.setAttribute('aria-label','Text on media');
      const font=element('select');font.setAttribute('aria-label','Text font');for(const [name] of CREATOR_FONTS)font.append(element('option','',name));
      const size=element('input');size.type='range';size.min='12';size.max='80';size.value='28';size.setAttribute('aria-label','Text size');
      const color=element('input');color.type='color';color.value='#ffffff';color.setAttribute('aria-label','Text color');
      const cardColor=element('input');cardColor.type='color';cardColor.value='#151515';cardColor.setAttribute('aria-label','Text card color');
      const bold=button('Bold',()=>{if(activeText){activeText.bold=!activeText.bold;bold.setAttribute('aria-pressed',String(activeText.bold));redraw();}});
      const card=button('Text card',()=>{if(activeText){activeText.card=!activeText.card;card.setAttribute('aria-pressed',String(activeText.card));redraw();}});
      text.addEventListener('input',()=>{if(activeText)activeText.text=text.value;redraw();});
      font.addEventListener('change',async()=>{if(!activeText)return;const current=activeText;try{await loadFont(font.value);current.font=font.value;redraw();}catch{status.textContent='Font could not load. Try again.';}});
      size.addEventListener('input',()=>{if(activeText)activeText.size=Number(size.value);redraw();});
      color.addEventListener('input',()=>{if(activeText)activeText.color=color.value;redraw();});
      cardColor.addEventListener('input',()=>{if(activeText)activeText.cardColor=cardColor.value;redraw();});
      const addText=button('＋ Text',async()=>{
        if(state.layers.length>=10){status.textContent='Up to 10 text layers.';return;}
        try{await loadFont('Poppins');}catch{status.textContent='Font could not load. Try again.';return;}
        activeText={text:'',font:'Poppins',size:28,bold:false,card:false,color:'#ffffff',cardColor:'#151515',x:.5,y:.5};state.layers.push(activeText);
        text.value='';font.value='Poppins';size.value='28';bold.setAttribute('aria-pressed','false');card.setAttribute('aria-pressed','false');textPanel.hidden=false;text.focus();
      });
      textPanel.append(text,font,bold,card,color,cardColor,size,button('Remove text',()=>{state.layers=state.layers.filter(layer=>layer!==activeText);activeText=null;textPanel.hidden=true;redraw();}));
      tools.append(ratio,addText,filters,textPanel);
      canvas.addEventListener('pointerdown',event=>{if(!activeText)return;drag=true;canvas.setPointerCapture(event.pointerId);});
      canvas.addEventListener('pointermove',event=>{if(!drag||!activeText)return;const rect=canvas.getBoundingClientRect();activeText.x=Math.max(.02,Math.min(.98,(event.clientX-rect.left)/rect.width));activeText.y=Math.max(.02,Math.min(.98,(event.clientY-rect.top)/rect.height));redraw();});
      canvas.addEventListener('pointerup',()=>drag=false);canvas.addEventListener('pointercancel',()=>drag=false);
      const preview = element('section','creator-preview-stage');preview.append(canvas);
      if(videoFile){
        const wave=element('div');const track={id:'video',title:'Video',artist:'',durationMs:duration,license:{windowStartMs:0,windowEndMs:duration,maxClipMs:180000}};
        timeline=createAudioWaveform(wave,{track,initial:state,onScrub:()=>media.pause(),onChange:clip=>{state.startMs=clip.startMs;state.durationMs=clip.durationMs;media.currentTime=clip.startMs/1000;redraw();}});
        const play=button('Play clip',()=>{if(media.paused){media.currentTime=state.startMs/1000;void media.play().catch(()=>{status.textContent='Tap play to preview this video.';});}else media.pause();});
        media.addEventListener('timeupdate',()=>{if(media.currentTime*1000>=state.startMs+state.durationMs){media.pause();media.currentTime=state.startMs/1000;}});
        media.addEventListener('play',()=>{cancelAnimationFrame(previewFrame);const draw=()=>{redraw();if(!media.paused)previewFrame=requestAnimationFrame(draw);};draw();});media.addEventListener('pause',()=>cancelAnimationFrame(previewFrame));media.addEventListener('seeked',redraw);
        tools.prepend(play);tools.append(wave);
      }
      const footer=element('footer');const apply=button('Use '+(videoFile?'video':'photo'),async()=>{
        if(busy)return;busy=true;apply.disabled=true;media.pause?.();status.textContent='Preparing…';
        try{
          for(const layer of state.layers)if(layer.text)await loadFont(layer.font);
          if(!state.layers.some(layer=>layer.text.trim())&&state.filter==='Original'&&!state.ratio&&(!videoFile||state.startMs===0&&state.durationMs===duration)){finish(file);return;}
          let result;
          if(videoFile)result=await exportVideo(file,state,progress=>status.textContent=`Exporting video… ${Math.round(progress*100)}%`,aborter.signal);
          else{drawCreatorFrame(canvas,media,state);const blob=await new Promise(done=>canvas.toBlob(done,'image/jpeg',.92));if(!blob)throw new Error('This photo could not be exported.');result=new File([blob],file.name.replace(/\.[^.]+$/,'')+'-edited.jpg',{type:'image/jpeg',lastModified:Date.now()});}
          finish(result);
        }catch(error){if(!closed)status.textContent=error.message;busy=false;apply.disabled=false;}
      },'creator-use');
      footer.append(button('Use original',()=>{if(videoFile&&duration>180000){status.textContent='Choose a clip up to 3 minutes first.';return;}finish(file);}),apply);
      dialog.append(header,preview,tools,status,footer);document.body.append(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});dialog.showModal();redraw();
    });
  } finally { media.pause?.();media.removeAttribute('src');videoFile&&media.load();URL.revokeObjectURL(url); }
}
