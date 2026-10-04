import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import router from '../src/asset-router.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const app = await read('src/app.js');
const shorts = await read('src/short-videos-feed.js');

function playbackHarness() {
  const source = app.slice(
    app.indexOf('function pauseHomeFeedVideos()'),
    app.indexOf('function ensureHomeVideoObserver()'),
  );
  let resolvePlay;
  let dialogOpen = false;
  let autoplayEnabled = true;
  const video = {
    isConnected: true,
    paused: true,
    dataset: {},
    pause() { this.paused = true; this.pauses = (this.pauses || 0) + 1; },
    play() {
      this.paused = false;
      return new Promise((resolve) => { resolvePlay = resolve; });
    },
  };
  const location = { pathname: '/home' };
  const streamSurface = { hidden: false };
  const memberView = { hidden: false };
  const context = {
    window: { location },
    document: {
      visibilityState: 'visible',
      body: { classList: { contains: () => false } },
      documentElement: { classList: { contains: () => false } },
      querySelector: () => dialogOpen ? { open: true } : null,
    },
    streamSurface,
    memberView,
    homeVideoVisibility: new Map([[video, 0.9]]),
    homeVideoObserver: null,
    HOME_VIDEO_VISIBILITY_THRESHOLD: 0.58,
    getVideoAutoplayPreference: () => autoplayEnabled,
  };
  runInNewContext(`${source}\nthis.playback = { canPlayHomeFeedVideos, syncHomeFeedVideoPlayback, playHomeFeedVideo };`, context);
  return { ...context.playback, video, location, streamSurface, memberView,
    resolvePlay: () => resolvePlay(),
    setDialogOpen: (value) => { dialogOpen = value; },
    setAutoplayEnabled: (value) => { autoplayEnabled = value; },
  };
}

test('Home does not start a visible video when autoplay is off', () => {
  const state = playbackHarness();
  state.setAutoplayEnabled(false);
  state.syncHomeFeedVideoPlayback();
  assert.equal(state.video.paused, true);
  assert.equal(state.video.pauses || 0, 0);
});

test('Home video stops on feature navigation and an in-flight play cannot restart it', async () => {
  const state = playbackHarness();
  const pending = state.playHomeFeedVideo(state.video);
  state.location.pathname = '/notifications';
  state.streamSurface.hidden = true;
  state.syncHomeFeedVideoPlayback();
  state.resolvePlay();
  await pending;
  assert.equal(state.video.paused, true);
  assert.equal(state.canPlayHomeFeedVideos(), false);
});

test('post composer and other dialogs block video until the user returns to Home', async () => {
  const state = playbackHarness();
  state.setDialogOpen(true);
  state.syncHomeFeedVideoPlayback();
  assert.equal(state.canPlayHomeFeedVideos(), false);
  assert.equal(state.video.paused, true);
  state.setDialogOpen(false);
  state.location.pathname = '/compose';
  assert.equal(state.canPlayHomeFeedVideos(), false);
  state.location.pathname = '/home';
  assert.equal(state.canPlayHomeFeedVideos(), true);
});

