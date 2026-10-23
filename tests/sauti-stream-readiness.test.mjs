import assert from 'node:assert/strict';
import test from 'node:test';
import Hls from 'hls.js';
import { createStreamReadiness, initialHlsResources, readinessLoader, STREAM_READINESS_AHEAD } from '../src/sauti-stream-readiness.js';
import { validatedStreamDescriptor } from '../src/sauti-stream-web-player.js';

const ORIGIN = 'https://sautilink.com';
const NOW = Date.parse('2026-10-23T12:00:00Z');
const id = (n = 1) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const resource = (media = id(), name = 'master') => `${ORIGIN}/api/sauti-media/${media}/hls/${name}?c=opaque.${'a'.repeat(43)}`;
const master = (media = id()) => `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\n${resource(media, 'high')}\n#EXT-X-STREAM-INF:BANDWIDTH=300000\n${resource(media, 'low')}\n`;
const playlist = (media = id()) => `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI="${resource(media, 'init')}"\n#EXTINF:4,\n${resource(media, 'first')}\n#EXTINF:4,\n${resource(media, 'second')}\n#EXT-X-ENDLIST\n`;
const tick = () => new Promise(setImmediate);
const defer = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const descriptor = (media, now = NOW) => ({ type: 'hls', url: resource(media), expires_in: 300, expires_at: new Date(now + 300000).toISOString() });

function streamingResponse(bytes, { chunkSize = 4096, declared, status = 200, signal, stalled = false, progress = {} } = {}) {
  bytes = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let offset = 0, abort;
  const body = new ReadableStream({
    start(controller) {
      if (signal) {
        abort = () => { progress.aborted = (progress.aborted || 0) + 1; controller.error(new DOMException('aborted', 'AbortError')); };
        signal.addEventListener('abort', abort, { once: true });
      }
    },
    pull(controller) {
      if (stalled) return;
      if (offset >= bytes.length) { controller.close(); signal?.removeEventListener('abort', abort); return; }
      const chunk = bytes.slice(offset, offset + chunkSize); offset += chunk.length;
      progress.bytes = (progress.bytes || 0) + chunk.length;
      controller.enqueue(chunk);
    },
    cancel() { progress.cancelled = (progress.cancelled || 0) + 1; signal?.removeEventListener('abort', abort); },
  });
  return new Response(body, { status, headers: declared === undefined ? {} : { 'Content-Length': String(declared) } });
}

function harness({ reply, segmentSize = 16 } = {}) {
  let time = NOW, sessions = 0;
  const requests = [];
  const cache = createStreamReadiness({ origin: () => ORIGIN, now: () => time,
    ensureSession: async () => { sessions++; }, validateDescriptor: validatedStreamDescriptor,
    fetcher: async (input, options) => {
      const url = new URL(input, ORIGIN);
      const media = url.pathname.split('/')[3];
      const name = url.pathname.endsWith('/playback') ? 'descriptor' : url.pathname.split('/').at(-1);
      const call = { url: url.href, media, name, options }; requests.push(call);
      // Keep a broken retry loop finite, so a regression fails instead of
      // starving the test runner's event loop indefinitely.
      if (requests.filter((item) => item.media === media && item.name === name).length > 4) throw new Error('UNBOUNDED_READINESS_RETRY');
      assert.equal(url.origin, ORIGIN);
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error'); assert.equal(options.priority, 'low'); assert.ok(options.signal instanceof AbortSignal);
      const customized = await reply?.(call, { cache, now: () => time });
      if (customized) return customized;
      if (name === 'descriptor') return new Response(JSON.stringify({ ok: true, data: descriptor(media, time) }));
      if (name === 'master') return new Response(master(media));
      if (name === 'low') return new Response(playlist(media));
      if (name === 'init') return new Response(new Uint8Array(8));
      if (name === 'first') return new Response(new Uint8Array(segmentSize));
      throw new Error('Unexpected speculative resource ' + name);
    },
  });
  return { cache, requests, sessions: () => sessions, setTime: (value) => { time = value; } };
}
async function idle(cache) {
  for (let attempt = 0; attempt < 300; attempt++) { await tick(); if (!cache.snapshot().inFlight) return; }
  assert.fail('readiness jobs did not settle');
}

