import assert from 'node:assert/strict';
import test from 'node:test';
import { sautiStreamBootstrap } from '../src/sauti-stream-bootstrap.js';
import { sautiStreamPlaybackDescriptor } from '../src/sauti-stream-playback.js';

const ID = '11111111-1111-4111-8111-111111111111';
const asset = { kind: 'post', id: ID, generation: '22222222-2222-4222-8222-222222222222', stream_uid: 'a'.repeat(32) };
const origin = 'https://sautilink.com';
const provider = 'https://customer-example.cloudflarestream.com';
const options = { basePath: `/api/sauti-media/${ID}/hls/`, accessScope: 'Bearer authenticated-test-session' };
const token = 'provider.private.signature';

async function fixture(run, { children = 2, childSize = 0, fail = false, unsafe = false, stall = false, key = false } = {}) {
  const previous = globalThis.fetch;
  const calls = []; let aborts = 0;
  const env = { SAUTI_STREAM_ORIGIN: provider, SAUTI_STREAM_SOURCE_KEY: 'A'.repeat(43), STREAM: {
    video: () => ({ generateToken: async () => token }),
  } };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input); calls.push(url.pathname);
    assert.equal(url.origin, provider);
    assert.equal(init.redirect, 'manual');
    assert.ok(url.pathname.endsWith('.m3u8'), 'bootstrap never requests initialization or media bytes');
    if (stall) return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => { aborts++; reject(new Error('aborted')); }, { once: true });
    });
    if (fail) return new Response('provider-failure-private-body', { status: 503 });
    const body = url.pathname.endsWith('/video.m3u8')
      ? '#EXTM3U\n' + (key ? '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="secret.key"\n' : '') + Array.from({ length: children }, (_, i) =>
        `#EXT-X-STREAM-INF:BANDWIDTH=${300000 + i}\n${unsafe ? 'https://untrusted.invalid/' : ''}level${i}.m3u8\n`).join('')
      : '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nsegment.m4s\n' + '#'.repeat(childSize);
    return new Response(body, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
  };
  const request = new Request(`${origin}/api/sauti-media/${ID}/playback`, { headers: { 'X-Sauti-Playback-Bootstrap': '1' } });
  const descriptor = await sautiStreamPlaybackDescriptor(request, env, asset, options);
  try { await run({ request, descriptor, env, calls, aborts: () => aborts }); }
  finally { globalThis.fetch = previous; }
}

test('one authorized descriptor bundles exact opaque master and child metadata, never provider or segment bytes', async () => {
  await fixture(async ({ request, descriptor, env, calls }) => {
    const bundle = await sautiStreamBootstrap(request, env, asset, descriptor, options);
    assert.equal(bundle.playlists.length, 3);
    assert.equal(bundle.playlists[0].url, descriptor.url);
    assert.equal(calls.length, 3);
    for (const item of bundle.playlists) {
      assert.equal(new URL(item.url).origin, origin);
      assert.ok(new URL(item.url).pathname.startsWith(options.basePath + 'm_'));
      assert.ok(item.body.startsWith('#EXTM3U'));
      assert.equal(item.body.includes(provider), false);
      assert.equal(item.body.includes(token), false);
      assert.equal(item.body.includes(asset.stream_uid), false);
    }
    const master = bundle.playlists[0].body;
    for (const child of bundle.playlists.slice(1)) assert.ok(master.includes(new URL(child.url).pathname + new URL(child.url).search));
    assert.ok(bundle.playlists[1].body.includes(options.basePath + 's_'), 'media URLs retain protected gateway capabilities');
  });
});

test('old clients, MP4 and malformed or foreign master descriptors do not trigger provider work', async () => {
  await fixture(async ({ request, descriptor, env, calls }) => {
    const bad = [null, { ...descriptor, type: 'mp4' }, { ...descriptor, url: 'https://untrusted.invalid/x' },
      { ...descriptor, url: descriptor.url.replace(ID, asset.generation) },
      { ...descriptor, url: descriptor.url + '&token=private' }, { ...descriptor, url: descriptor.url + '#private' }];
    assert.equal(await sautiStreamBootstrap(new Request(request.url), env, asset, descriptor, options), null);
    for (const value of bad) assert.equal(await sautiStreamBootstrap(request, env, asset, value, options), null);
    assert.equal(calls.length, 0);
  });
});

test('provider failures and unsafe playlists omit optional bootstrap without changing the HLS descriptor', async () => {
  for (const config of [{ fail: true }, { unsafe: true }]) await fixture(async ({ request, descriptor, env }) => {
    const original = structuredClone(descriptor);
    assert.equal(await sautiStreamBootstrap(request, env, asset, descriptor, options), null);
    assert.deepEqual(descriptor, original);
  }, config);
});

test('bootstrap enforces eight child and 256KiB combined body bounds', async () => {
  await fixture(async ({ request, descriptor, env, calls }) => {
    assert.equal(await sautiStreamBootstrap(request, env, asset, descriptor, options), null);
    assert.equal(calls.length, 1, 'an oversized child list does not fan out');
  }, { children: 9 });
  await fixture(async ({ request, descriptor, env, calls }) => {
    assert.equal(await sautiStreamBootstrap(request, env, asset, descriptor, options), null);
    assert.equal(calls.length, 3);
  }, { children: 2, childSize: 140000 });
});

test('expired Story playback still fails closed while building a bootstrap', async () => {
  await fixture(async ({ request, descriptor, env, calls }) => {
    assert.equal(await sautiStreamBootstrap(request, env, asset, descriptor,
      { ...options, expiresAt: new Date(Date.now() - 1000).toISOString() }), null);
    assert.equal(calls.length, 0);
  });
});

test('a slow provider cannot hold the optional metadata snapshot beyond its startup budget', async () => {
  await fixture(async ({ request, descriptor, env, calls, aborts }) => {
    const started = performance.now();
    assert.equal(await sautiStreamBootstrap(request, env, asset, descriptor, options), null);
    assert.ok(performance.now() - started < 2500);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(aborts(), 1, 'the deadline aborts the real upstream operation');
    assert.equal(calls.length, 1);
  }, { stall: true });
});

test('a sealed non-playlist m_ resource cannot make bootstrap fetch key bytes', async () => {
  await fixture(async ({ request, descriptor, env, calls }) => {
    assert.equal(await sautiStreamBootstrap(request, env, asset, descriptor, options), null);
    assert.equal(calls.some(path => path.endsWith('.key')), false);
  }, { key: true });
});

test('a disconnected descriptor client cannot start optional provider work', async () => {
  await fixture(async ({ request, descriptor, env, calls }) => {
    const controller = new AbortController(); controller.abort();
    const disconnected = new Request(request, { signal: controller.signal });
    assert.equal(await sautiStreamBootstrap(disconnected, env, asset, descriptor, options), null);
    assert.equal(calls.length, 0);
  });
});
