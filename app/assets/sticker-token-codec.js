/**
 * SautiLink Sticker Engine v0.3 wire tokens.
 * Backward-compatible with existing DM/comments/Rooms text storage.
 * Unrecognized tokens remain plain text in older clients.
 *
 * Sticker: [[sl-sticker:slv-heart]]
 * Inline motion emoji: :slv-heart:
 */
const STICKER_ID=/^[a-z0-9-]{1,90}$/;
const INLINE_ID=/^slv-[a-z0-9-]{1,86}$/;
const TOKEN_PATTERN=/\[\[sl-sticker:([a-z0-9-]{1,90})\]\]|:(slv-[a-z0-9-]{1,86}):/g;

export function makeStickerToken(id, kind="sticker"){
 if(!STICKER_ID.test(id))throw new TypeError("Invalid sticker identifier");
 if(kind==="inline"){
  if(!INLINE_ID.test(id))throw new TypeError("Only approved motion emoji IDs can be inline");
  return ":"+id+":";
 }
 if(kind==="sticker")return "[[sl-sticker:"+id+"]]";
 throw new TypeError("Invalid sticker kind");
}

export function splitStickerTokens(text,{maxTokens=80}={}){
 const value=String(text??"");
 if(value.length>5000)return [{type:"text",value}];
 const parts=[];let cursor=0,count=0;
 for(const match of value.matchAll(TOKEN_PATTERN)){
  if(count>=maxTokens)break;
  if(match.index>cursor)parts.push({type:"text",value:value.slice(cursor,match.index)});
  parts.push({type:match[1]?"sticker":"inline",id:match[1]||match[2],raw:match[0]});
  cursor=match.index+match[0].length;count++;
 }
 if(cursor<value.length)parts.push({type:"text",value:value.slice(cursor)});
 return parts.length?parts:[{type:"text",value}];
}

export function stickerIds(text,{maxTokens=80}={}){
 return [...new Set(splitStickerTokens(text,{maxTokens}).filter(p=>p.id).map(p=>p.id))];
}

export function insertStickerToken(textarea,token){
 if(!textarea||textarea.disabled||textarea.readOnly||typeof textarea.value!=="string")return false;
 if(!/^(\[\[sl-sticker:[a-z0-9-]{1,90}\]\]|:slv-[a-z0-9-]{1,86}:)$/.test(token))return false;
 const value=textarea.value,start=Math.max(0,Math.min(value.length,Number(textarea.selectionStart??value.length))),
       end=Math.max(start,Math.min(value.length,Number(textarea.selectionEnd??start)));
 const lead=start>0&&!/\s/.test(value[start-1])?" ":"";
 const tail=end<value.length&&!/\s/.test(value[end])?" ":"";
 const insert=lead+token+tail;
 const maxlength=Number(textarea.maxLength??-1);
 if(maxlength>0&&value.length-(end-start)+insert.length>maxlength)return false;
 if(typeof textarea.setRangeText==="function")textarea.setRangeText(insert,start,end,"end");
 else textarea.value=value.slice(0,start)+insert+value.slice(end);
 return true;
}

export function trustedStickerAsset(sticker,base="https://stickers.sautilink.com"){
 if(!sticker||!STICKER_ID.test(String(sticker.id||"")))return null;
 let u;
 try{u=new URL(String(sticker.asset_url||""));}catch{return null;}
 if(u.origin!==new URL(base).origin || u.search || u.hash)return null;
 if(sticker.format==="lottie"&&new RegExp("^/assets/vector/"+sticker.id+"\\.json$").test(u.pathname))return u.href;
 if(sticker.format==="webp"&&/^\/assets\/[a-z0-9/_-]+\.webp$/.test(u.pathname))return u.href;
 if(sticker.format==="svg"&&new RegExp("^/assets/original/"+sticker.id+"\\.svg$").test(u.pathname))return u.href;
 return null;
}
