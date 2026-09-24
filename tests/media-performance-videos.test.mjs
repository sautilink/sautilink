import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleSautiMediaRequest } from '../src/sauti-media-api.js';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';

const MEDIA_ID = '123e4567-e89b-42d3-a456-426614174000';
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function videoRow() {
  return {
    id: MEDIA_ID,
    owner_id: '123e4567-e89b-42d3-a456-426614174111',
    post_id: '123e4567-e89b-42d3-a456-426614174222',
    object_key: `sauti/member/${MEDIA_ID}.mp4`,
    media_kind: 'video',
    content_type: 'video/mp4',
    size_bytes: 25_000_000,
    width: 1080,
    height: 1920,
    duration_ms: 30_000,
    alt_text: '',
    position: 0,
    upload_status: 'attached',
    expires_at: null,
    finalized_at: new Date().toISOString(),
  };
}

test('video media session uses a short-lived secure HttpOnly same-site cookie', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    assert.equal(init.headers.Authorization, 'Bearer header.token.value');
    return new Response(JSON.stringify({ id: videoRow().owner_id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const response = await handleSautiMediaRequest(new Request('https://sautilink.com/api/sauti-media/session', {
      method: 'POST',
      headers: { Authorization: 'Bearer header.token.value' },
    }), {});
    assert.equal(response.status, 204);
    const cookie = response.headers.get('Set-Cookie') || '';
    assert.match(cookie, /__Secure-sautilink-media-session=header\.token\.value/);
    assert.match(cookie, /Path=\/api\/sauti-media/);
    assert.match(cookie, /Max-Age=300/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('authenticated video delivery forwards byte ranges to R2 and returns HTTP 206', async () => {
  const previousFetch = globalThis.fetch;
  let r2Options = null;
  globalThis.fetch = async (_url, init = {}) => {
    assert.equal(init.headers.Authorization, 'Bearer cookie.token.value');
    return new Response(JSON.stringify([videoRow()]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const env = {
    SAUTI_MEDIA: {
      async get(_key, options) {
        r2Options = options;
        return {
          body: new Uint8Array(1024),
          size: 25_000_000,
          range: { offset: 0, length: 1024 },
          writeHttpMetadata(headers) {
            headers.set('Content-Type', 'video/mp4');
          },
        };
      },
    },
  };

  try {
    const response = await handleSautiMediaRequest(new Request(`https://sautilink.com/api/sauti-media/${MEDIA_ID}`, {
      headers: {
        Cookie: '__Secure-sautilink-media-session=cookie.token.value',
        Range: 'bytes=0-1023',
      },
    }), env);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-1023/25000000');
    assert.equal(response.headers.get('Content-Length'), '1024');
    assert.equal(response.headers.get('Cache-Control'), 'private, max-age=300, must-revalidate');
    assert.equal(r2Options.range.get('Range'), 'bytes=0-1023');
    assert.equal((await response.arrayBuffer()).byteLength, 1024);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('feed videos use protected range URLs while images keep responsive blobs', async () => {
  const appPath = new URL('../src/app.js', import.meta.url).pathname;
  const source = await read('src/app.js');
  const transformed = transformMediaPerformanceSource(appPath, transformPostMediaSource(appPath, source));

  for (const marker of [
    "fetch('/api/sauti-media/session'",
    "method: 'POST'",
    "credentials: 'same-origin'",
    'fetchSautiVideoStreamUrl(media.id)',
    "button.dataset.mediaStreaming = 'range'",
    "url.startsWith('blob:')",
    "item.mediaKind === 'video'",
    'await fetchSautiVideoStreamUrl(item.id)',
    'void clearSautiVideoSession()',
  ]) assert.ok(transformed.includes(marker), `missing transformed marker: ${marker}`);

  assert.match(transformed, /const url = streamingVideo[\s\S]*fetchSautiVideoStreamUrl\(media\.id\)[\s\S]*fetchSautiMediaBlobUrl\(media\.id, variantWidth\)/);
});
