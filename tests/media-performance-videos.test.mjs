import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { handleSautiMediaRequest, sautiMediaObjectKeys, sautiVideoPosterObjectKey } from '../src/sauti-media-api.js';
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

test('a stalled Home stream switches to an authorized blob and keeps the viewer URL usable', async () => {
  const appPath = new URL('../src/app.js', import.meta.url).pathname;
  const source = await read('src/app.js');
  const transformed = transformMediaPerformanceSource(appPath, transformPostMediaSource(appPath, source));
  const start = transformed.indexOf('function enableSautiVideoBlobFallback(');
  const end = transformed.indexOf('function revokeHomeFeedMediaObjectUrls(', start);
  assert.ok(start >= 0 && end > start);

  let callback;
  let loaded;
  const events = [];
  const video = {
    src: `https://sautilink.com/api/sauti-media/${MEDIA_ID}?quality=360`,
    isConnected: true,
    readyState: 0,
    dataset: {},
    addEventListener(name, listener) { if (name === 'loadedmetadata') loaded = listener; },
    load() {},
    dispatchEvent(event) { events.push(event.type); },
  };
  const button = { dataset: {} };
  const context = vm.createContext({
    window: { setTimeout(fn) { callback = fn; return 1; }, clearTimeout() {} },
    URL: { revokeObjectURL() {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
    getVideoAutoplayPreference: () => true,
    syncHomeFeedVideoPlayback() {},
    fetchSautiMediaBlobUrl: async () => 'blob:working-video',
  });
  vm.runInContext(transformed.slice(start, end), context);
  vm.runInContext('enableSautiVideoBlobFallback', context)(video, button, MEDIA_ID);
  assert.equal(typeof loaded, 'function');
  await callback();
  assert.equal(video.src, 'blob:working-video');
  assert.equal(button.dataset.mediaObjectUrl, 'blob:working-video');
  assert.equal(button.dataset.mediaStreaming, 'blob-fallback');
  assert.equal(video.dataset.sautiBlobFallback, 'true');
  assert.deepEqual(events, ['sautilink:video-blob-fallback']);
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

test('protected video poster is generated once, cached in R2, and never serves video bytes', async () => {
  const previousFetch = globalThis.fetch;
  const row = videoRow();
  const posterKey = sautiVideoPosterObjectKey(row.object_key);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const objects = new Map([[row.object_key, new Uint8Array([1, 2, 3, 4])]]);
  let transformCount = 0;
  let rowVisible = true;
  globalThis.fetch = async () => Response.json(rowVisible ? [row] : []);
  const env = {
    SAUTI_MEDIA: {
      async head(key) {
        const body = objects.get(key);
        return body ? { size: body.byteLength } : null;
      },
      async get(key) {
        const body = objects.get(key);
        return body ? { body, size: body.byteLength, etag: 'source-etag' } : null;
      },
      async put(key, body, options) {
        assert.equal(key, posterKey);
        assert.equal(options.httpMetadata.contentType, 'image/jpeg');
        objects.set(key, new Uint8Array(body));
      },
    },
    MEDIA: {
      input() {
        transformCount++;
        return {
          transform(options) {
            assert.deepEqual(options, { width: 640, fit: 'scale-down' });
            return { output(options) {
              assert.deepEqual(options, { mode: 'frame', time: '1s', format: 'jpg' });
              return { async media() { return jpeg; } };
            } };
          },
        };
      },
    },
  };
  const request = () => new Request(`https://sautilink.com/api/sauti-media/${MEDIA_ID}?poster=1`, {
    headers: { Authorization: 'Bearer viewer.token.value' },
  });
  try {
    const first = await handleSautiMediaRequest(request(), env);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('Content-Type'), 'image/jpeg');
    assert.match(first.headers.get('Cache-Control'), /^private/);
    assert.deepEqual(new Uint8Array(await first.arrayBuffer()), jpeg);
    const second = await handleSautiMediaRequest(request(), env);
    assert.equal(second.status, 200);
    assert.deepEqual(new Uint8Array(await second.arrayBuffer()), jpeg);
    assert.equal(transformCount, 1);
    assert.ok(sautiMediaObjectKeys(row).includes(posterKey));

    rowVisible = false;
    const denied = await handleSautiMediaRequest(request(), env);
    assert.equal(denied.status, 404);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

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
    assert.deepEqual(r2Options.range, { offset: 0, length: 1024 });
    assert.equal((await response.arrayBuffer()).byteLength, 1024);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('open-ended video ranges are capped to avoid buffering an entire source file', async () => {
  const previousFetch = globalThis.fetch;
  let r2Options = null;
  globalThis.fetch = async () => Response.json([videoRow()]);
  const env = {
    SAUTI_MEDIA: {
      async get(_key, options) {
        r2Options = options;
        const { offset, length } = options.range;
        return {
          body: new Uint8Array(length),
          size: 25_000_000,
          range: { offset, length },
          writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); },
        };
      },
    },
  };

  try {
    const response = await handleSautiMediaRequest(new Request(`https://sautilink.com/api/sauti-media/${MEDIA_ID}`, {
      headers: {
        Cookie: '__Secure-sautilink-media-session=cookie.token.value',
        Range: 'bytes=0-',
      },
    }), env);
    assert.equal(response.status, 206);
    assert.deepEqual(r2Options.range, { offset: 0, length: 1024 * 1024 });
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-1048575/25000000');
    assert.equal(response.headers.get('Content-Length'), '1048576');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a brief video range access cache is scoped to the token and never stores denials', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  const entries = new Map();
  const keys = [];
  let accessChecks = 0;
  globalThis.caches = { default: {
    async match(key) { return entries.get(key.url)?.clone() || null; },
    async put(key, response) {
      keys.push(key.url);
      assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3');
      entries.set(key.url, response.clone());
    },
  } };
  globalThis.fetch = async (_url, init) => {
    accessChecks++;
    const allowed = init.headers.Authorization === 'Bearer allowed.token.value';
    return Response.json(allowed ? [videoRow()] : []);
  };
  const env = { SAUTI_MEDIA: {
    async get() { return {
      body: new Uint8Array([1, 2]), size: 2,
      writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); },
    }; },
  } };
  const request = (token) => new Request(`https://sautilink.com/api/sauti-media/${MEDIA_ID}`, {
    headers: { Cookie: `__Secure-sautilink-media-session=${token}` },
  });

  try {
    assert.equal((await handleSautiMediaRequest(request('allowed.token.value'), env)).status, 200);
    assert.equal((await handleSautiMediaRequest(request('allowed.token.value'), env)).status, 200);
    assert.equal(accessChecks, 1);
    assert.equal((await handleSautiMediaRequest(request('denied.token.value'), env)).status, 404);
    assert.equal((await handleSautiMediaRequest(request('denied.token.value'), env)).status, 404);
    assert.equal(accessChecks, 3);
    assert.equal(keys.length, 1);
    assert.ok(!keys[0].includes('allowed.token.value'));
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.caches = previousCaches;
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
        assert.ok(body instanceof ArrayBuffer, 'R2 requires a known-length rendition body');
        objects.set(key, new Uint8Array(body));
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
                return { async media() {
                  return new ReadableStream({
                    start(controller) {
                      controller.enqueue(new Uint8Array([9, 8, 7]));
                      controller.close();
                    },
                  });
                } };
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
    assert.equal(variantKey, `${row.object_key}.video-v2-q360.mp4`);
    assert.equal((await response.arrayBuffer()).byteLength, 3);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('videos longer than the transform output limit keep their full original duration', async () => {
  const previousFetch = globalThis.fetch;
  const row = { ...videoRow(), duration_ms: 90_000 };
  let transformed = false;
  globalThis.fetch = async () => Response.json([row]);
  const env = {
    SAUTI_MEDIA: {
      async head() { return { size: 3 }; },
      async get() { return {
        body: new Uint8Array([1, 2, 3]), size: 3,
        writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); },
      }; },
    },
    MEDIA: { input() { transformed = true; throw new Error('unexpected transform'); } },
  };
  try {
    const response = await handleSautiMediaRequest(new Request(
      `https://sautilink.com/api/sauti-media/${MEDIA_ID}?quality=360`,
      { headers: { Cookie: '__Secure-sautilink-media-session=allowed.token.value' } },
    ), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'original');
    assert.equal(transformed, false);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a low resolution original is never served as a misleading 720p variant', async () => {
  const previousFetch = globalThis.fetch;
  const row = { ...videoRow(), width: 240, height: 426 };
  let transformed = false;
  globalThis.fetch = async () => Response.json([row]);
  const env = {
    SAUTI_MEDIA: {
      async head() { return { size: 3 }; },
      async get() { return {
        body: new Uint8Array([1, 2, 3]), size: 3,
        writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); },
      }; },
    },
    MEDIA: { input() { transformed = true; throw new Error('unexpected transform'); } },
  };
  try {
    const response = await handleSautiMediaRequest(new Request(
      `https://sautilink.com/api/sauti-media/${MEDIA_ID}?quality=720`,
      { headers: { Cookie: '__Secure-sautilink-media-session=low.token.value' } },
    ), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'original');
    assert.equal(response.headers.get('X-Sauti-Video-Quality'), null);
    assert.equal(transformed, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a cold quality request without a background context can generate the smaller rendition', async () => {
  const previousFetch = globalThis.fetch;
  const row = videoRow();
  const objects = new Map([[row.object_key, new Uint8Array([1, 2, 3, 4])]]);
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
          output() { return { media: async () => new Uint8Array([9, 8]) }; },
        }; },
      }; },
    },
  };
  try {
    const response = await handleSautiMediaRequest(new Request(
      `https://sautilink.com/api/sauti-media/${MEDIA_ID}?quality=360&startup=1`, {
        headers: {
          Cookie: '__Secure-sautilink-media-session=cookie.token.value',
          Range: 'bytes=0-3',
        },
      },
    ), env);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('X-Sauti-Video-Quality'), '360p');
    assert.equal((await response.arrayBuffer()).byteLength, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('production serves original range promptly while a cold rendition warms in the background', async () => {
  const previousFetch = globalThis.fetch;
  const row = videoRow();
  const original = new Uint8Array([1, 2, 3, 4]);
  let releaseTransform;
  const transformPending = new Promise((resolve) => { releaseTransform = resolve; });
  let backgroundJob;
  globalThis.fetch = async () => Response.json([row]);
  const env = {
    SAUTI_MEDIA: {
      async head(key) { return key === row.object_key ? { size: original.byteLength } : null; },
      async get() { return {
        body: original,
        size: original.byteLength,
        range: { offset: 0, length: original.byteLength },
        writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); },
      }; },
      async put() {},
    },
    MEDIA: { input() { return {
      transform() { return { output() { return { media: () => transformPending }; } }; },
    }; } },
  };

  try {
    const response = await handleSautiMediaRequest(new Request(
      `https://sautilink.com/api/sauti-media/${MEDIA_ID}?quality=360`, {
        headers: { Cookie: '__Secure-sautilink-media-session=cookie.token.value', Range: 'bytes=0-3' },
      },
    ), env, { waitUntil(job) { backgroundJob = job; } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'original');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), original);
    assert.ok(backgroundJob);
  } finally {
    releaseTransform(new Uint8Array([9, 8]));
    await backgroundJob;
    globalThis.fetch = previousFetch;
  }
});

