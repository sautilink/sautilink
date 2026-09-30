import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { handleSautiMediaRequest } from '../src/sauti-media-api.js';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';

const MEDIA_ID = '123e4567-e89b-42d3-a456-426614174000';
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('video media session renews while visible playback remains on the page', async () => {
  const appPath = new URL('../src/app.js', import.meta.url).pathname;
  const source = await read('src/app.js');
  const transformed = transformMediaPerformanceSource(appPath, transformPostMediaSource(appPath, source));
  const start = transformed.indexOf('const SAUTI_MEDIA_VARIANT_WIDTHS =');
  const end = transformed.indexOf('function selectSautiMediaVariantWidth(', start);
  assert.ok(start >= 0 && end > start);

  const timers = new Map();
  const listeners = new Map();
  let now = 0;
  let nextTimer = 1;
  let sessionPosts = 0;
  const document = {
    hidden: false,
    querySelector: () => ({}),
    addEventListener(name, listener) { listeners.set(name, listener); },
  };
  const window = {
    location: { origin: 'https://sautilink.com' },
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const context = vm.createContext({
    window, document, URL,
    Date: { now: () => now },
    currentAuthorizationHeader: async () => ({ Authorization: 'Bearer test.token.value' }),
    fetch: async (_url, options) => {
      if (options.method === 'POST') sessionPosts++;
      return new Response(null, { status: 204 });
    },
  });
  vm.runInContext(transformed.slice(start, end), context);
  const fireNextTimer = () => {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
  };

  await window.SautiLinkVideoMediaSession.ensure();
  assert.equal(sessionPosts, 1);
  now += 4 * 60 * 1000;
  fireNextTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sessionPosts, 2);

  document.hidden = true;
  now += 4 * 60 * 1000;
  fireNextTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sessionPosts, 2);
  document.hidden = false;
  listeners.get('visibilitychange')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sessionPosts, 3);

  await vm.runInContext('clearSautiVideoSession()', context);
  assert.equal(timers.size, 0);
});

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

test('requested video quality is transformed once, stored in R2, and served as MP4', async () => {
  const previousFetch = globalThis.fetch;
  const row = videoRow();
  const objects = new Map([[row.object_key, new Uint8Array([1, 2, 3, 4])]]);
  let transformOptions = null;
  let variantKey = '';
  globalThis.fetch = async () => new Response(JSON.stringify([row]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const objectFor = (key) => {
    const body = objects.get(key);
    if (!body) return null;
    return {
      body,
      size: body.byteLength,
      etag: 'source-etag',
      writeHttpMetadata(headers) {
        headers.set('Content-Type', 'video/mp4');
      },
    };
  };
  const env = {
    SAUTI_MEDIA: {
      async head(key) { return objectFor(key); },
      async get(key) { return objectFor(key); },
      async put(key, body) {
        variantKey = key;
        objects.set(key, body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()));
      },
    },
    MEDIA: {
      input() {
        return {
          transform(options) {
            transformOptions = options;
            return {
              output(options) {
                assert.deepEqual(options, { mode: 'video', audio: true });
                return { async media() { return new Uint8Array([9, 8, 7]); } };
              },
            };
          },
        };
      },
    },
  };

  try {
    const response = await handleSautiMediaRequest(new Request(
      `https://sautilink.com/api/sauti-media/${MEDIA_ID}?quality=360`,
      { headers: { Cookie: '__Secure-sautilink-media-session=cookie.token.value' } },
    ), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Sauti-Video-Quality'), '360p');
    assert.match(response.headers.get('X-Sauti-Media-Variant') || '', /q=360/);
    assert.deepEqual(transformOptions, { width: 360, height: 640, fit: 'scale-down' });
    assert.equal(variantKey, `${row.object_key}.video-v1-q360.mp4`);
    assert.equal((await response.arrayBuffer()).byteLength, 3);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Auto playback serves a cold original range without waiting for a video transcode', async () => {
  const previousFetch = globalThis.fetch;
  const row = videoRow();
  let finishVariant;
  const variantReady = new Promise((resolve) => { finishVariant = resolve; });
  const objects = new Map([[row.object_key, new Uint8Array([1, 2, 3, 4])]]);
  const background = [];
  globalThis.fetch = async () => new Response(JSON.stringify([row]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const env = {
    SAUTI_MEDIA: {
      async head(key) { return objects.has(key) ? { size: objects.get(key).byteLength } : null; },
      async get(key) {
        const body = objects.get(key);
        return body ? {
          body,
          size: body.byteLength,
          range: { offset: 0, length: body.byteLength },
          writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); },
        } : null;
      },
      async put(key, body) { objects.set(key, body); },
    },
    MEDIA: {
      input() { return {
        transform() { return {
          output() { return { media: () => variantReady }; },
        }; },
      }; },
    },
  };
  const ctx = { waitUntil(promise) { background.push(promise); } };

  try {
    const response = await handleSautiMediaRequest(new Request(
      `https://sautilink.com/api/sauti-media/${MEDIA_ID}?quality=360&startup=1`, {
        headers: {
          Cookie: '__Secure-sautilink-media-session=cookie.token.value',
          Range: 'bytes=0-3',
        },
      },
    ), env, ctx);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'original');
    assert.equal(background.length, 1);
    assert.equal((await response.arrayBuffer()).byteLength, 4);
    finishVariant(new Uint8Array([9, 8]));
    await Promise.all(background);
    const warmed = await handleSautiMediaRequest(new Request(
      `https://sautilink.com/api/sauti-media/${MEDIA_ID}?quality=360&startup=1`, {
        headers: { Cookie: '__Secure-sautilink-media-session=cookie.token.value' },
      },
    ), env, ctx);
    assert.equal(warmed.headers.get('X-Sauti-Video-Quality'), '360p');
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
    "fetchSautiVideoStreamUrl(media.id, videoQuality, window.SautiLinkVideoQuality?.getPreference?.() === 'auto')",
    "qualityFor?.({ context: 'home' })",
    "button.dataset.mediaStreaming = 'range'",
    "url.startsWith('blob:')",
    "item.mediaKind === 'video'",
    "await fetchSautiVideoStreamUrl(item.id, 'original')",
    'void clearSautiVideoSession()',
  ]) assert.ok(transformed.includes(marker), `missing transformed marker: ${marker}`);

  assert.match(transformed, /const url = streamingVideo[\s\S]*fetchSautiVideoStreamUrl\(media\.id, videoQuality,[\s\S]*fetchSautiMediaBlobUrl\(media\.id, variantWidth\)/);
});
