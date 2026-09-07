import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformVideoPlayerSource } from '../scripts/video-player-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('SautiLink video player preserves a manual pause against Home autoplay', async () => {
  const source = await read('src/app.js');
  const transformed = transformVideoPlayerSource('/repo/src/app.js', source);

  assert.match(transformed, /delete video\.dataset\.sautiUserPaused/);
  assert.match(transformed, /activeVideo && activeVideo\.dataset\.sautiUserPaused !== 'true'/);
  assert.match(transformed, /if \(video !== activeVideo\) \{[\s\S]*video\.pause\(\)/);
});

test('SautiLink owns video controls while preserving viewer and carousel layers', async () => {
  const [source, css] = await Promise.all([
    read('src/sautilink-video-player.js'),
    read('app/assets/sautilink-video-player.css'),
  ]);

  assert.match(source, /const VIDEO_CONTROLS_IDLE_MS = 4000/);
  assert.match(source, /const VIDEO_SEEK_SECONDS = 5/);
  assert.match(source, /Object\.freeze\(\[0\.5, 1, 1\.5, 2\]\)/);
  assert.match(source, /video\.controls = false/);
  assert.match(source, /video\.removeAttribute\('controls'\)/);
  assert.match(source, /sauti-video-gesture-surface/);
  assert.match(source, /region === 'left' \? -VIDEO_SEEK_SECONDS : VIDEO_SEEK_SECONDS/);
  assert.match(source, /video\.dataset\.sautiUserPaused = 'true'/);
  assert.match(source, /requestPictureInPicture/);
  assert.match(source, /requestFullscreen/);
  assert.match(source, /Open video viewer/);
  assert.match(source, /host\.click\(\)/);
  assert.match(source, /sauti-video-volume/);
  assert.match(source, /Playback speed/);
  assert.match(source, /is-buffering/);
  assert.match(source, /sauti-video-audio-toggle/);

  assert.match(css, /\.sauti-video-center-control/);
  assert.match(css, /\.sauti-video-timeline/);
  assert.match(css, /\.sauti-video-volume/);
  assert.match(css, /\.sauti-video-seek-feedback/);
  assert.match(css, /\.sauti-media-viewer \.sauti-media-viewer-close\s*\{\s*z-index: 20/);
  assert.match(css, /\.sauti-media-carousel-shell \.sauti-media-carousel-nav,[\s\S]*z-index: 12/);
});

test('normal and production builds inject the isolated player and autoplay guard', async () => {
  const [normalBuild, productionBuild, packageJson] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
    read('package.json'),
  ]);

  for (const source of [normalBuild, productionBuild]) {
    assert.match(source, /transformVideoPlayerSource/);
    assert.match(source, /sautilink-video-player\.js/);
  }

  assert.match(packageJson, /--inject:\.\/src\/sautilink-video-player\.js/);
});
