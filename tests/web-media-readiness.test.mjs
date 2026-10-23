import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createMediaPreviewQueue, readMediaPreviewBlob, mediaPreviewPriority, setMediaPreviewPlaybackWaiting } from '../src/media-preview-queue.js';
import { nextMediaReadinessItems } from '../src/web-media-readiness.js';
import { bindVideoBuffering } from '../src/video-buffering-state.js';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const tick = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; }
function extract(source, start, end) { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a); return source.slice(a, b); }

test('five-item readiness advances with the viewport, excludes the current item, and never grows with the feed', () => {
  const items = Array.from({ length: 1000 }, (_, id) => ({ id }));
  assert.deepEqual(nextMediaReadinessItems(items, 0).map((x) => x.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(nextMediaReadinessItems(items, 400).map((x) => x.id), [401, 402, 403, 404, 405]);
  assert.deepEqual(nextMediaReadinessItems(items, 998).map((x) => x.id), [999]);
  assert.deepEqual(nextMediaReadinessItems(items, -1), []);
});

test('player clock updates do not repeatedly re-index a long feed, but tile insertion and removal do', async () => {
  const source = (await read('src/web-media-readiness.js'))
    .replace(/^import .*;\r?\n/gm, '').replaceAll('export function ', 'function ');
  const observers = [], observed = new Set(), queued = [];
  const tile = () => ({ nodeType: 1, dataset: {}, matches: () => true, querySelector: () => null });
  let tiles = Array.from({ length: 1000 }, tile), scans = 0;
  const feed = { querySelectorAll() { scans++; return tiles; } };
  const doc = { readyState: 'loading', documentElement: {}, body: {}, addEventListener() {},
    getElementById(id) { return id === 'stream-feed' ? feed : null; } };
  runInNewContext(`${source}\ninstallHomeMediaReadiness();`, {
    document: doc, updateSautiStreamReadiness() {}, wakeMediaPreviewRequests() {},
    STREAM_READINESS_AHEAD: 5, queueMicrotask(fn) { queued.push(fn); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { observers.push({ target, callback: this.callback }); }
    },
    IntersectionObserver: class {
      observe(item) { observed.add(item); }
      unobserve(item) { observed.delete(item); }
    },
  });
  assert.equal(scans, 1); assert.equal(observed.size, 1000);
  const notify = observers.find((item) => item.target === feed).callback;
  for (let i = 0; i < 1000; i++) notify([{ addedNodes: [{ nodeType: 3 }], removedNodes: [{ nodeType: 3 }] }]);
  assert.equal(scans, 1, 'timeupdate text must not scan the entire feed');
  const control = { nodeType: 1, matches: () => false, querySelector: () => null };
  notify([{ addedNodes: [control], removedNodes: [] }]); assert.equal(scans, 1);
  const added = tile(); tiles = [...tiles, added];
  const card = { nodeType: 1, matches: () => false, querySelector: () => added };
  notify([{ addedNodes: [card], removedNodes: [] }]);
  assert.equal(scans, 2); assert.equal(observed.size, 1001); assert.ok(observed.has(added));
  tiles = tiles.filter((item) => item !== added);
  notify([{ addedNodes: [], removedNodes: [card] }]);
  assert.equal(scans, 3); assert.equal(observed.size, 1000); assert.ok(!observed.has(added));
  assert.equal(queued.length, 1, 'structural changes join the existing pending refresh');
});

test('unchanged readiness windows keep their tile markers and remove only departed tiles', async () => {
  const source = (await read('src/web-media-readiness.js'))
    .replace(/^import .*;\r?\n/gm, '').replaceAll('export function ', 'function ');
  const writes = [], removals = [];
  const tile = (id) => ({ dataset: new Proxy({}, {
    set(object, key, value) { writes.push(id); object[key] = value; return true; },
    deleteProperty(object, key) { removals.push(id); delete object[key]; return true; },
  }) });
  const a = tile('a'), b = tile('b'), c = tile('c');
  const mark = runInNewContext(`${source}\nmarkPreparedTiles;`, { wakeMediaPreviewRequests() {} });
  mark([a, b]); mark([a, b]);
  assert.deepEqual(writes, ['a', 'b']); assert.deepEqual(removals, []);
  mark([b, c]); assert.deepEqual(writes, ['a', 'b', 'c']); assert.deepEqual(removals, ['a']);
  mark([]); assert.deepEqual(removals, ['a', 'b', 'c']);
});

test('preview slots cover body completion and failures cannot strand the next image behind a slot', async () => {
  const queue = createMediaPreviewQueue(2), gates = [deferred(), deferred(), deferred()];
  const starts = [], tasks = gates.map((gate, index) => queue(async () => { starts.push(index); await gate.promise; if (index === 1) throw new Error('offline'); return index; }).catch((error) => error.message));
  await tick(); assert.deepEqual(starts, [0, 1]);
  gates[1].resolve(); await tick(); assert.deepEqual(starts, [0, 1, 2]);
  gates[0].resolve(); gates[2].resolve(); assert.deepEqual(await Promise.all(tasks), [0, 'offline', 2]);
});

test('preview bodies have an actual streamed byte cap even without Content-Length', async () => {
  let cancelled = 0;
  const oversized = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled++; } }));
  await assert.rejects(readMediaPreviewBlob(oversized, 4), /TOO_LARGE/); assert.equal(cancelled, 1);
  await assert.rejects(readMediaPreviewBlob(new Response('12345', { headers: { 'Content-Length': '5' } }), 4), /TOO_LARGE/);
  const blob = await readMediaPreviewBlob(new Response('1234', { headers: { 'Content-Type': 'image/webp' } }), 4);
  assert.equal(blob.size, 4); assert.equal(blob.type, 'image/webp');
});

