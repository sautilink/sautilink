import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { stickerPreviewText } from '../src/sticker-preview.js';
test('inbox previews show friendly sticker labels while preserving ordinary text', () => {
  assert.equal(stickerPreviewText(':slv-heart:'),'Animated emoji');
  assert.equal(stickerPreviewText('Hello [[sl-sticker:sl-happy]]'),'Hello Sticker');
  assert.equal(stickerPreviewText('Meet at 10:30'),'Meet at 10:30');
  assert.equal(stickerPreviewText('[[sl-sticker:../bad]]'),'[[sl-sticker:../bad]]');
});
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const render=source.slice(source.indexOf('function renderGlobalDmPeerActivity()'),source.indexOf('window.__sautilinkRenderDmPeerActivity'));
test('privacy mode is shown even when a private presence channel cannot be joined',()=>{
  for(const ownEnabled of [true,false]) {
    const activity={dataset:{},hidden:true,textContent:''};
    const context={activeConversation:{peerId:'peer'},globalDmPresenceActive:()=>false,activityStatusEnabled:()=>ownEnabled,
      dmPeerVisibility:ownEnabled?'hidden':'unknown',byId:id=>id==='message-thread-activity'?activity:{hidden:false},dmPeerActivityOnline:true};
    runInNewContext(render+';this.renderGlobalDmPeerActivity=renderGlobalDmPeerActivity;',context);
    assert.equal(context.renderGlobalDmPeerActivity(),true);assert.equal(activity.textContent,'🔒 Privacy Mode');assert.equal(activity.hidden,false);
  }
});