test('a failed video transform falls back to Original without a false quality label', async () => {
  const previousFetch = globalThis.fetch;
  const previousWarn = console.warn;
  const row = videoRow();
  globalThis.fetch = async () => Response.json([row]);
  let warning;
  console.warn = (_message, details) => { warning = details; };
  const env = {
    SAUTI_MEDIA: {
      async head() { return null; },
      async get() { return {
        body: new Uint8Array([1, 2, 3]),
        size: 3,
        writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); },
      }; },
    },
    MEDIA: {
      input() {
        const error = new Error('Unsupported source video');
        error.code = 9402;
        throw error;
      },
    },
  };

  try {
    const response = await handleSautiMediaRequest(new Request(
      `https://sautilink.com/api/sauti-media/${MEDIA_ID}?quality=360`,
      { headers: { Cookie: '__Secure-sautilink-media-session=cookie.token.value' } },
    ), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Sauti-Video-Quality'), null);
    assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'original');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.equal(warning.code, '9402');
  } finally {
    globalThis.fetch = previousFetch;
    console.warn = previousWarn;
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
    "fetchSautiVideoStreamUrl(media.id, videoQuality)",
    "qualityFor?.({ context: 'home', mediaId: media.id })",
    "button.dataset.mediaStreaming = 'range'",
    "url.startsWith('blob:')",
    "item.mediaKind === 'video'",
    "await fetchSautiVideoStreamUrl(item.id, 'original')",
    'loadSautiVideoPoster(media.id, button)',
    "visual.poster = button.dataset.mediaPosterObjectUrl",
    "[data-media-object-url], [data-media-poster-object-url]",
    'void clearSautiVideoSession()',
  ]) assert.ok(transformed.includes(marker), `missing transformed marker: ${marker}`);

  assert.match(transformed, /const url = streamingVideo[\s\S]*fetchSautiVideoStreamUrl\(media\.id, videoQuality\)[\s\S]*fetchSautiMediaBlobUrl\(media\.id, variantWidth\)/);
  assert.match(transformed, /SautiLinkVideoQuality\?\.sourceUrl\?\.\(id, quality\)/);
});


