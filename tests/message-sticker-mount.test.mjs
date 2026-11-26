import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source=await readFile(new URL('../app/assets/sticker-engine.js',import.meta.url),'utf8');
const mount=source.slice(source.indexOf('function mountButton('),source.indexOf('function initButtons('));
function run(inputId) {
  let parent='';
  const form={querySelector:()=>null,append:()=>parent='composer'};
  const input={id:inputId},send={before:()=>parent='send-toolbar'};
  const context={installStickerDraftEditor(){},el:()=>({setAttribute(){},addEventListener(){}}),open(){}};
  runInNewContext(mount+';this.mountButton=mountButton;',context);
  context.mountButton(form,input,send);return parent;
}
test('Messages sticker control belongs to the input grid, outside the send toolbar',()=>{
  assert.equal(run('message-body'),'composer');
});
test('other composers retain their existing sticker action placement',()=>{
  assert.equal(run('conversation-reply-body'),'send-toolbar');
  assert.equal(run('circle-sauti-body'),'send-toolbar');
});
