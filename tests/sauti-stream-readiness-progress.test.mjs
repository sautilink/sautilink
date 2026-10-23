import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createStreamReadiness, readinessLoader } from '../src/sauti-stream-readiness.js';
import { validatedStreamDescriptor } from '../src/sauti-stream-web-player.js';
import { applyStreamReadinessDiagnostics } from '../src/web-media-readiness.js';

const ID = '11111111-1111-4111-8111-111111111111', ORIGIN = 'https://sautilink.com';
const NOW = Date.parse('2026-10-23T20:00:00Z');
const url = (name) => `${ORIGIN}/api/sauti-media/${ID}/hls/${name}?c=opaque.${'a'.repeat(43)}`;
const master = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000\n${url('low')}\n`;
const low = `#EXTM3U\n#EXT-X-MAP:URI="${url('init')}"\n#EXTINF:4,\n${url('first')}\n#EXT-X-ENDLIST\n`;
const tick = () => new Promise(setImmediate);
async function until(predicate) { for (let i = 0; i < 100; i++) { await tick(); if (predicate()) return; } assert.fail('operation did not settle'); }
function fixture(reply = () => {}) {
  let time = NOW, sequence = 0;
  const timers = new Map(), requests = [], changes = [];
  const cache = createStreamReadiness({ origin: () => ORIGIN, now: () => time, ensureSession: async () => {},
    validateDescriptor: validatedStreamDescriptor, onChange: (id, state) => changes.push({ id, state }),
    setTimer(callback, delay) { timers.set(++sequence, { callback, at: time + delay }); return sequence; },
    clearTimer: (id) => timers.delete(id),
    fetcher: async (input, options) => {
      const name = input.endsWith('/playback') ? 'descriptor' : new URL(input).pathname.split('/').at(-1);
      requests.push(name); const custom = await reply(name, options, requests);
      if (custom) return custom;
      if (name === 'descriptor') return Response.json({ ok: true, data: { type: 'hls', url: url('master'), expires_in: 300, expires_at: new Date(time + 300000).toISOString() } });
      if (name === 'master') return new Response(master);
      if (name === 'low') return new Response(low);
      return new Response(new Uint8Array(name === 'init' ? 8 : 16));
    },
  });
  return { cache, requests, changes, timers, idle: () => until(() => cache.snapshot().inFlight === 0),
    async advance(ms) {
      time += ms;
      for (let i = 0; i < 20; i++) {
        const pending = [...timers].find(([, timer]) => timer.at <= time);
        if (!pending) { await tick(); return; }
        timers.delete(pending[0]); pending[1].callback(); await this.idle();
      }
      assert.fail('unbounded retry timer loop');
    },
  };
}

test('a transient failure retries once after20s without another viewport event and never idles in a timer loop', async () => {
  const h = fixture((name, _, requests) => { if (name === 'descriptor' && requests.length === 1) throw new TypeError('private upstream URL must not be diagnosed'); });
  try {
    h.cache.update([ID]); await h.idle();
    assert.equal(h.cache.status(ID).state, 'backoff'); assert.equal(h.cache.status(ID).reason, 'network'); assert.equal(h.timers.size, 1);
    await h.advance(19999); assert.equal(h.requests.length, 1);
    await h.advance(1); assert.equal(h.cache.status(ID).state, 'ready'); assert.equal(h.cache.status(ID).retry, 1);
    assert.equal(h.requests.filter((x) => x === 'descriptor').length, 2); assert.equal(h.timers.size, 0);
    await h.advance(60000); assert.equal(h.requests.filter((x) => x === 'descriptor').length, 2);
    assert.doesNotMatch(JSON.stringify(h.changes), /upstream|https|opaque|c=/);
  } finally { h.cache.clear(); }
});

