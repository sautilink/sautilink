import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';
import { createMediaPreviewQueue } from '../src/media-preview-queue.js';

const ID = '11111111-1111-4111-8111-111111111111';
const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function runtime() {
  const path = new URL('../src/app.js', import.meta.url).pathname;
  return transformMediaPerformanceSource(path, transformPostMediaSource(path, await readFile(new URL('../src/app.js', import.meta.url), 'utf8')));
}
function extract(source, begin, end) {
  const start = source.indexOf(begin), finish = source.indexOf(end, start);
  assert.ok(start >= 0 && finish > start); return source.slice(start, finish);
}

test('the actual transformed Home gallery keeps legacy video preload none through src assignment and final insertion', async () => {
  const code = extract(await runtime(), 'async function hydrateSautiMediaGallery(', 'function openSautiMediaViewer(');
  const requests = [], videos = [];
  class Element {
    constructor(kind) { this.kind = kind; this.dataset = {}; this.children = []; this.style = { setProperty() {} };
      this.classList = { add() {}, remove() {} }; this.attributes = {}; this.isConnected = true; }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(child) { this.children.push(child); child.parentNode = this; }
    replaceChildren(...children) { this.children = []; for (const child of children) this.append(child); }
    closest() { return { classList: this.classList, querySelector: () => ({}) }; }
  }
  class Video extends Element {
    constructor() { super('video'); this.preload = 'auto'; this.paused = true; this.assignments = []; videos.push(this); }
    set src(value) { this._src = value; this.assignments.push({ preload: this.preload, src: value }); }
    get src() { return this._src; }
    play() { this.paused = false; requests.push(this.src); return Promise.resolve(); }
  }
  const gallery = new Element('gallery'); gallery.parentNode = {};
  const hydrate = vm.runInNewContext(`${code}\nhydrateSautiMediaGallery;`, {
    document: { createElement: (kind) => kind === 'video' ? new Video() : new Element(kind) }, HTMLVideoElement: Video,
    window: { SautiLinkVideoQuality: { registerMedia() {}, qualityFor: () => 'original' } },
    getVideoAutoplayPreference: () => true,
    loadSautiMediaRows: async () => [{ id: ID, media_kind: 'video', width: 720, height: 1280 }],
    waitForSautiMediaNearViewport: async () => {}, selectSautiMediaVariantWidth: () => 0,
    fetchSautiVideoStreamUrl: async (id) => `/api/sauti-media/${id}`,
    fetchSautiMediaBlobUrl() { throw new Error('rendering must not download the whole video'); },
    loadSautiVideoPoster: async () => {}, observeHomeFeedVideo() {}, enableSautiVideoBlobFallback() {}, URL,
  });
  await hydrate(ID, gallery);
  assert.equal(videos.length, 1); assert.equal(gallery.children[0].children[0], videos[0]);
  assert.equal(videos[0].assignments[0].preload, 'none');
  assert.equal(videos[0].preload, 'none', 'a later autoplay default must not overwrite the preload guard');
  assert.deepEqual(requests, []);
  await videos[0].play(); assert.deepEqual(requests, [`/api/sauti-media/${ID}`], 'legacy fallback still starts from an actual play');
});

