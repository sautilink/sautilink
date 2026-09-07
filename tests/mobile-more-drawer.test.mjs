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

test('mobile drawer styles are isolated from the six-item bottom navigation', async () => {
  const navCss = await read('app/assets/mobile-nav-icon-style.css');
  const drawerCss = await read('app/assets/mobile-more-drawer.css');
  const source = await read('src/mobile-more-drawer.js');

  assert.match(navCss, /@media \(max-width: 680px\)/);
  assert.match(navCss, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(navCss, /sauti-mobile-drawer/);

  assert.match(source, /mobile-more-drawer\.css\?v=/);
  assert.match(source, /sauti-mobile-drawer-enabled/);
  assert.match(source, /replaceWithSafeClones/);
  assert.match(drawerCss, /:root\.sauti-mobile-drawer-enabled \.mobile-header \[data-theme-toggle\]/);
  assert.match(drawerCss, /:root\.sauti-mobile-drawer-enabled \.mobile-header #mobile-signout-button/);
  assert.match(drawerCss, /\.sauti-mobile-drawer-backdrop/);
  assert.match(drawerCss, /@media \(min-width: 681px\)/);
  assert.match(drawerCss, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(drawerCss, /(linear|radial|conic)-gradient\(/i);
});

test('authenticated mobile header keeps only Create and More as visible actions', async () => {
  const html = await read('app/index.html');
  const drawerCss = await read('app/assets/mobile-more-drawer.css');

  assert.match(html, /class="mobile-compose-button"/);
  assert.match(html, /class="theme-toggle"[^>]*data-theme-toggle/);
  assert.match(html, /id="mobile-signout-button"/);
  assert.match(drawerCss, /sauti-mobile-drawer-enabled[\s\S]*data-theme-toggle/);
  assert.match(drawerCss, /sauti-mobile-drawer-enabled[\s\S]*mobile-signout-button/);
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
