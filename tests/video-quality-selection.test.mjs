import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  deliveredVideoQuality,
  normalizeVideoQualityPreference,
  selectAdaptiveVideoQuality,
  shouldSwitchVideoQuality,
  videoQualityForPreference,
} from '../src/video-quality-preference.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Auto quality follows network capacity and reacts to playback stalls', () => {
  assert.equal(selectAdaptiveVideoQuality({ saveData: true, effectiveType: '4g', downlink: 20 }), '360');
  assert.equal(selectAdaptiveVideoQuality({ effectiveType: '2g', downlink: 0.5 }), '360');
  assert.equal(selectAdaptiveVideoQuality({ effectiveType: '3g', downlink: 2 }), '360');
  assert.equal(selectAdaptiveVideoQuality({ effectiveType: '4g', downlink: 4 }), '720');
  assert.equal(selectAdaptiveVideoQuality({ effectiveType: '4g', downlink: 12 }), 'original');
  assert.equal(selectAdaptiveVideoQuality({ effectiveType: '4g', downlink: 12 }, 2), '360');
});

test('a cold variant fallback reports the original resolution instead of the requested label', () => {
  assert.equal(deliveredVideoQuality('360', 720, 1280), 'original');
  assert.equal(deliveredVideoQuality('360', 360, 640), '360');
  assert.equal(deliveredVideoQuality('720', 1080, 1920), 'original');
  assert.equal(deliveredVideoQuality('720', 720, 1280), '720');
  assert.equal(deliveredVideoQuality('360', 0, 0), '360');
});

test('manual 360p selection retries a cold Auto fallback without delaying Auto startup', () => {
  const cold = '/api/sauti-media/video-id?quality=360&startup=1';
  const variant = '/api/sauti-media/video-id?quality=360';
  const state = { quality: '360', context: 'home', preference: 'auto', switching: false };
  assert.equal(shouldSwitchVideoQuality(state, '360', cold, variant), false);
  assert.equal(shouldSwitchVideoQuality({ ...state, preference: '360' }, '360', cold, variant), true);
  assert.equal(shouldSwitchVideoQuality({ ...state, preference: 'data-saver' }, '360', cold, variant), true);
  assert.equal(shouldSwitchVideoQuality({ ...state, preference: '360' }, '360', variant, variant), false);
  assert.equal(shouldSwitchVideoQuality({ ...state, preference: '360', switching: true }, '360', cold, variant), false);
});

test('Home respects manual preference while Short Videos always stays adaptive', () => {
  const fast = { effectiveType: '4g', downlink: 12 };
  assert.equal(normalizeVideoQualityPreference('DATA-SAVER'), 'data-saver');
  assert.equal(normalizeVideoQualityPreference('invalid'), 'auto');
  assert.equal(videoQualityForPreference('data-saver', fast, 'home'), '360');
  assert.equal(videoQualityForPreference('720', fast, 'home'), '720');
  assert.equal(videoQualityForPreference('original', fast, 'home'), 'original');
  assert.equal(videoQualityForPreference('360', fast, 'short'), 'original');
});

test('quality module, player, Short Videos, and Worker binding are wired into both builds', async () => {
  const [quality, player, shortVideos, css, normalBuild, productionBuild, config] = await Promise.all([
    read('src/video-quality-preference.js'),
    read('src/sautilink-video-player.js'),
    read('src/short-videos-feed.js'),
    read('app/assets/sautilink-video-player.css'),
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
    read('wrangler.production.jsonc'),
  ]);
  assert.match(quality, /sautilink:video-quality:v1/);
  assert.match(quality, /SautiLinkVideoMediaSession/);
  assert.match(player, /Data Saver/);
  assert.match(player, /sauti-video-quality-option/);
  assert.match(shortVideos, /qualityFor\?\.\(\{ context: 'short' \}\)/);
  assert.match(shortVideos, /sautiQualityManaged !== 'true'/);
  assert.match(css, /\.sauti-video-quality-menu/);
  for (const source of [normalBuild, productionBuild]) assert.match(source, /video-quality-preference\.js/);
  assert.equal(JSON.parse(config).media?.binding, 'MEDIA');
});