test('visible images bypass parked offscreen tasks and an aborted offscreen body resumes only when wanted again', async () => {
  const queue = createMediaPreviewQueue(1), starts = [], finish = deferred();
  let offscreenPriority = 1, attempts = 0;
  const parked = queue(async (signal) => {
    starts.push(`old-${++attempts}`);
    if (attempts === 1) await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('offscreen')), { once: true }));
    else return 'prepared';
  }, { priority: () => offscreenPriority });
  await tick(); offscreenPriority = Infinity;
  const visible = queue(async () => { starts.push('visible'); await finish.promise; return 'current'; }, { priority: () => 0 });
  await tick(); assert.deepEqual(starts, ['old-1', 'visible']);
  finish.resolve(); assert.equal(await visible, 'current'); await tick(); assert.equal(attempts, 1);
  offscreenPriority = 1; queue.wake(); assert.equal(await parked, 'prepared'); assert.equal(attempts, 2);
});

test('owner-changed queued preview work is cancelled before opening its network request', async () => {
  const queue = createMediaPreviewQueue(1), active = deferred(); let owner = 'A', opened = 0;
  const first = queue(() => active.promise);
  const old = queue(() => { opened++; }, { isCurrent: () => owner === 'A' }).catch((error) => error.message);
  owner = 'B'; queue.wake(); assert.equal(await old, 'MEDIA_PREVIEW_CANCELLED'); assert.equal(opened, 0);
  active.resolve(); await first;
});