test('a second transient failure is terminal for its continuous wanted window; suspension/owner clear cancel timers', async () => {
  const h = fixture((name) => name === 'descriptor' ? new Response(null, { status: 503 }) : undefined);
  try {
    h.cache.update([ID]); await h.idle(); h.cache.update([ID], { suspended: true }); assert.equal(h.timers.size, 0);
    await h.advance(30000); assert.equal(h.requests.length, 1);
    h.cache.update([ID]); await h.idle(); assert.equal(h.requests.length, 2);
    assert.equal(h.cache.status(ID).state, 'failed'); assert.equal(h.cache.status(ID).http, 503); assert.equal(h.cache.status(ID).retry, 1);
    await h.advance(3600000); h.cache.update([ID]); await h.idle(); assert.equal(h.requests.length, 2); assert.equal(h.timers.size, 0);
    h.cache.update([]); h.cache.update([ID]); await h.idle(); assert.equal(h.requests.length, 3); assert.equal(h.timers.size, 1);
    h.cache.clear(); assert.equal(h.cache.status(ID), null); assert.equal(h.timers.size, 0);
    await h.advance(30000); assert.equal(h.requests.length, 3); assert.equal(h.changes.at(-1).state, null);
  } finally { h.cache.clear(); }
});

test('suspended partial progress resumes exact original URLs without another descriptor, playlist or init request', async () => {
  let stalled = true;
  const h = fixture((name, options) => {
    if (name === 'first' && stalled) {
      stalled = false;
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
    }
  });
  try {
    h.cache.update([ID]); await until(() => h.requests.includes('first'));
    const expiry = h.cache.descriptor(ID).expiry, bytes = h.cache.snapshot().bytes;
    assert.ok(h.cache.resource(ID, url('init')));
    h.cache.update([ID], { suspended: true }); await h.idle(); assert.equal(h.cache.status(ID).state, 'suspended');
    await h.advance(30000); assert.equal(h.cache.snapshot().bytes, bytes);
    h.cache.update([ID]); await h.idle();
    assert.equal(h.cache.status(ID).state, 'ready'); assert.equal(h.cache.descriptor(ID).expiry, expiry);
    for (const name of ['descriptor', 'master', 'low', 'init']) assert.equal(h.requests.filter((x) => x === name).length, 1, name);
    assert.equal(h.requests.filter((x) => x === 'first').length, 2);
    assert.equal(h.cache.snapshot().bytes, bytes + 16); assert.equal(h.cache.status(ID).retry, 0);
  } finally { h.cache.clear(); }
});

test('expiry prevents reusing any partial grant and requires a newly authorized descriptor', async () => {
  const h = fixture();
  try {
    h.cache.update([ID]); await h.idle(); const expiry = h.cache.descriptor(ID).expiry;
    h.cache.hit(ID); await h.advance(300001);
    assert.equal(h.cache.status(ID).state, 'expired'); assert.equal(h.cache.status(ID).bytes, 0); assert.equal(h.cache.status(ID).hits, 0);
    assert.equal(h.cache.resource(ID, url('first')), null); assert.equal(h.cache.descriptor(ID), null);
    h.cache.update([ID]); await h.idle(); assert.equal(h.requests.filter((x) => x === 'descriptor').length, 2);
    assert.ok(h.cache.descriptor(ID).expiry > expiry, 'a fresh descriptor may grant a new lease; retained bytes never extend the old one');
  } finally { h.cache.clear(); }
});

