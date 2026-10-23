import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
function block(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing actual runtime block: ${start}`);
  return source.slice(a, b);
}

test('the transformed gallery exposes only bounded authorized video duration before any protected bytes are ready', async () => {
  const path = '/repo/src/app.js';
  const source = transformMediaPerformanceSource(path, transformPostMediaSource(path, await read('src/app.js')));
  const code = block(source, 'async function hydrateSautiMediaGallery(', 'function openSautiMediaViewer(');
  let release, byteRequests = 0;
  const viewport = new Promise((resolve) => { release = resolve; });
  class Element {
    constructor(kind) {
      this.kind = kind; this.dataset = {}; this.children = []; this.style = { setProperty() {} };
      this.classList = { add() {}, remove() {} }; this.isConnected = true;
    }
    setAttribute() {}
    append(child) { this.children.push(child); child.parentNode = this; }
    replaceChildren(...children) { this.children = []; for (const child of children) this.append(child); }
    closest() { return { classList: this.classList, querySelector: () => ({}) }; }
  }
  class Video extends Element { constructor() { super('video'); } }
  const gallery = new Element('gallery'); gallery.parentNode = {};
  const values = [8000, 180000, 180001, -1, 0, Infinity, 7.5, '8000'];
  const rows = values.map((duration_ms, index) => ({ id: `video-${index}`, media_kind: 'video', duration_ms }));
  rows.push({ id: 'image', media_kind: 'image', duration_ms: 8000 });
  const hydrate = vm.runInNewContext(`${code}\nhydrateSautiMediaGallery;`, {
    document: { createElement: (kind) => kind === 'video' ? new Video() : new Element(kind) }, HTMLVideoElement: Video,
    window: { SautiLinkVideoQuality: { registerMedia() {}, qualityFor: () => 'original' } },
    getVideoAutoplayPreference: () => true, loadSautiMediaRows() { assert.fail('prefetched authorized rows must be reused'); },
    waitForSautiMediaNearViewport: () => viewport, selectSautiMediaVariantWidth: () => 0,
    fetchSautiVideoStreamUrl: async (id) => { byteRequests++; return `/api/sauti-media/${id}`; },
    fetchSautiMediaBlobUrl: async () => { byteRequests++; return 'blob:image'; },
    loadSautiVideoPoster: async () => {}, observeHomeFeedVideo() {}, enableSautiVideoBlobFallback() {}, URL,
  });
  const pending = hydrate('post', gallery, rows);
  assert.equal(byteRequests, 0);
  assert.deepEqual(gallery.children.map((tile) => tile.dataset.mediaDurationMs),
    ['8000', '180000', undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  release(); await pending;
  assert.equal(gallery.children[0].dataset.mediaDurationMs, '8000');
});

async function hud({ metadata = '8000' } = {}) {
  const source = await read('src/sautilink-video-player.js');
  const attrs = {}, listeners = {};
  const state = { native: NaN, position: 0, writes: 0, readyState: 0, attributeWrites: 0, textWrites: 0 };
  const video = { dataset: {}, paused: true, src: 'blob:unchanged',
    get duration() { return state.native; }, set duration(_) { assert.fail('HUD must never assign native duration'); },
    get currentTime() { return state.position; }, set currentTime(value) { state.writes++; state.position = value; },
    get readyState() { return state.readyState; }, set readyState(_) { assert.fail('HUD must never invent playback readiness'); },
    play() { assert.fail('a duration label must not start playback'); }, load() { assert.fail('a duration label must not reload media'); } };
  const host = { dataset: { mediaDurationMs: metadata } };
  const timeline = { getAttribute(name) { return attrs[name] ?? null; },
    setAttribute(name, value) { state.attributeWrites++; attrs[name] = value; }, addEventListener(name, fn) { listeners[name] = fn; },
    getBoundingClientRect: () => ({ left: 0, width: 100 }) };
  let timeText = '';
  const time = { get textContent() { return timeText; }, set textContent(value) { state.textWrites++; timeText = value; } };
  const scope = vm.createContext({ video, host, timeline, time,
    played: { style: {} }, thumb: { style: {} }, VIDEO_SEEK_SECONDS: 5, showControls() {} });
  const constant = source.match(/const MAX_VIDEO_METADATA_DURATION_MS = \d+;/)?.[0];
  assert.ok(constant);
  vm.runInContext(constant + '\n' + block(source, 'function formatVideoTime(', 'function playerHostFor(')
    + block(source, '  const syncTimeline = () => {', '  const syncBuffered = () => {')
    + block(source, '  const seekFromTimelinePointer = (event) => {', '  const requestFullscreen = () => {')
    + block(source, "  timeline.addEventListener('keydown'", "  gesture.addEventListener('pointerdown'")
    + '\nthis.sync = syncTimeline; this.seek = seekFromTimelinePointer; this.seekBy = seekVideoBy; this.display = displayVideoDuration;', scope);
  return { scope, state, attrs, listeners, video, host };
}

test('known duration decorates the real HUD immediately without enabling native seeking or fabricating readiness', async () => {
  const h = await hud();
  h.scope.sync();
  assert.equal(h.scope.time.textContent, '0:00 / 0:08');
  assert.equal(h.attrs['aria-disabled'], 'true'); assert.equal(h.attrs['aria-valuemax'], '0');
  assert.equal(h.scope.played.style.transform, 'scaleX(0)');
  h.scope.seek({ clientX: 50 }); h.scope.seekBy(h.video, 5);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) h.listeners.keydown({ key, preventDefault() {}, stopPropagation() {} });
  assert.equal(h.state.writes, 0); assert.equal(h.video.readyState, 0); assert.ok(Number.isNaN(h.video.duration));
  assert.equal(h.video.src, 'blob:unchanged'); assert.equal(h.video.paused, true);

  h.state.native = 10.5; h.state.readyState = 1; h.state.position = 2;
  h.scope.sync();
  assert.equal(h.scope.time.textContent, '0:02 / 0:10', 'actual media metadata replaces the earlier row label');
  assert.equal(h.attrs['aria-disabled'], 'false'); assert.equal(h.attrs['aria-valuemax'], '11');
  h.scope.seek({ clientX: 50 }); assert.equal(h.video.currentTime, 5.25);
  h.listeners.keydown({ key: 'End', preventDefault() {}, stopPropagation() {} });
  assert.equal(h.video.currentTime, 10.5);
});

test('display metadata rejects malformed, nonfinite, nonpositive and out-of-policy durations; native duration always wins', async () => {
  const h = await hud();
  for (const value of ['', '0', '-1', 'Infinity', 'NaN', '180001', '8.5', '1e4', '0x1000', ' 8000 ', 'not-a-duration']) {
    h.host.dataset.mediaDurationMs = value; h.scope.sync();
    assert.equal(h.scope.time.textContent, '0:00 / 0:00', value);
    assert.equal(h.attrs['aria-disabled'], 'true');
  }
  h.host.dataset.mediaDurationMs = '180000'; h.scope.sync();
  assert.equal(h.scope.time.textContent, '0:00 / 3:00');
  h.state.native = 600; h.scope.sync();
  assert.equal(h.scope.time.textContent, '0:00 / 10:00', 'the display-only metadata bound never truncates real legacy media');
});

test('repeated media clocks keep text and accessibility nodes stable within a displayed second while the progress line advances', async () => {
  const h = await hud(); h.state.native = 10; h.state.position = 1.1; h.scope.sync();
  const attributes = h.state.attributeWrites, texts = h.state.textWrites;
  const earlierFill = h.scope.played.style.transform;
  h.scope.sync(); h.state.position = 1.2; h.scope.sync();
  assert.equal(h.state.attributeWrites, attributes, 'unchanged ARIA must not wake global adapters on each clock');
  assert.equal(h.state.textWrites, texts, 'unchanged displayed seconds must not replace text nodes');
  assert.notEqual(h.scope.played.style.transform, earlierFill, 'the visual progress line continues moving');
  h.state.position = 2.1; h.scope.sync();
  assert.equal(h.state.textWrites, texts + 1); assert.equal(h.scope.time.textContent, '0:02 / 0:10');
  assert.equal(h.attrs['aria-valuenow'], '2'); assert.equal(h.video.readyState, 0);
});