test('composer URL follows open, close, direct loading and browser Back', () => {
  const code = app.slice(app.indexOf('function openSautiComposer('), app.indexOf('function syncComposerOnlineState()'));
  const location = { pathname: '/home' };
  const calls = [];
  const history = {
    state: {},
    pushState(state, _title, path) { this.state = state; location.pathname = path; calls.push(['push', path]); },
    replaceState(state, _title, path) { this.state = state; location.pathname = path; calls.push(['replace', path]); },
    back() { location.pathname = '/home'; calls.push(['back']); },
  };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const bodyClasses = new Set();
  const nodes = {
    'sauti-composer-dialog': dialog,
    'sauti-composer': { hidden: true },
    'composer-drafts': { hidden: false },
    'sauti-drafts-toggle': { setAttribute() {} },
  };
  const context = {
    window: { location, history, setTimeout() {}, dispatchEvent() { calls.push(['routechange']); } },
    Event: class {},
    document: { activeElement: null, body: { classList: {
      add: (name) => bodyClasses.add(name), remove: (name) => bodyClasses.delete(name),
    } } },
    HTMLElement: class {},
    byId: (id) => nodes[id],
    currentMember: { id: 'member-id' },
    composerRestoreFocus: null,
    pauseHomeFeedVideos: () => calls.push(['pause']),
    syncHomeFeedVideoPlayback: () => calls.push(['sync']),
  };
  runInNewContext(`${code}\nthis.composer = { openSautiComposer, closeSautiComposer };`, context);

  context.composer.openSautiComposer({ focus: false });
  assert.equal(location.pathname, '/compose');
  assert.equal(dialog.open, true);
  assert.equal(bodyClasses.has('composer-open'), true);
  assert.equal(calls[0][0], 'pause');
  context.composer.closeSautiComposer({ restoreFocus: false });
  assert.equal(location.pathname, '/home');
  assert.equal(calls.some(([kind]) => kind === 'back'), true);

  location.pathname = '/compose';
  history.state = {};
  context.composer.openSautiComposer({ focus: false });
  context.composer.closeSautiComposer({ restoreFocus: false });
  assert.equal(location.pathname, '/home');
  assert.deepEqual(calls.at(-2), ['replace', '/home']);

  context.composer.openSautiComposer({ focus: false });
  const backsBefore = calls.filter(([kind]) => kind === 'back').length;
  location.pathname = '/home';
  context.composer.closeSautiComposer({ restoreFocus: false, syncUrl: false });
  assert.equal(calls.filter(([kind]) => kind === 'back').length, backsBefore);
});

test('Short Videos pauses when covered by a feature or when its route is left', () => {
  const policy = shorts.slice(
    shorts.indexOf('function shortVideoPlaybackAllowed('),
    shorts.indexOf('function currentShortVideoReturnPath()'),
  );
  const location = { pathname: '/videos/video-id' };
  let dialogOpen = false;
  const context = {
    window: { location },
    document: { visibilityState: 'visible', querySelector: () => dialogOpen ? {} : null },
    SHORT_VIDEO_ROUTE: /^\/videos(?:\/[^/]+)?$/,
  };
  runInNewContext(`${policy}\nthis.allowed = shortVideoPlaybackAllowed;`, context);
  const root = { hidden: false };
  assert.equal(context.allowed(root), true);
  dialogOpen = true;
  assert.equal(context.allowed(root), false);
  dialogOpen = false;
  location.pathname = '/compose';
  assert.equal(context.allowed(root), false);
  location.pathname = '/videos/video-id';
  context.document.visibilityState = 'hidden';
  assert.equal(context.allowed(root), false);
  assert.match(shorts, /window\.addEventListener\('sautilink:routechange', syncShortVideoForeground\)/);
});

test('direct /compose request serves the app shell and the route survives a reload', async () => {
  const requested = [];
  for (const path of ['/compose', '/app/compose']) {
    const response = await router.fetch(
      new Request(`https://sautilink.com${path}`),
      { ASSETS: { fetch(request) { requested.push(new URL(request.url).pathname); return new Response('app shell'); } } },
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'app shell');
  }
  assert.deepEqual(requested, ['/app/', '/app/']);

  const [config, sw, redirects] = await Promise.all([
    read('wrangler.production.jsonc'), read('sw.js'), read('_redirects'),
  ]);
  assert.match(config, /sautilink\.com\/compose\*/);
  assert.match(config, /www\.sautilink\.com\/compose\*/);
  assert.match(sw, /home\|compose\|discover/);
  assert.match(redirects, /\/compose \/app\/ 200/);
  assert.match(app, /openSautiComposer\(\{ focus: false \}\)/);
  assert.match(app, /window\.history\.back\(\)/);
});
