import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile More drawer delegates to existing SautiLink actions', async () => {
  const source = await read('src/mobile-more-drawer.js');

  assert.match(source, /\.app-nav \[data-member-view=/);
  assert.match(source, /\.mobile-header \[data-theme-toggle\]/);
  assert.match(source, /mobile-signout-button|signout-button/);
  assert.match(source, /data-mobile-drawer-view="profile"/);
  assert.match(source, /data-mobile-drawer-view="saved"/);
  assert.match(source, /data-mobile-drawer-view="appeals"/);
  assert.match(source, /data-mobile-drawer-view="settings"/);
  assert.match(source, /href="\/help"/);
  assert.match(source, /href="\/privacy"/);
  assert.match(source, /href="\/terms"/);
  assert.doesNotMatch(source, /data-mobile-drawer-view="(?:stream|discover|messages|notifications|circles)"/);
  assert.doesNotMatch(source, /supabase|fetch\(|XMLHttpRequest|WebSocket/i);
});

test('mobile More drawer avoids gesture conflicts and traps keyboard focus', async () => {
  const source = await read('src/mobile-more-drawer.js');

  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /aria-modal/);
  assert.match(source, /aria-expanded/);
  assert.doesNotMatch(source, /touchstart|touchmove|pointerdown|pointermove|swipe/i);
});

test('mobile More drawer stays mobile-only without changing the six-item bottom nav', async () => {
  const css = await read('app/assets/mobile-nav-icon-style.css');

  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.sauti-mobile-drawer/);
  assert.match(css, /\.sauti-mobile-drawer-backdrop/);
  assert.match(css, /@media \(min-width: 681px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
});

test('normal and production app builds both inject the drawer module', async () => {
  const normalBuild = await read('scripts/build-app.mjs');
  const productionBuild = await read('scripts/build-production-release.mjs');

  for (const source of [normalBuild, productionBuild]) {
    assert.match(source, /mobile-nav-icon-style\.js/);
    assert.match(source, /mobile-more-drawer\.js/);
    assert.match(source, /sautilink-video-player\.js/);
  }
});
