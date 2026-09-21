import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Home chrome remains hidden until session bootstrap resolves', async () => {
  const [html, css, app] = await Promise.all([
    read('app/index.html'),
    read('app/assets/app.css'),
    read('src/app.js'),
  ]);

  assert.match(html, /<body class="app-booting">/);
  for (const selector of ['mobile-header', 'primary-rail', 'context-rail', 'stream-header', 'mobile-nav']) {
    assert.match(css, new RegExp(`\\.app-booting \\.${selector}`));
  }
  assert.match(css, /\.app-booting \.loading-view\s*\{[^}]*min-height:\s*100vh/s);
  assert.match(app, /function showAuthPanel[\s\S]*classList\.remove\('app-booting'\)/);
  assert.match(app, /function renderMember[\s\S]*classList\.remove\('app-booting'\)/);
  assert.match(app, /function showProfileRouteState[\s\S]*classList\.remove\('app-booting'\)/);
});

test('first-paint mobile shell already matches the enhanced Home shell', async () => {
  const html = await read('app/index.html');

  assert.match(html, /id="sauti-mobile-more-trigger"/);
  assert.match(html, /id="sautilink-mobile-more-drawer-style"/);
  assert.match(html, /class="mobile-nav"[^>]+data-icon-style="bold-outline"/);
  assert.equal((html.match(/class="mobile-nav-icon"/g) || []).length, 6);
  assert.doesNotMatch(html, /aria-label="Rooms"[^>]*>\s*<svg[^>]*>\s*<rect x="3\.5"/s);
});
