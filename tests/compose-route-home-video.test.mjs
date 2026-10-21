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
    app.indexOf('function clearHomeFeedMediaState()'),
  );
  const conversationRouteSource = app.slice(app.indexOf('function readConversationRoute('), app.indexOf('function threadDraftKey('));
  let resolvePlay;
  let dialogOpen = false;
  let autoplayEnabled = true;
  const bodyClasses = new Set();
  const rootClasses = new Set();
  const listeners = new Map();
  const video = {
    isConnected: true,
    paused: true,
    dataset: {},
    addEventListener(type, callback) { listeners.set(type, callback); },
    pause() { this.paused = true; this.pauses = (this.pauses || 0) + 1; },
    play() {
      this.paused = false;
      listeners.get('play')?.();
      return new Promise((resolve) => { resolvePlay = resolve; });
    },
  };
  const location = { pathname: '/home', search: '', get href() { return `https://sautilink.com${this.pathname}${this.search}`; } };
  const streamSurface = { hidden: false };
  const memberView = { hidden: false };
  const context = {
    window: { location },
    URL,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    document: {
      visibilityState: 'visible',
      body: { classList: { contains: (name) => bodyClasses.has(name) } },
      documentElement: { classList: { contains: (name) => rootClasses.has(name) } },
      querySelector: () => dialogOpen ? { open: true } : null,
    },
    streamSurface,
    memberView,
    homeVideoVisibility: new Map([[video, 0.9]]),
    homeVideoObserver: null,
    HOME_VIDEO_VISIBILITY_THRESHOLD: 0.58,
    HOME_VIDEO_PAUSE_THRESHOLD: 0.2,
    getVideoAutoplayPreference: () => autoplayEnabled,
    applyHomeVideoAudio: (target) => { target.muted ??= true; },
  };
  runInNewContext(`${source}\n${conversationRouteSource}\nthis.playback = { canPlayHomeFeedVideos, syncHomeFeedVideoPlayback, playHomeFeedVideo, observeHomeFeedVideo };`, context);
  return { ...context.playback, video, location, streamSurface, memberView,
    resolvePlay: () => resolvePlay(),
    setDialogOpen: (value) => { dialogOpen = value; },
    setAutoplayEnabled: (value) => { autoplayEnabled = value; },
    setVisibleRatio: (value) => context.homeVideoVisibility.set(video, value),
    setVisibility: (value) => { context.document.visibilityState = value; },
    bodyClasses, rootClasses,
  };
}

test('Home does not start a visible video when autoplay is off', () => {
  const state = playbackHarness();
  state.setAutoplayEnabled(false);
  state.syncHomeFeedVideoPlayback();
  assert.equal(state.video.paused, true);
  assert.equal(state.video.pauses || 0, 0);
});

test('readable and legacy single-post surfaces retain manual playback with autoplay disabled', async () => {
  const postId = '21a80dbf-bf8a-4efc-b1de-75e32cf55274';
  for (const path of [`/post/${postId}`, `/post/${postId}/`, `/app/sauti/${postId}`]) {
    const state = playbackHarness();
    state.location.pathname = path; state.location.search = '?view=post';
    state.setAutoplayEnabled(false);
    state.observeHomeFeedVideo(state.video, { closest: (selector) => selector === '#stream-feed' ? {} : null });
    state.setVisibleRatio(0.9);
    state.video.dataset.sautiManualPlay = 'true';
    const playing = state.video.play();
    state.resolvePlay(); await playing;
    state.syncHomeFeedVideoPlayback();
    assert.equal(state.canPlayHomeFeedVideos(), true, path);
    assert.equal(state.video.paused, false, 'The registered play guard must accept a visible authorized post surface');
    state.setVisibleRatio(0.1); state.syncHomeFeedVideoPlayback();
    assert.equal(state.video.paused, true, 'Scrolling away still stops manually played single-post video');
  }
});

test('single-post playback keeps background, dialog, signed-out and inactive-surface guards', () => {
  const postId = '21a80dbf-bf8a-4efc-b1de-75e32cf55274';
  const cases = [
    (state) => state.setVisibility('hidden'),
    (state) => state.setDialogOpen(true),
    (state) => { state.memberView.hidden = true; },
    (state) => { state.streamSurface.hidden = true; },
    (state) => state.bodyClasses.add('profile-editor-open'),
    (state) => state.rootClasses.add('sauti-short-videos-open'),
    (state) => { state.location.search = ''; }, // The comments route is a different surface.
    (state) => { state.location.pathname = '/post/not-a-post-id'; },
    (state) => { state.location.pathname = `/post/${postId}/extra`; },
    (state) => { state.location.pathname = '/messages'; },
  ];
  for (const cover of cases) {
    const state = playbackHarness();
    state.location.pathname = `/post/${postId}`; state.location.search = '?view=post';
    state.video.paused = false; cover(state); state.syncHomeFeedVideoPlayback();
    assert.equal(state.canPlayHomeFeedVideos(), false);
    assert.equal(state.video.paused, true);
  }
});

test('an in-flight single-post play cannot restart behind a dialog or after navigation', async () => {
  for (const cover of [(state) => state.setDialogOpen(true), (state) => { state.location.pathname = '/notifications'; }]) {
    const state = playbackHarness();
    state.location.pathname = '/post/21a80dbf-bf8a-4efc-b1de-75e32cf55274'; state.location.search = '?view=post';
    state.observeHomeFeedVideo(state.video, { closest: () => ({}) });
    const pending = state.playHomeFeedVideo(state.video);
    cover(state); state.syncHomeFeedVideoPlayback(); state.resolvePlay(); await pending;
    assert.equal(state.video.paused, true);
  }
});

test('a manually played Home video pauses after scrolling out of view with autoplay off', () => {
  const state = playbackHarness();
  state.setAutoplayEnabled(false);
  state.video.paused = false;
  state.setVisibleRatio(0.1);
  state.syncHomeFeedVideoPlayback();
  assert.equal(state.video.paused, true);
  assert.equal(state.video.pauses, 1);
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
    'composer-author-name': { textContent: 'SautiLink member' },
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
    currentMember: { id: 'member-id', display_name: 'SautiLink Corporation' },
    composerRestoreFocus: null,
    pauseHomeFeedVideos: () => calls.push(['pause']),
    syncHomeFeedVideoPlayback: () => calls.push(['sync']),
  };
  runInNewContext(`${code}\nthis.composer = { openSautiComposer, closeSautiComposer };`, context);

  context.composer.openSautiComposer({ focus: false });
  assert.equal(nodes['composer-author-name'].textContent, 'SautiLink Corporation');
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
