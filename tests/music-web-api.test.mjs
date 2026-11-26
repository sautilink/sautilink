import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMusicWebRequest } from '../src/music-web-api.js';
test('web music forwards only approved public reads, ranges and licensed feed parameters', async () => {
  let sent;
  const req = new Request('https://sautilink.com/api/music/tracks/track/preview?startMs=12345&durationMs=10000&territory=US&placement=stories',
    { headers: { Authorization:'Bearer private-member-token', Cookie:'session=private', Range:'bytes=0-1023' } });
  const response = await handleMusicWebRequest(req, { SAUTILINK_MUSIC: { async fetch(value) { sent=value; return new Response('audio', { status:206, headers:{'Content-Type':'audio/wav','Content-Range':'bytes 0-4/5','Set-Cookie':'bad=1'} }); } } });
  const url = new URL(sent.url);
  assert.equal(url.origin,'https://music.sautilink.com'); assert.equal(url.pathname,'/v1/tracks/track/preview');
  assert.equal(url.searchParams.get('startMs'),'12345'); assert.equal(url.searchParams.get('placement'),'feed');
  assert.equal(url.searchParams.has('territory'),false); assert.equal(sent.headers.has('Authorization'),false); assert.equal(sent.headers.has('Cookie'),false);
  assert.equal(sent.headers.get('Range'),'bytes=0-1023'); assert.equal(response.status,206); assert.equal(response.headers.has('Set-Cookie'),false);
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
});
test('web music does not proxy private routes, writes, redirects or arbitrary origins', async () => {
  const env={SAUTILINK_MUSIC:{fetch(){throw Error('must not fetch')}}};
  for(const path of ['private','tracks/track/audio','tracks/track/cover/extra']) assert.equal((await handleMusicWebRequest(new Request('https://sautilink.com/api/music/'+path),env)).status,404);
  assert.equal((await handleMusicWebRequest(new Request('https://sautilink.com/api/music/tracks',{method:'POST'}),env)).status,405);
  assert.equal((await handleMusicWebRequest(new Request('https://sautilink.com/api/music/tracks'),{})).status,503);
  assert.equal(await handleMusicWebRequest(new Request('https://sautilink.com/api/other'),env),null);
  env.SAUTILINK_MUSIC.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://other.example'}});
  assert.equal((await handleMusicWebRequest(new Request('https://sautilink.com/api/music/tracks'),env)).status,502);
});
