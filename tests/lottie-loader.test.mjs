import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const fileStat = (path) => stat(new URL(`../${path}`, import.meta.url));

test('selected loader asset stays tiny, vector-only, and device-independent', async () => {
  const animation = JSON.parse(await read('assets/animations/sautilink-loader/animations/12345.json'));
  const dotLottie = await fileStat('assets/animations/sautilink-loader.lottie');
  const runtime = await fileStat('assets/vendor/lottie-web/lottie_light.min.js');

  assert.equal(animation.w, 400);
  assert.equal(animation.h, 400);
  assert.ok(animation.fr > 29 && animation.fr < 31, `unexpected frame rate ${animation.fr}`);
  assert.ok(animation.op - animation.ip > 60 && animation.op - animation.ip < 62);
  assert.ok(animation.assets.every((asset) => !asset.p && !asset.u), 'loader must not depend on raster image assets');
  assert.ok(dotLottie.size > 0 && dotLottie.size < 10_000, `dotLottie unexpectedly large: ${dotLottie.size}`);
  assert.ok(runtime.size > 0 && runtime.size < 200_000, `light runtime unexpectedly large: ${runtime.size}`);
});

test('loader runtime is fully self-hosted and keeps the existing spinner as fallback', async () => {
  const source = await read('assets/lottie-loader.js');
  const css = await read('assets/lottie-loader.css');

  assert.match(source, /assets\/vendor\/lottie-web\/lottie_light\.min\.js/);
  assert.match(source, /assets\/animations\/sautilink-loader\/animations\/12345\.json/);
  assert.match(source, /\.loading-mark, \.profile-route-brand-spinner/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /sautilinkLottieFallback/);
  assert.match(source, /mount\(target, \{ auto: true \}\)/);
  assert.match(source, /record\.auto && !target\.matches/);
  assert.doesNotMatch(source, /lottie\.host|unpkg|jsdelivr|cdnjs/i);

  assert.match(css, /background: transparent/);
  assert.match(css, /--sl-loader-size: clamp\(60px, 12vw, 72px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('app and launch splash use Lottie without changing launch failsafes', async () => {
  const appHtml = await read('app/index.html');
  const launchJs = await read('assets/launch-splash.js');
  const launchCss = await read('assets/launch-splash.css');

  assert.equal((appHtml.match(/\/assets\/lottie-loader\.js\?v=20260917-lottie1/g) || []).length, 1);
  assert.match(launchJs, /\/assets\/lottie-loader\.js\?v=20260917-lottie1/);
  assert.match(launchJs, /loader\.mount\(stage, \{ mode: "launch" \}\)/);
  assert.match(launchJs, /const minimum = reducedMotion \? 320 : 1900/);
  assert.match(launchJs, /const maximum = reducedMotion \? 900 : 4200/);
  assert.match(launchJs, /\/sw\.js\?v=20260916-loadingfix1/);
  assert.match(launchCss, /\.sl-launch-logo-stage\.sl-lottie-ready \.sl-launch-orbit/);
  assert.match(launchCss, /\.sl-launch-logo-stage\.sl-lottie-ready \.sl-launch-logo/);
});

test('PWA cache and third-party notices include the local loader dependencies', async () => {
  const sw = await read('sw.js');
  const notices = await read('THIRD_PARTY_NOTICES.md');

  assert.match(sw, /sautilink-shell-v72/);
  for (const asset of [
    '/assets/lottie-loader.js?v=20260917-lottie1',
    '/assets/lottie-loader.css?v=20260917-lottie1',
    '/assets/vendor/lottie-web/lottie_light.min.js',
    '/assets/animations/sautilink-loader/animations/12345.json',
  ]) assert.ok(sw.includes(asset), `service worker is missing ${asset}`);

  assert.match(notices, /`lottie-web` \| 5\.13\.0 light build \| MIT/);
});
