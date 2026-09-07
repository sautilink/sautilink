import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Short Videos reuses the canonical Home feed and social actions', async () => {
  const source = await read('src/short-videos-feed.js');

  assert.match(source, /#stream-feed \.sauti-media-tile\[data-media-kind="video"\]/);
  assert.match(source, /stream-more/);
  assert.match(source, /stream-load-more/);
  assert.match(source, /\[data-home-follow\]/);
  assert.match(source, /\[data-sauti-action=/);
  assert.match(source, /\[data-repost-toggle\]/);
  assert.match(source, /actionName === 'comments'/);
  assert.doesNotMatch(source, /createClient|supabase|fetch\(|XMLHttpRequest|WebSocket/i);
});

test('Short Videos carries profile identity and verification without inventing a second badge state', async () => {
  const source = await read('src/short-videos-feed.js');

  assert.match(source, /dataset\.authorUsername/);
  assert.match(source, /dataset\.authorName/);
  assert.match(source, /\.verification-badge/);
  assert.match(source, /cloneVerificationBadge/);
  assert.match(source, /\.sauti-card-avatar/);
  assert.match(source, /View @\$\{username\} profile/);
});

test('Short Videos opens from the Home video tile without stealing player control clicks', async () => {
  const source = await read('src/short-videos-feed.js');

  assert.match(source, /event\.target\?\.matches\?\.\(HOME_VIDEO_TILE_SELECTOR\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /document\.addEventListener\('click',[\s\S]*true\)/);
  assert.doesNotMatch(source, /touchstart|touchmove|pointerdown|pointermove/i);
});

test('Short Videos is a vertical snap feed with a professional end state', async () => {
  const css = await read('app/assets/short-videos-feed.css');
  const source = await read('src/short-videos-feed.js');

  assert.match(css, /height: 100dvh/);
  assert.match(css, /scroll-snap-type: y mandatory/);
  assert.match(css, /scroll-snap-align: start/);
  assert.match(css, /touch-action: pan-y/);
  assert.match(css, /\.sauti-short-actions/);
  assert.match(css, /\.sauti-short-profile/);
  assert.match(source, /streamMore && streamMore\.hidden/);
  assert.match(source, /You’re all caught up\./);
  assert.match(source, /You’ve seen the latest short videos for now\./);
  assert.doesNotMatch(css, /\.mobile-nav|\.mobile-header/);
});

test('Short Videos pauses Home playback while open and restores it on close', async () => {
  const source = await read('src/short-videos-feed.js');

  assert.match(source, /sautiShortVideosPaused/);
  assert.match(source, /sautiUserPaused/);
  assert.match(source, /pauseHomePlayback\(\)/);
  assert.match(source, /restoreHomePlayback\(\)/);
  assert.match(source, /pauseShortVideos\(\)/);
});

test('normal and production builds both inject Short Videos after existing media behavior', async () => {
  const normalBuild = await read('scripts/build-app.mjs');
  const productionBuild = await read('scripts/build-production-release.mjs');

  for (const source of [normalBuild, productionBuild]) {
    assert.match(source, /post-media-carousel\.js/);
    assert.match(source, /short-videos-feed\.js/);
    assert.match(source, /sautilink-video-player\.js/);
  }
});