function separateAudioMaster(media = id()) {
  return master(media).replace('#EXTM3U', `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="voice",DEFAULT=YES,URI="${resource(media, 'audio')}"`)
    .replace('BANDWIDTH=300000', 'BANDWIDTH=300000,AUDIO="voice"');
}
function audioPlaylist(media = id()) {
  return playlist(media).replaceAll(resource(media, 'init'), resource(media, 'audio-init'))
    .replaceAll(resource(media, 'first'), resource(media, 'audio-first')).replaceAll(resource(media, 'second'), resource(media, 'audio-second'));
}

test('selected low variant warms only its referenced audio group with unchanged capabilities', async () => {
  const h = harness({ reply(call) {
    if (call.name === 'master') return new Response(separateAudioMaster(call.media));
    if (call.name === 'audio') return new Response(audioPlaylist(call.media));
    if (['audio-init', 'audio-first'].includes(call.name)) return new Response(new Uint8Array(8));
  } });
  try {
    h.cache.update([id()]); await idle(h.cache);
    assert.deepEqual(h.requests.map((x) => x.name), ['descriptor', 'master', 'low', 'init', 'first', 'audio', 'audio-init', 'audio-first']);
    assert.equal(h.cache.resource(id(), resource(id(), 'audio-first')).data.byteLength, 8);
    const unsafe = separateAudioMaster().replace(resource(id(), 'audio'), 'https://foreign.invalid/audio');
    assert.equal(initialHlsResources(unsafe, resource(), id(), ORIGIN), null);
  } finally { h.cache.clear(); }
});

test('video and referenced audio share the same two MiB clip budget', async () => {
  const progress = {};
  const h = harness({ segmentSize: 1200000, reply(call) {
    if (call.name === 'master') return new Response(separateAudioMaster(call.media));
    if (call.name === 'audio') return new Response(audioPlaylist(call.media));
    if (call.name === 'audio-init') return new Response(new Uint8Array(8));
    if (call.name === 'audio-first') return streamingResponse(new Uint8Array(1200000), { declared: 1200000, progress });
  } });
  try {
    h.cache.update([id()]); await idle(h.cache);
    assert.ok(h.cache.snapshot().bytes <= 2 * 1024 * 1024);
    assert.equal(h.cache.resource(id(), resource(id(), 'audio-first')), null);
    assert.equal(progress.cancelled, 1, 'an oversized declared body is cancelled before a reader is acquired');
    assert.ok((progress.bytes || 0) <= 4096, 'the stream may queue its initial chunk, but must not drain the oversized body');
  } finally { h.cache.clear(); }
});

test('visible playback suspension cancels an in-flight selected audio body without starting farther clips', async () => {
  const progress = {};
  const h = harness({ reply(call) {
    if (call.name === 'master') return new Response(separateAudioMaster(call.media));
    if (call.name === 'audio') return new Response(audioPlaylist(call.media));
    if (call.name === 'audio-init') return new Response(new Uint8Array(8));
    if (call.name === 'audio-first') return streamingResponse(new Uint8Array(), { stalled: true, signal: call.options.signal, progress });
  } });
  try {
    h.cache.update([id()]);
    for (let attempt = 0; attempt < 30 && !h.requests.some((x) => x.name === 'audio-first'); attempt++) await tick();
    assert.ok(h.requests.some((x) => x.name === 'audio-first'));
    h.cache.update([id(), id(2)], { suspended: true }); await idle(h.cache);
    assert.equal(progress.aborted, 1); assert.ok(!h.requests.some((x) => x.media === id(2)));
  } finally { h.cache.clear(); }
});

test('plans the lowest advertised master level and only the first VOD init/fragment with exact capabilities', () => {
  assert.deepEqual(initialHlsResources(master(), resource(), id(), ORIGIN), { playlist: resource(id(), 'low') });
  assert.deepEqual(initialHlsResources(playlist(), resource(id(), 'low'), id(), ORIGIN), {
    resources: [resource(id(), 'init'), resource(id(), 'first')],
  });
  assert.deepEqual(initialHlsResources(playlist().replace('#EXT-X-TARGETDURATION:4', '#EXT-X-KEY:METHOD=NONE'), resource(), id(), ORIGIN), {
    resources: [resource(id(), 'init'), resource(id(), 'first')],
  });
});

