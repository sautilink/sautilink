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
  assert.match(source, /data-mobile-drawer-settings-toggle/);
  assert.match(source, /href="\/help"/);
  assert.match(source, /href="\/privacy"/);
  assert.match(source, /href="\/terms"/);
  assert.doesNotMatch(source, /data-mobile-drawer-view="(?:stream|discover|messages|notifications|circles)"/);
  assert.doesNotMatch(source, /supabase|fetch\(|XMLHttpRequest|WebSocket/i);
});

test('mobile Settings group is collapsed by default and keeps icons on every nested destination', async () => {
  const source = await read('src/mobile-more-drawer.js');
  const css = await read('app/assets/mobile-more-drawer.css');

  assert.match(source, /aria-controls="sauti-mobile-drawer-settings-panel"/);
  assert.match(source, /aria-expanded="false"/);
  assert.match(source, /id="sauti-mobile-drawer-settings-panel"[^>]+hidden/);
  assert.match(source, /function setSettingsExpanded\(expanded\)/);
  assert.match(source, /settingsPanel\.hidden = !next/);
  assert.match(source, /setSettingsExpanded\(false\)/);
  assert.match(source, /data-mobile-drawer-settings-section="account"/);
  assert.match(source, /data-mobile-drawer-settings-section="privacy"/);
  assert.match(source, /data-mobile-drawer-settings-section="notifications"/);
  assert.match(source, /data-mobile-drawer-settings-section="safety"/);
  assert.match(source, /data-mobile-drawer-settings-section="data"/);
  assert.match(source, /data-mobile-drawer-appearance/);
  for (const iconName of ['account', 'privacy', 'notifications', 'safety', 'data', 'appearance']) {
    assert.match(source, new RegExp(`icon\\('${iconName}'\\)`));
  }
  assert.match(css, /\.sauti-mobile-drawer-settings-panel\[hidden\]/);
  assert.match(css, /\.sauti-mobile-drawer-settings-toggle\[aria-expanded="true"\]/);
  assert.match(css, /\.sauti-mobile-drawer-settings-panel > button > svg:first-child/);
});

test('nested Settings destinations open the real Settings surface rather than duplicating backend logic', async () => {
  const source = await read('src/mobile-more-drawer.js');
  const html = await read('app/index.html');

  assert.match(source, /canonicalViewButton\('settings'\)/);
  assert.match(source, /canonicalSettingsSectionButton\(section\)/);
  assert.match(source, /#settings-surface \[data-settings-section=/);
  assert.match(source, /sectionButton\.click\(\)/);
  for (const section of ['account', 'privacy', 'notifications', 'safety', 'data']) {
    assert.match(html, new RegExp(`data-settings-section="${section}"`));
  }
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

  assert.match(source, /mobile-more-drawer\.css\?v=20260919-settingsaccordion1/);
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