test('buffering video gets network priority over future posters while visible images remain available', () => {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const current = { isConnected: true, paused: true, ended: false, error: null, dataset: { sautiPreparing: 'true' } };
  const tile = (top) => ({ isConnected: true, dataset: { sautiReadiness: 'true' }, closest: () => null,
    getBoundingClientRect: () => ({ top, bottom: top + 200 }) });
  try {
    globalThis.document = { visibilityState: 'visible', querySelector: () => null,
      documentElement: { classList: { contains: () => false } } };
    globalThis.window = { innerHeight: 720 };
    assert.equal(mediaPreviewPriority(tile(1000)), 1);
    setMediaPreviewPlaybackWaiting(current, true);
    assert.equal(mediaPreviewPriority(tile(1000)), Infinity, 'offscreen poster must wait for first frame');
    assert.equal(mediaPreviewPriority(tile(100)), 0, 'visible image must still be able to load');
    setMediaPreviewPlaybackWaiting(current, false);
    assert.equal(mediaPreviewPriority(tile(1000)), 1, 'normal preparation resumes when playback is ready');
    setMediaPreviewPlaybackWaiting(current, true); current.isConnected = false;
    assert.equal(mediaPreviewPriority(tile(1000)), 1, 'removed player cannot strand the queue');
  } finally {
    setMediaPreviewPlaybackWaiting(current, false);
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

function fakeVideo() {
  const listeners = new Map();
  return { listeners, duration: NaN, paused: false, ended: false, error: null, isConnected: true, readyState: 1, loads: 0,
    addEventListener(name, callback) { const set = listeners.get(name) || new Set(); set.add(callback); listeners.set(name, set); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name) { for (const callback of [...(listeners.get(name) || [])]) callback(); },
    removeAttribute(name) { this[name] = ''; }, load() { this.loads++; },
  };
}
function timerFixture() {
  const timers = new Map(); let id = 0;
  return { timers, setTimer(callback, delay) { timers.set(++id, { callback, delay }); return id; }, clearTimer(value) { timers.delete(value); },
    fire(delay) { const entry = [...timers].find(([, item]) => item.delay === delay); assert.ok(entry, `missing timer ${delay}`); timers.delete(entry[0]); entry[1].callback(); } };
}

test('buffering waits briefly, cancels speculative work immediately, and never animates a user pause or an error', () => {
  const video = fakeVideo(), clock = timerFixture(), changes = [];
  const dispose = bindVideoBuffering(video, (...args) => changes.push(args), clock);
  video.emit('waiting'); assert.deepEqual(changes.at(-1), [true, false]);
  video.emit('waiting'); assert.equal(clock.timers.size, 1);
  clock.fire(180); assert.deepEqual(changes.at(-1), [true, true]);
  video.paused = true; video.emit('pause'); assert.deepEqual(changes.at(-1), [false, false]);
  video.emit('waiting'); assert.equal(clock.timers.size, 0);
  video.paused = false; video.emit('waiting'); video.error = {}; video.emit('error'); assert.equal(clock.timers.size, 0);
  assert.deepEqual(changes.at(-1), [false, false]); dispose();
  assert.equal([...video.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
});

test('a fast first frame avoids a loading flash; a disconnected player cannot show a delayed overlay', () => {
  const video = fakeVideo(), clock = timerFixture(), changes = [];
  bindVideoBuffering(video, (...args) => changes.push(args), clock);
  video.emit('waiting'); video.emit('playing'); assert.equal(clock.timers.size, 0);
  assert.ok(!changes.some(([, shown]) => shown));
  video.emit('waiting'); video.isConnected = false; clock.fire(180); assert.deepEqual(changes.at(-1), [false, false]);
});

async function durationHarness(container = async () => null) {
  const formats = await read('src/composer-formats.js'), video = fakeVideo(), clock = timerFixture(), revoked = [];
  let created = 0;
  const duration = runInNewContext(`${extract(formats, 'async function videoDuration(', 'function formatTrimTime(')}\nvideoDuration;`, {
    readPostVideoContainerDuration: container, AbortController,
    window: { setTimeout: clock.setTimer, clearTimeout: clock.clearTimer },
    document: { createElement(name) { assert.equal(name, 'video'); created++; return video; } },
    URL: { createObjectURL() { return 'blob:local-selected-file'; }, revokeObjectURL(value) { revoked.push(value); } },
  });
  return { duration, video, clock, revoked, created: () => created };
}

test('valid container metadata prepares a mobile codec without allocating a browser decoder', async () => {
  const h = await durationHarness(async () => 180.001);
  assert.equal(await h.duration({}), 180.001, 'long duration must still reach the trim gate');
  assert.equal(h.created(), 0); assert.equal(h.clock.timers.size, 0); assert.equal(h.revoked.length, 0);
});

test('initial Infinity or NaN browser metadata waits for durationchange and cleans every resource exactly once', async () => {
  for (const value of [Infinity, NaN]) {
    const h = await durationHarness(); let settled = false;
    const result = h.duration({}).then((duration) => { settled = true; return duration; }); await tick();
    h.video.duration = value; h.video.emit('loadedmetadata'); await tick(); assert.equal(settled, false);
    h.video.duration = 12.5; h.video.emit('durationchange'); assert.equal(await result, 12.5);
    assert.deepEqual(h.revoked, ['blob:local-selected-file']); assert.equal(h.clock.timers.size, 0);
    assert.equal([...h.video.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
    h.video.emit('error'); h.video.emit('loadedmetadata'); assert.equal(h.revoked.length, 1);
  }
});

test('unknown or broken browser timing fails on a bounded deadline without guessing an upload duration', async () => {
  const h = await durationHarness(); const pending = h.duration({}); await tick();
  h.clock.fire(8000); assert.equal(await pending, null); assert.equal(h.revoked.length, 1);
});

test('transformed preview queue discards an old account body before creating any object URL', async () => {
  const raw = await read('src/app.js');
  const runtime = transformMediaPerformanceSource('/repo/src/app.js', transformPostMediaSource('/repo/src/app.js', raw));
  const body = deferred(), started = deferred(), urls = [];
  const context = { currentMemberId: 'owner-A', runMediaPreviewRequest: createMediaPreviewQueue(2), readMediaPreviewBlob: async () => { started.resolve(); return body.promise; },
    currentAuthorizationHeader: async () => ({ Authorization: 'Bearer owner-A' }), mediaPreviewPriority: () => 0, AbortSignal,
    fetch: async () => ({ ok: true }), window: { location: { origin: 'https://sautilink.com' } },
    URL: class extends URL { static createObjectURL(blob) { urls.push(blob); return 'blob:old-owner'; } },
  };
  const fetchPreview = runInNewContext(`${extract(runtime, 'async function fetchSautiMediaBlobUrl(', 'async function loadSautiVideoPoster(')}\nfetchSautiMediaBlobUrl;`, context);
  const pending = fetchPreview('11111111-1111-4111-8111-111111111111'); await started.promise;
  context.currentMemberId = 'owner-B'; body.resolve(new Blob(['old private image']));
  await assert.rejects(pending, /CANCELLED/); assert.equal(urls.length, 0);
});
