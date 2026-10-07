import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('clean /menu route uses the authenticated SautiLink app shell', async () => {
  const router = await read('src/asset-router.js');

  assert.match(router, /CLEAN_MEMBER_ROUTE = \/\^\\\/\(\?:home\|discover\|saved\|appeals\|moderation\|settings\|menu\|notifications\)/);
  assert.match(router, /CLEAN_ROUTE_PREFIX = \/\^\\\/\(\?:login\|signup\|home\|compose\|discover\|saved\|appeals\|moderation\|settings\|menu\|notifications/);
});

test('Menu page mirrors the existing sidebar instead of duplicating menu definitions', async () => {
  const [html, source] = await Promise.all([
    read('app/index.html'),
    read('src/app.js'),
  ]);

  assert.match(html, /<section class="menu-surface" id="menu-surface" aria-label="Menu" hidden>/);
  assert.match(html, /<div class="menu-page-shell" id="menu-page-shell" aria-live="polite"><\/div>/);
  assert.equal((html.match(/id="primary-rail-systems-title"/g) || []).length, 1);
  assert.equal((html.match(/>Router Setup Gateway<\/span>/g) || []).length, 1);
  assert.equal((html.match(/>Cloud Engine<\/span>/g) || []).length, 1);

  assert.match(source, /const source = document\.querySelector\('\.primary-rail-inner'\)/);
  assert.match(source, /const clone = source\.cloneNode\(true\)/);
  assert.match(source, /namespaceMenuCloneIds\(clone\)/);
  assert.match(source, /new MutationObserver\(scheduleMenuMirror\)/);
  assert.match(source, /target\.replaceChildren\(frame\)/);
});

test('Menu page preserves sidebar actions while keeping /menu as its own member surface', async () => {
  const source = await read('src/app.js');

  assert.match(source, /menuSurface\.hidden = name !== 'menu'/);
  assert.match(source, /name === 'menu'[\s\S]*?\? 'Menu'/);
  assert.match(source, /'settings', 'menu', 'profile'/);
  assert.match(source, /name === 'menu'[\s\S]*?\? '\/menu'/);
  assert.match(source, /if \(\/\^\(\?:\\\/app\)\?\\\/menu\\\/?\$\/\.test\(window\.location\.pathname\)\)/);
  assert.match(source, /if \(window\.location\.pathname !== '\/menu'\) window\.history\.replaceState\(\{\}, '', '\/menu'\)/);
  assert.match(source, /menuSurface\.addEventListener\('click'/);
  assert.match(source, /showMemberSurface\(view\.dataset\.memberView\)/);
  assert.match(source, /byId\('open-sauti-composer'\)\?\.click\(\)/);
  assert.match(source, /byId\('signout-button'\)\?\.click\(\)/);
});

test('Menu page keeps full sidebar labels and layout on desktop and mobile', async () => {
  const css = await read('app/assets/app.css');

  assert.match(css, /\.menu-page-sidebar\.primary-rail\s*\{[\s\S]*?width:\s*min\(100%, 360px\)/);
  assert.match(css, /\.menu-page-sidebar \.primary-rail-inner\s*\{[\s\S]*?position:\s*static/);
  assert.match(css, /@media \(max-width: 1080px\)[\s\S]*?\.menu-page-sidebar \.nav-item span[\s\S]*?display:\s*initial/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.menu-page-sidebar\.primary-rail\s*\{[\s\S]*?display:\s*block/);
  assert.match(css, /\.menu-page-sidebar \.primary-rail-section-title\s*\{\s*display:\s*block;/);
});