test('never plans foreign, cross-media, credentialed, malformed or extra-query capability URLs', () => {
  for (const unsafe of [
    resource().replace(ORIGIN, 'https://foreign.invalid'), resource(id(2)), resource().replace('https://', 'http://'),
    resource().replace('https://', 'https://user:password@'), resource() + '#fragment', resource() + '&token=private',
    resource() + '&c=opaque.' + 'b'.repeat(43), resource().replace('opaque.', 'bad+opaque.'),
    resource().replace('/hls/master', '/hls/../../arbitrary'), '/api/private',
  ]) {
    const value = `#EXTM3U\n#EXTINF:4,\n${unsafe}\n#EXT-X-ENDLIST\n`;
    assert.equal(initialHlsResources(value, resource(), id(), ORIGIN), null);
  }
});

test('rejects live, key-bearing and ranged playlists before any resource speculation', () => {
  for (const text of [
    playlist().replace('#EXT-X-ENDLIST', ''),
    playlist().replace('#EXT-X-TARGETDURATION:4', '#EXT-X-KEY:METHOD=AES-128,URI="key"'),
    playlist().replace('#EXT-X-TARGETDURATION:4', '#EXT-X-KEY:METHOD=NONE-PRIVATE,URI="key"'),
    playlist().replace('#EXT-X-TARGETDURATION:4', '#EXT-X-BYTERANGE:1024@0'),
    playlist().replace('URI="', 'BYTERANGE="1024@0",URI="'),
    '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key"\n' + master(),
    master().replace('#EXTM3U', '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key"'),
    master().replace('#EXTM3U', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"'),
    'not a playlist', '#EXTM3U\n' + '#'.repeat(65536),
  ]) assert.equal(initialHlsResources(text, resource(), id(), ORIGIN), null);
});

test('warms at most five unique upcoming clips and stops after the first low-quality fragment', async () => {
  const h = harness();
  try {
    h.cache.update(['bad-id', id(1), id(1), ...Array.from({ length: 7 }, (_, i) => id(i + 2))]);
    await idle(h.cache);
    assert.equal(STREAM_READINESS_AHEAD, 5);
    assert.deepEqual(h.cache.snapshot().wanted, [id(1), id(2), id(3), id(4), id(5)]);
    assert.equal(h.sessions(), 5);
    for (let i = 1; i <= 5; i++) {
      assert.deepEqual(h.requests.filter((item) => item.media === id(i)).map((item) => item.name), ['descriptor', 'master', 'low', 'init', 'first']);
      assert.ok(h.cache.descriptor(id(i)));
      const bytes = h.cache.resource(id(i), resource(id(i), 'first')).data;
      assert.ok(bytes instanceof ArrayBuffer); assert.equal(bytes.byteLength, 16);
      new Uint8Array(bytes)[0] = 255;
      assert.equal(new Uint8Array(h.cache.resource(id(i), resource(id(i), 'first')).data)[0], 0, 'SDK mutations cannot corrupt retained bytes');
    }
    const count = h.requests.length; h.cache.update([id(1), id(2)]); await idle(h.cache);
    assert.equal(h.requests.length, count, 'ready descriptors and resources do not start another warm request');
  } finally { h.cache.clear(); }
});

test('limits descriptor work to two jobs and aborts old jobs when the rolling next-five window moves', async () => {
  const started = [], aborted = []; let active = 0, peak = 0;
  const h = harness({ reply(call) {
    if (call.name !== 'descriptor') return;
    started.push(call.media); active++; peak = Math.max(peak, active);
    return new Promise((resolve, reject) => call.options.signal.addEventListener('abort', () => {
      active--; aborted.push(call.media); reject(new DOMException('aborted', 'AbortError'));
    }, { once: true }));
  } });
  try {
    h.cache.update([id(1), id(2), id(3), id(4), id(5)]); await tick();
    assert.deepEqual(started, [id(1), id(2)]); assert.equal(h.cache.snapshot().inFlight, 2);
    h.cache.update([id(6), id(7), id(8), id(9), id(10)]); await tick(); await tick();
    assert.deepEqual(aborted, [id(1), id(2)]); assert.deepEqual(started, [id(1), id(2), id(6), id(7)]);
    assert.equal(peak, 2);
    h.cache.update([id(6), id(7)], { suspended: true }); await idle(h.cache);
    assert.equal(active, 0); assert.equal(h.cache.snapshot().inFlight, 0);
    const count = started.length; await tick(); assert.equal(started.length, count);
  } finally { h.cache.clear(); }
});

test('expiry and owner-generation clearing remove private descriptors and bytes, including late old responses', async () => {
  const h = harness();
  try {
    h.cache.update([id()]); await idle(h.cache);
    h.setTime(NOW + 286000); assert.equal(h.cache.descriptor(id()), null, 'descriptors need a15second authorization margin');
    assert.ok(h.cache.resource(id(), resource(id(), 'first')));
    h.setTime(NOW + 300000); assert.equal(h.cache.resource(id(), resource(id(), 'first')), null);
    assert.equal(h.cache.snapshot().bytes, 0);
    h.setTime(NOW); h.cache.update([id()]); await idle(h.cache); h.cache.clear();
    assert.equal(h.cache.descriptor(id()), null); assert.equal(h.cache.resource(id(), resource(id(), 'first')), null);
    assert.equal(h.cache.snapshot().bytes, 0);
  } finally { h.cache.clear(); }
  const gate = defer();
  const late = harness({ reply: (call) => call.name === 'descriptor' ? gate.promise : undefined });
  late.cache.update([id()]); await tick(); late.cache.clear();
  gate.resolve(new Response(JSON.stringify({ ok: true, data: descriptor(id()) })));
  await idle(late.cache);
  assert.deepEqual(late.requests.map((item) => item.name), ['descriptor']);
  assert.equal(late.cache.snapshot().records, 0);
});

test('a stalled actual response stream aborts on owner clear and never retains partial bytes', async () => {
  const progress = {};
  const h = harness({ reply: (call) => call.name === 'first'
    ? streamingResponse(new Uint8Array(), { stalled: true, signal: call.options.signal, progress }) : undefined });
  h.cache.update([id()]);
  for (let i = 0; i < 30 && !h.requests.some((item) => item.name === 'first'); i++) await tick();
  assert.ok(h.requests.some((item) => item.name === 'first'));
  h.cache.clear(); await idle(h.cache);
  assert.equal(progress.aborted, 1); assert.equal(h.cache.snapshot().bytes, 0); assert.equal(h.cache.snapshot().records, 0);
});

test('oversized declared and actual descriptor streams stop before JSON parsing or playlist requests', async () => {
  for (const declared of [undefined, 20000]) {
    const progress = {};
    const body = JSON.stringify({ ok: true, data: descriptor(id()), padding: 'x'.repeat(70000) });
    const h = harness({ reply: (call) => call.name === 'descriptor' ? streamingResponse(body, { declared, progress }) : undefined });
    try {
      h.cache.update([id()]); await idle(h.cache);
      assert.deepEqual(h.requests.map((item) => item.name), ['descriptor']);
      assert.equal(h.cache.descriptor(id()), null);
      assert.ok(progress.cancelled, 'oversized control stream must be cancelled');
      assert.ok(progress.bytes <= 24576, 'no unbounded response.json allocation');
    } finally { h.cache.clear(); }
  }
});

test('oversized playlist and fragment streams are bounded and never admitted to the cache', async () => {
  for (const name of ['master', 'first']) {
    for (const declared of [undefined, 3 * 1024 * 1024]) {
      const progress = {}, size = name === 'master' ? 70000 : 3 * 1024 * 1024;
      const h = harness({ reply: (call) => call.name === name ? streamingResponse(new Uint8Array(size), { declared, progress }) : undefined });
      try {
        h.cache.update([id()]); await idle(h.cache);
        assert.equal(h.cache.resource(id(), resource(id(), name)), null);
        assert.ok(progress.cancelled);
        assert.ok(progress.bytes <= (name === 'master' ? 65536 : 2 * 1024 * 1024) + 8192);
        assert.ok(h.cache.snapshot().bytes <= 2 * 1024 * 1024);
      } finally { h.cache.clear(); }
    }
  }
});

test('failed, unsupported and unsafe descriptors back off instead of repumping continuously', async () => {
  for (const body of [
    { ok: true, data: { ...descriptor(id()), type: 'mp4', url: `${ORIGIN}/api/sauti-media/${id()}` } },
    { ok: true, data: { ...descriptor(id()), url: resource(id(2)) } },
    { ok: false, error: { code: 'DENIED' } },
  ]) {
    const h = harness({ reply: (call) => call.name === 'descriptor' ? new Response(JSON.stringify(body)) : undefined });
    try {
      h.cache.update([id()]); await idle(h.cache); h.cache.update([id()]); await idle(h.cache);
      assert.equal(h.requests.length, 1); assert.equal(h.cache.snapshot().records, 0);
      h.setTime(NOW + 20001); h.cache.update([id()]); await idle(h.cache); assert.equal(h.requests.length, 2);
    } finally { h.cache.clear(); }
  }
});

test('global byte and record caps evict older clips as new next-five windows are warmed', async () => {
  for (const segmentSize of [16, 1900000]) {
    const h = harness({ segmentSize });
    try {
      h.cache.update([id(1), id(2), id(3), id(4), id(5)]); await idle(h.cache);
      h.cache.update([id(6), id(7), id(8), id(9), id(10)]); await idle(h.cache);
      const snapshot = h.cache.snapshot();
      assert.ok(snapshot.records <= 8); assert.ok(snapshot.bytes <= 12 * 1024 * 1024);
      assert.equal(h.cache.resource(id(1), resource(id(1), 'first')), null);
      assert.ok(h.cache.resource(id(10), resource(id(10), 'first')));
    } finally { h.cache.clear(); }
  }
});

class DefaultLoader {
  constructor() { this.stats = { loading: {}, aborted: false }; this.network = []; }
  load(context, config, callbacks) { this.context = context; this.network.push({ context, config, callbacks }); }
  abort() { this.stats.aborted = true; }
  destroy() { this.destroyed = true; }
}

test('actual custom loader consumes retained playlist/binary bytes without another request and reports SDK stats', async () => {
  const h = harness();
  try {
    h.cache.update([id()]); await idle(h.cache);
    const Loader = readinessLoader(DefaultLoader, h.cache, id());
    const before = h.requests.length;
    for (const [name, responseType, expected] of [['low', 'text', 'string'], ['first', 'arraybuffer', 'object']]) {
      const loader = new Loader(), calls = [];
      const context = { url: resource(id(), name), responseType };
      loader.load(context, {}, { onSuccess(...args) { calls.push(args); } });
      assert.equal(calls.length, 0, 'memory hits preserve asynchronous SDK completion'); await tick();
      assert.equal(calls.length, 1); assert.equal(loader.network.length, 0);
      const [response, stats, returnedContext] = calls[0];
      assert.equal(response.url, context.url); assert.equal(response.code, 200); assert.equal(typeof response.data, expected);
      assert.equal(returnedContext, context); assert.ok(stats.loaded > 0); assert.equal(stats.loaded, stats.total);
      assert.equal(stats.chunkCount, 1); assert.ok(stats.loading.end >= stats.loading.start);
    }
    assert.equal(h.requests.length, before);
  } finally { h.cache.clear(); }
});

test('SDK ranges, foreign IDs, type mismatches and misses always retain the default loader', async () => {
  const h = harness();
  try {
    h.cache.update([id()]); await idle(h.cache);
    const Loader = readinessLoader(DefaultLoader, h.cache, id());
    for (const context of [
      { url: resource(id(), 'first'), responseType: 'arraybuffer', rangeStart: 0, rangeEnd: 8 },
      { url: resource(id(), 'first'), responseType: 'arraybuffer', headers: { rAnGe: 'bytes=0-7' } },
      { url: resource(id(), 'low'), responseType: 'arraybuffer' },
      { url: resource(id(), 'first'), responseType: 'text' },
      { url: resource(id(2), 'first'), responseType: 'arraybuffer' },
      { url: resource(id(), 'second'), responseType: 'arraybuffer' },
    ]) {
      const loader = new Loader(); loader.load(context, {}, { onSuccess() { assert.fail('unsafe memory hit'); } });
      await tick(); assert.equal(loader.network.length, 1); assert.equal(loader.network[0].context, context);
    }
  } finally { h.cache.clear(); }
});

test('abort, destroy and a superseding load suppress queued memory-hit completion', async () => {
  const value = { data: new ArrayBuffer(2), size: 2, duration: 1 };
  const Loader = readinessLoader(DefaultLoader, { resource: (_, url) => url === 'hit' ? value : null }, id());
  for (const action of ['abort', 'destroy', 'supersede']) {
    const loader = new Loader(); let successes = 0;
    loader.load({ url: 'hit', responseType: 'arraybuffer' }, {}, { onSuccess() { successes++; } });
    if (action === 'supersede') loader.load({ url: 'miss', responseType: 'arraybuffer' }, {}, { onSuccess() { assert.fail('no default loader network response provided'); } });
    else loader[action]();
    await tick(); assert.equal(successes, 0, action);
  }
});

test('clearing owner data or expiring the grant suppresses an already queued private memory hit', async () => {
  for (const reason of ['owner-clear', 'expired']) {
    const h = harness();
    try {
      h.cache.update([id()]); await idle(h.cache);
      const Loader = readinessLoader(DefaultLoader, h.cache, id());
      const loader = new Loader(); let successes = 0;
      loader.load({ url: resource(id(), 'first'), responseType: 'arraybuffer' }, {}, { onSuccess() { successes++; } });
      if (reason === 'owner-clear') h.cache.clear(); else h.setTime(NOW + 300000);
      await tick(); assert.equal(successes, 0, reason + ' must revoke queued private memory completion');
    } finally { h.cache.clear(); }
  }
});

test('pinned HLS default loader abort settles a cached fragment once with the real SDK abort contract', async () => {
  assert.equal(Hls.version, '1.7.3');
  const previous = globalThis.self; globalThis.self = globalThis;
  try {
    const bytes = { data: new ArrayBuffer(4), size: 4, duration: 1, isCurrent: () => true };
    const Loader = readinessLoader(Hls.DefaultConfig.loader, { resource: () => bytes }, id());
    const loader = new Loader(Hls.DefaultConfig);
    const context = { url: resource(id(), 'first'), responseType: 'arraybuffer', rangeStart: 0, rangeEnd: 0 };
    let aborts = 0, successes = 0;
    loader.load(context, {}, {
      onSuccess() { successes++; }, onError() { assert.fail('abort is not a network error'); },
      onAbort(stats, returnedContext, details) {
        aborts++; assert.equal(stats.aborted, true); assert.equal(returnedContext, context); assert.equal(details, null);
        // The actual FragmentLoader resets/destroys its ILoader in onAbort
        // before rejecting the waiting fragment promise.
        loader.destroy();
      },
    });
    loader.abort(); loader.abort(); await tick();
    assert.equal(aborts, 1); assert.equal(successes, 0);
  } finally { if (previous === undefined) delete globalThis.self; else globalThis.self = previous; }
});

test('pinned HLS default loader settles invalidated owner/expiry hits through bounded onError, never stale success', async () => {
  const previous = globalThis.self; globalThis.self = globalThis;
  try {
    for (const reason of ['owner-clear', 'expired']) {
      const h = harness();
      try {
        h.cache.update([id()]); await idle(h.cache);
        const Loader = readinessLoader(Hls.DefaultConfig.loader, h.cache, id());
        const loader = new Loader(Hls.DefaultConfig), context = { url: resource(id(), 'first'), responseType: 'arraybuffer' };
        let errors = 0, successes = 0;
        loader.load(context, {}, {
          onSuccess() { successes++; }, onAbort() { assert.fail('invalidation must settle through onError'); },
          onError(error, returnedContext, details, stats) {
            errors++; assert.equal(error.code, 0); assert.equal(error.text, 'READINESS_INVALIDATED');
            assert.equal(returnedContext, context); assert.equal(details, null); assert.ok(stats.loaded > 0);
            loader.destroy();
          },
        });
        if (reason === 'owner-clear') h.cache.clear(); else h.setTime(NOW + 300000);
        await tick(); assert.equal(errors, 1, reason); assert.equal(successes, 0);
      } finally { h.cache.clear(); }
    }
  } finally { if (previous === undefined) delete globalThis.self; else globalThis.self = previous; }
});