async function fallbackHarness() {
  const source = await runtime(), timers = new Map(), listeners = new Map(), requests = [], revoked = [];
  let nextTimer = 0, eligible = true, reads = 0;
  const queue = createMediaPreviewQueue(2);
  const button = { dataset: {}, isConnected: true };
  const video = { src: `/api/sauti-media/${ID}`, paused: true, readyState: 0, dataset: {}, isConnected: true,
    addEventListener(name, callback) { const entries = listeners.get(name) || []; entries.push(callback); listeners.set(name, entries); },
    load() {}, dispatchEvent() {},
  };
  const context = { currentMemberId: 'owner-A', runMediaPreviewRequest: queue, AbortSignal,
    currentAuthorizationHeader: async () => ({ Authorization: 'Bearer owner-A' }), mediaPreviewPriority: () => 0,
    readMediaPreviewBlob: async () => { reads++; return new Blob(['video']); },
    fetch: async (url) => { requests.push(url); return { ok: true }; },
    window: { location: { origin: 'https://sautilink.com' },
      SautiLinkStreamPlayback: { eligible: () => eligible },
      setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout(id) { timers.delete(id); } },
    URL: class extends URL { static createObjectURL() { return 'blob:legacy'; } static revokeObjectURL(url) { revoked.push(url); } },
    CustomEvent: class { constructor(type) { this.type = type; } },
    getVideoAutoplayPreference: () => true, syncHomeFeedVideoPlayback() {},
  };
  const helpers = extract(source, 'async function fetchSautiMediaBlobUrl(', 'async function loadSautiVideoPoster(')
    + extract(source, 'function enableSautiVideoBlobFallback(', 'function revokeHomeFeedMediaObjectUrls(');
  const scope = { ...context, video, button, id: ID };
  vm.runInNewContext(`${helpers}\nenableSautiVideoBlobFallback(video,button,id);`, scope);
  return { video, button, requests, queue, revoked, timers, scope, reads: () => reads,
    event(name, detail) { for (const callback of listeners.get(name) || []) callback({ detail }); },
    eligible(value) { eligible = value; },
    async fire() { const pending = [...timers]; timers.clear(); for (const [, callback] of pending) await callback(); await flush(); },
  };
}

test('rendered idle or offscreen videos never arm a whole-MP4 fallback timer', async () => {
  const h = await fallbackHarness();
  assert.equal(h.timers.size, 0); await h.fire(); assert.deepEqual(h.requests, []);
  h.video.paused = false; h.eligible(false); h.event('play'); h.event('waiting');
  assert.equal(h.timers.size, 0); assert.deepEqual(h.requests, []);
});

test('a visible legacy metadata failure falls back, and pause cancels then permits a later legitimate retry', async () => {
  const h = await fallbackHarness();
  h.video.paused = false; h.event('play'); assert.equal(h.timers.size, 1);
  h.video.paused = true; h.event('pause'); assert.equal(h.timers.size, 0);
  h.video.paused = false; h.event('play'); assert.equal(h.timers.size, 1);
  await h.fire(); assert.equal(h.requests.length, 1); assert.equal(h.reads(), 1);
  assert.equal(h.video.src, 'blob:legacy'); assert.equal(h.button.dataset.mediaStreaming, 'blob-fallback');
});

test('a fallback parked behind preview bodies cannot open a request after adaptive attachment', async () => {
  const h = await fallbackHarness(), first = deferred(), second = deferred();
  const occupied = [h.queue(() => first.promise), h.queue(() => second.promise)]; await flush();
  h.video.paused = false; h.event('play');
  const firing = h.fire(); await flush();
  h.video.dataset.sautiStreamManaged = 'true'; h.event('sautilink:video-quality-applied');
  first.resolve(); second.resolve(); await Promise.all(occupied); await firing;
  assert.deepEqual(h.requests, []); assert.equal(h.reads(), 0); assert.notEqual(h.video.src, 'blob:legacy');
});

test('fallback intent is checked again after authorization and after the body, before network or blob commitment', async () => {
  const auth = await fallbackHarness(), authorization = deferred();
  auth.scope.currentAuthorizationHeader = () => authorization.promise;
  auth.video.paused = false; auth.event('play');
  const authorizing = auth.fire(); await flush();
  auth.video.dataset.sautiStreamManaged = 'true';
  authorization.resolve({ Authorization: 'Bearer owner-A' }); await authorizing;
  assert.deepEqual(auth.requests, []);

  const body = await fallbackHarness(), bytes = deferred();
  body.scope.readMediaPreviewBlob = () => bytes.promise;
  body.video.paused = false; body.event('play');
  const downloading = body.fire(); await flush(); assert.equal(body.requests.length, 1);
  body.video.readyState = 4; body.event('loadedmetadata');
  bytes.resolve(new Blob(['late original MP4'])); await downloading;
  assert.equal(body.video.src, `/api/sauti-media/${ID}`);
  assert.equal(body.button.dataset.mediaObjectUrl, undefined);
});
