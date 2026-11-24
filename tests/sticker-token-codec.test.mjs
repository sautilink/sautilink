import test from 'node:test';
import assert from 'node:assert/strict';
import {makeStickerToken,splitStickerTokens,stickerIds,insertStickerToken,trustedStickerAsset} from '../app/assets/sticker-token-codec.js';

test('backward-compatible plain text plus sticker and inline emoji',()=>{
 const parts=splitStickerTokens('Hey :slv-wave: ! [[sl-sticker:slv-heart]]');
 assert.deepEqual(parts.map(p=>p.type),['text','inline','text','sticker']);
 assert.deepEqual(stickerIds('a :slv-wave: :slv-wave: [[sl-sticker:noto-1f600]]'),['slv-wave','noto-1f600']);
});
test('ignore malicious and unsupported token syntax',()=>{
 assert.deepEqual(stickerIds('[[sl-sticker:../../secrets]] :evil: <svg onload=evil()>'),[]);
 assert.throws(()=>makeStickerToken('bad/id'));
 assert.throws(()=>makeStickerToken('noto-1f600','inline'));
 assert.equal(makeStickerToken('slv-heart','inline'),':slv-heart:');
 assert.equal(makeStickerToken('slv-heart'),'[[sl-sticker:slv-heart]]');
 assert.deepEqual(splitStickerTokens(''),[{type:'text',value:''}]);
});
test('bounded parsing keeps remainder literal',()=>{
 const sample=Array(120).fill(':slv-heart:').join(' ');
 const parts=splitStickerTokens(sample,{maxTokens:5});
 assert.equal(parts.filter(x=>x.type==='inline').length,5);
 assert.ok(parts.at(-1).value.includes(':slv-heart:'));
});
test('insert respects draft, selection, max length and read-only',()=>{
 const input={value:'Hey there',selectionStart:4,selectionEnd:9,maxLength:50,disabled:false,readOnly:false,
  setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);}};
 assert.equal(insertStickerToken(input,':slv-wave:'),true);
 assert.equal(input.value,'Hey :slv-wave:');
 input.maxLength=5;
 assert.equal(insertStickerToken(input,':slv-heart:'),false);
 assert.equal(insertStickerToken({...input,disabled:true},':slv-wave:'),false);
});
test('only official sticker asset origin and vetted formats',()=>{
 assert.equal(trustedStickerAsset({id:'slv-heart',format:'lottie',asset_url:'https://stickers.sautilink.com/assets/vector/slv-heart.json'}),
  'https://stickers.sautilink.com/assets/vector/slv-heart.json');
 assert.equal(trustedStickerAsset({id:'slv-heart',format:'lottie',asset_url:'https://attacker.tld/assets/vector/slv-heart.json'}),null);
 assert.equal(trustedStickerAsset({id:'slv-heart',format:'lottie',asset_url:'https://stickers.sautilink.com/assets/vector/other.json'}),null);
 assert.equal(trustedStickerAsset({id:'slv-heart',format:'lottie',asset_url:'https://stickers.sautilink.com/assets/vector/slv-heart.json?x=y'}),null);
});