test('unsupported/capability/budget/authorization reasons are sanitized and never automatically retried', async () => {
  const cases = [
    ['byte-range', () => low.replace('#EXTINF:4,', '#EXT-X-BYTERANGE:16@0\n#EXTINF:4,')],
    ['encrypted', () => low.replace('#EXTINF:4,', '#EXT-X-KEY:METHOD=AES-128,URI="private"\n#EXTINF:4,')],
    ['non-vod', () => low.replace('#EXT-X-ENDLIST', '')],
    ['unsafe-playlist', () => low.replace(url('first'), 'https://private.invalid/fragment')],
  ];
  for (const [expected, body] of cases) {
    const h = fixture((name) => name === 'low' ? new Response(body()) : undefined);
    try {
      h.cache.update([ID]); await h.idle(); assert.equal(h.cache.status(ID).reason, expected); assert.equal(h.timers.size, 0);
      const count = h.requests.length; await h.advance(60000); h.cache.update([ID]); await h.idle(); assert.equal(h.requests.length, count);
      assert.doesNotMatch(JSON.stringify(h.cache.status(ID)), /private|https|opaque/);
    } finally { h.cache.clear(); }
  }
  for (const [expected, response] of [['auth-denied', () => new Response(null, { status: 403 })],
    ['metadata-budget', () => new Response('large', { headers: { 'Content-Length': '70000' } })]]) {
    const h = fixture((name) => name === 'descriptor' ? response() : undefined);
    try { h.cache.update([ID]); await h.idle(); assert.equal(h.cache.status(ID).reason, expected); assert.equal(h.timers.size, 0); }
    finally { h.cache.clear(); }
  }
});

test('only a completed valid SDK memory delivery counts as a hit; invalidated/aborted hits and transport misses remain distinct', async () => {
  const h = fixture();
  class Loader { constructor() { this.stats = { loading: {}, aborted: false }; this.network = 0; } load() { this.network++; } abort() { this.stats.aborted = true; } destroy() {} }
  try {
    h.cache.update([ID]); await h.idle(); h.cache.resource(ID, url('first')); assert.equal(h.cache.status(ID).hits, 0);
    const Cached = readinessLoader(Loader, h.cache, ID), hit = new Cached(); let delivered = 0;
    hit.load({ url: url('first'), responseType: 'arraybuffer' }, {}, { onSuccess() { delivered++; } });
    assert.equal(h.cache.status(ID).hits, 0); await tick(); assert.equal(delivered, 1); assert.equal(h.cache.status(ID).hits, 1);
    const aborted = new Cached(); aborted.load({ url: url('first'), responseType: 'arraybuffer' }, {}, { onSuccess() { assert.fail('aborted hit'); } }); aborted.abort(); await tick();
    assert.equal(h.cache.status(ID).hits, 1);
    const miss = new Cached(); miss.load({ url: url('later'), responseType: 'arraybuffer' }, {}, {});
    assert.equal(miss.network, 1); assert.equal(h.cache.status(ID).misses, 1);
    h.cache.clear(); assert.equal(h.cache.status(ID), null);
  } finally { h.cache.clear(); }
});

test('late-attached Home/Shorts video inherits safe cached status and owner reset/removal clears attributes', async () => {
  const source = (await readFile(new URL('../src/web-media-readiness.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replaceAll('export function ', 'function ');
  const video = { dataset: {} }, tile = { dataset: { openMediaId: ID }, querySelectorAll: () => [video] };
  const state = { state: 'ready', reason: 'none', bytes: 1234, resources: 4, retry: 1, elapsedMs: 400, hits: 2, misses: 1 };
  const context = { document: { readyState: 'loading', addEventListener() {}, querySelectorAll: () => [tile] },
    sautiStreamReadinessState: () => state };
  const api = vm.runInNewContext(`${source}\n({diagnoseTile,readinessChanged});`, context);
  api.diagnoseTile(tile); assert.equal(video.dataset.sautiWarmState, 'ready'); assert.equal(video.dataset.sautiWarmBytes, '1234');
  assert.equal(video.dataset.sautiWarmHits, '2'); assert.equal(tile.dataset.sautiWarmReason, 'none');
  api.readinessChanged({ detail: { mediaId: ID, state: null } });
  assert.deepEqual(video.dataset, {}); assert.deepEqual(tile.dataset, { openMediaId: ID });
  applyStreamReadinessDiagnostics(video, { ...state, reason: 'https://secret.invalid/token', url: 'capability', bytes: Infinity });
  assert.equal(video.dataset.sautiWarmReason, 'none'); assert.doesNotMatch(JSON.stringify(video.dataset), /https|secret|capability/);
  applyStreamReadinessDiagnostics(video, null); assert.deepEqual(video.dataset, {});
});
