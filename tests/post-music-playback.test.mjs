import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../src/post-music.js', import.meta.url), 'utf8');
const playback = source.slice(source.indexOf('function afterVideoFrame('), source.indexOf('function begin('));
function harness() {
  const frames = [];
  const video = { paused:false, seeking:false, readyState:3, currentTime:2.5, muted:false, playbackRate:1,
    requestVideoFrameCallback:callback=>frames.push(callback) };
  const record = { selection:{ durationMs:5000, musicVolume:.6, originalVolume:.2 } };
  const audio = { paused:true, duration:5, currentTime:0, plays:0, pause(){this.paused=true},
    play(){this.plays++;this.paused=false;return Promise.resolve()} };
  const context = { active:record, audio, sourceVideo:()=>video, allowed:()=>true, soundStarted(){}, needsGesture(){}, requestAnimationFrame:callback=>frames.push(callback) };
  runInNewContext(playback+'\nthis.start=()=>afterVideoFrame(active,()=>syncVideo(active,true));this.sync=()=>syncVideo(active);',context);
  return { context,record,audio,video,frames };
}
test('music stays silent until the selected video presents a frame, then uses its clock and mix', () => {
  const h=harness();h.context.start();h.context.sync();assert.equal(h.audio.plays,0);
  h.frames.shift()();assert.equal(h.audio.plays,1);assert.equal(h.audio.currentTime,2.5);
  assert.equal(h.audio.volume,.6);assert.equal(h.video.volume,.2);
  h.video.seeking=true;h.context.sync();assert.equal(h.audio.paused,true);
});
test('a stale video frame callback cannot restart music after a pause or a newer frame request', () => {
  const h=harness();h.context.start();const stale=h.frames.shift();h.context.start();stale();assert.equal(h.audio.plays,0);
  h.video.paused=true;h.frames.shift()();assert.equal(h.audio.plays,0);
  h.video.paused=false;h.context.start();h.frames.shift()();assert.equal(h.audio.plays,1);
});
