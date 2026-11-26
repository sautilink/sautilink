import test from 'node:test';
import assert from 'node:assert/strict';
import { formatEngagementCount, clampAudioClip, audioClipUrl, isNewMusicRelease } from '../src/social-presentation.js';
import { creatorCrop, CREATOR_FILTERS, CREATOR_FONTS } from '../src/creator-media-editor.js';
import { insertCommentEmoji } from '../src/comment-emojis.js';

test('engagement suppresses zero and consistently abbreviates positive totals', () => {
  for (const [input, expected] of [[0,''],[-5,''],[1,'1'],[999,'999'],[1000,'1k'],[1100,'1.1k'],[1200,'1.2k'],[10000,'10k'],[1200000,'1.2m']])
    assert.equal(formatEngagementCount(input), expected);
});
const track = {id:'test-track',title:'Track',artist:'Artist',durationMs:240000,license:{windowStartMs:20000,windowEndMs:200000,maxClipMs:60000}};
test('clip movement retains duration and stays wholly inside its licensed window', () => {
  const clip = clampAudioClip(track,199000,30000); assert.equal(clip.startMs,170000); assert.equal(clip.durationMs,30000);
  assert.equal(clampAudioClip(track,-100,400000).durationMs,60000);
  assert.equal(clampAudioClip(track,-100,400000).startMs,20000);
  assert.throws(() => clampAudioClip({...track,license:{...track.license,windowEndMs:20005}},0,1000));
});
test('preview URL preserves the selected exact milliseconds and rejects untrusted identifiers', () => {
  const selected=clampAudioClip(track,35000,12000);
  assert.equal(audioClipUrl(selected),'/api/music/tracks/test-track/preview?placement=feed&startMs=35000&durationMs=12000');
  for(const unsafe of [{...selected,trackId:'../admin'},{...selected,startMs:-1},{...selected,durationMs:180001}])assert.equal(audioClipUrl(unsafe),'');
});
test('New badge means released less than seven days ago, excluding future dates', () => {
  const now=Date.parse('2026-11-26T00:00:00Z');
  assert.equal(isNewMusicRelease('2026-11-20',now),true); assert.equal(isNewMusicRelease('2026-11-19',now),false);
  assert.equal(isNewMusicRelease('2026-11-27',now),false); assert.equal(isNewMusicRelease(null,now),false);
});
test('crop is centered, bounded and preserves the chosen aspect without upscaling', () => {
  assert.deepEqual(creatorCrop(2000,1000,1),{sx:500,sy:0,sw:1000,sh:1000,width:1000,height:1000});
  const portrait=creatorCrop(4000,3000,9/16); assert.ok(Math.abs(portrait.width/portrait.height-9/16)<.002);
  assert.ok(portrait.width<=1920&&portrait.height<=1920);assert.equal(creatorCrop(200,100).width,200);
});
test('editor ships fifteen distinct fonts and eighteen distinct filters', () => {
  assert.equal(new Set(CREATOR_FONTS.map(row=>row[0])).size,15);
  assert.equal(new Set(CREATOR_FILTERS.map(row=>row[0])).size,18);
});
test('quick emoji replaces the active selection and respects the comment limit', () => {
  const input={value:'Hello',selectionStart:1,selectionEnd:4,maxLength:10,dispatchEvent(){},focus(){},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}};
  assert.equal(insertCommentEmoji(input,'❤️'),true);assert.equal(input.value,'H❤️o');
  input.maxLength=4;assert.equal(insertCommentEmoji(input,'😂'),false);assert.equal(input.value,'H❤️o');
});
