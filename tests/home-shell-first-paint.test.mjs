import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Home chrome follows loader visibility without a persistent boot class', async () => {
  const [html, css] = await Promise.all([
    read('app/index.html'),
    read('app/assets/app.css'),
  ]);

  assert.match(html, /<body>/);
  assert.doesNotMatch(html, /app-booting/);
  for (const selector of ['mobile-header', 'primary-rail', 'context-rail', 'stream-header', 'mobile-nav']) {
    assert.ok(css.includes(`body:has(#loading-view:not([hidden])) .${selector}`));
  }
  assert.match(css, /body:has\(#loading-view:not\(\[hidden\]\)\) \.loading-view\s*\{[^}]*min-height:\s*100vh/s);
  assert.doesNotMatch(css, /\.app-booting/);
});

test('first-paint mobile shell already matches the enhanced Home shell', async () => {
  const html = await read('app/index.html');

  assert.match(html, /id="sauti-mobile-more-trigger"/);
  assert.match(html, /id="sautilink-mobile-more-drawer-style"/);
  assert.match(html, /class="mobile-nav"[^>]+data-icon-style="bold-outline"/);
  assert.equal((html.match(/class="mobile-nav-icon"/g) || []).length, 6);
  assert.match(html, /aria-label="Rooms"[^>]*>\s*<svg[^>]+data-room-icon="true"[^>]*>\s*<rect x="3\.5"/s);
  assert.doesNotMatch(html, /aria-label="Rooms"[^>]*>[\s\S]*?M16\.1 7\.9/);
});