test('signed-out visitors can load a video poster but cannot stream the raw video', async () => {
  const previousFetch = globalThis.fetch;
  const row = videoRow();
  const posterKey = sautiVideoPosterObjectKey(row.object_key);
  const original = new Uint8Array([1, 2, 3, 4]);
  const poster = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  let originalReads = 0;

  globalThis.fetch = async () => Response.json([row]);
  const env = {
    SAUTI_MEDIA: {
      async head(key) {
        if (key === posterKey) return { size: poster.byteLength };
        if (key === row.object_key) return { size: original.byteLength };
        return null;
      },
      async get(key) {
        if (key === row.object_key) {
          originalReads += 1;
          return {
            body: original,
            size: original.byteLength,
            writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); },
          };
        }
        if (key === posterKey) {
          return {
            body: poster,
            size: poster.byteLength,
            writeHttpMetadata(headers) { headers.set('Content-Type', 'image/jpeg'); },
          };
        }
        return null;
      },
    },
  };

  try {
    const denied = await handleSautiMediaRequest(
      new Request(`https://sautilink.com/api/sauti-media/${MEDIA_ID}`),
      env,
    );
    assert.equal(denied.status, 401);
    assert.match(await denied.text(), /AUTH_REQUIRED/);
    assert.equal(originalReads, 0);

    const preview = await handleSautiMediaRequest(
      new Request(`https://sautilink.com/api/sauti-media/${MEDIA_ID}?poster=1`),
      env,
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('Content-Type'), 'image/jpeg');
    assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), poster);
    assert.equal(originalReads, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
