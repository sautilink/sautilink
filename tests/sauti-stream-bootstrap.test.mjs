import assert from 'node:assert/strict';
import test from 'node:test';
import { sautiStreamBootstrap, sautiStreamInitializationHeader } from '../src/sauti-stream-bootstrap.js';
import { sautiStreamPlaybackDescriptor } from '../src/sauti-stream-playback.js';

const ID = '11111111-1111-4111-8111-111111111111';
const asset = { kind: 'post', id: ID, generation: '22222222-2222-4222-8222-222222222222', stream_uid: 'a'.repeat(32) };
const origin = 'https://sautilink.com';
const provider = 'https://customer-example.cloudflarestream.com';
const options = { basePath: `/api/sauti-media/${ID}/hls/`, accessScope: 'Bearer authenticated-test-session' };
const token = 'provider.private.signature';

function initHeader() {
  return Uint8Array.from([...Buffer.from([0, 0, 0, 16]), ...Buffer.from('ftypiso60000'),
    ...Buffer.from([0, 0, 0, 16]), ...Buffer.from('moov00000000')]);
}

async function fixture(run, { children = 2, childSize = 0, fail = false, unsafe = false, stall = false, key = false,
  maps = false, mapCount = 1, initBytes = initHeader(), stallInit = false } = {}) {
  const previous = globalThis.fetch;
  const calls = []; let aborts = 0;
  const env = { SAUTI_STREAM_ORIGIN: provider, SAUTI_STREAM_SOURCE_KEY: 'A'.repeat(43), STREAM: {
    video: () => ({ generateToken: async () => token }),
  } };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input); calls.push(url.pathname);
    assert.equal(url.origin, provider);
    assert.equal(init.redirect, 'manual');
    assert.ok(url.pathname.endsWith('.m3u8') || maps && /\/init\d*\.mp4$/.test(url.pathname), 'only playlists and explicit MAP headers can be requested');
    if (stall) return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => { aborts++; reject(new Error('aborted')); }, { once: true });
    });
    if (fail) return new Response('provider-failure-private-body', { status: 503 });
    if (/\/init\d*\.mp4$/.test(url.pathname)) {
      if (stallInit) return new Promise((_, reject) => init.signal.addEventListener('abort', () => {
        aborts++; reject(new Error('aborted'));
      }, { once: true }));
      return new Response(initBytes, { headers: { 'Content-Type': 'video/mp4' } });
    }
    const body = url.pathname.endsWith('/video.m3u8')
      ? '#EXTM3U\n' + (key ? '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="secret.key"\n' : '') + Array.from({ length: children }, (_, i) =>
        `#EXT-X-STREAM-INF:BANDWIDTH=${300000 + i}\n${unsafe ? 'https://untrusted.invalid/' : ''}level${i}.m3u8\n`).join('')
      : '#EXTM3U\n#EXT-X-TARGETDURATION:4\n' + (maps ? Array.from({ length: mapCount }, (_, i) =>
        `#EXT-X-MAP:URI="init${mapCount === 1 ? '' : i}.mp4"\n`).join('') : '') + '#EXTINF:4,\nsegment.m4s\n' + '#'.repeat(childSize);
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

test('only explicit MAP configuration headers are bundled and their exact protected URLs remain in playlists', async () => {
  await fixture(async ({ request, descriptor, env, calls }) => {
    const bundle = await sautiStreamBootstrap(request, env, asset, descriptor, options);
    assert.equal(bundle.initializations.length, 2);
    assert.equal(calls.length, 5);
    for (const header of bundle.initializations) {
      const url = new URL(header.url);
      assert.equal(url.origin, origin); assert.ok(url.pathname.startsWith(options.basePath + 's_'));
      assert.ok(bundle.playlists.some(item => item.body.includes(`URI="${url.pathname}${url.search}"`)));
      assert.deepEqual(Buffer.from(header.base64, 'base64'), Buffer.from(initHeader()));
    }
    assert.equal(calls.some(path => path.endsWith('.m4s')), false, 'no sample data is prefetched');
  }, { maps: true });
});

test('initialization validation rejects sample boxes, duplicates, malformed lengths and trailing bytes', async () => {
  assert.equal(sautiStreamInitializationHeader(initHeader()), true);
  const invalid = [new Uint8Array(), new Uint8Array(16385), initHeader().slice(0, -1),
    Uint8Array.from([...initHeader(), 0]), Uint8Array.from([...initHeader(), ...initHeader()])];
  for (const type of ['mdat', 'moof', 'free', 'sidx', 'ftyp']) {
    const bytes = initHeader(); bytes.set(Buffer.from(type), 20); invalid.push(bytes);
  }
  const zeroSize = initHeader(); zeroSize.fill(0, 0, 4); invalid.push(zeroSize);
  const extended = initHeader(); extended[3] = 1; invalid.push(extended);
  for (const bytes of invalid) assert.equal(sautiStreamInitializationHeader(bytes), false);
  for (const initBytes of invalid.slice(0, 5)) await fixture(async ({ request, descriptor, env }) => {
    const bundle = await sautiStreamBootstrap(request, env, asset, descriptor, options);
    assert.equal(bundle.playlists.length, 3); assert.equal(bundle.initializations, undefined);
  }, { maps: true, initBytes });
});

test('a slow MAP header retains the completed playlist bootstrap and aborts all optional header requests', async () => {
  await fixture(async ({ request, descriptor, env, calls, aborts }) => {
    const started = performance.now();
    const bundle = await sautiStreamBootstrap(request, env, asset, descriptor, options);
    assert.equal(bundle.playlists.length, 3); assert.equal(bundle.initializations, undefined);
    assert.ok(performance.now() - started < 2500);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(aborts(), 2); assert.equal(calls.length, 5);
  }, { maps: true, stallInit: true });
});

test('too many MAP headers and decoded combined overflow preserve playlists without oversized initialization data', async () => {
  await fixture(async ({ request, descriptor, env, calls }) => {
    const bundle = await sautiStreamBootstrap(request, env, asset, descriptor, options);
    assert.equal(bundle.playlists.length, 2); assert.equal(bundle.initializations, undefined);
    assert.equal(calls.length, 2, 'more than eight MAP headers never fan out');
  }, { children: 1, maps: true, mapCount: 9 });
  const large = new Uint8Array(16384); large.set(initHeader().slice(0, 16));
  new DataView(large.buffer).setUint32(16, large.length - 16, false); large.set(Buffer.from('moov'), 20);
  assert.equal(sautiStreamInitializationHeader(large), true);
  await fixture(async ({ request, descriptor, env }) => {
    const bundle = await sautiStreamBootstrap(request, env, asset, descriptor, options);
    assert.equal(bundle.playlists.length, 3); assert.equal(bundle.initializations, undefined);
  }, { maps: true, childSize: 120000, initBytes: large });
});
