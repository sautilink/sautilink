import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const motionPath = new URL('../app/assets/motion-foundation.css', import.meta.url);
const appHtmlPath = new URL('../app/index.html', import.meta.url);

test('production app loads UI motion stylesheet after base UI styles', async () => {
  const html = await readFile(appHtmlPath, 'utf8');
  const appCss = html.indexOf('/app/assets/app.css');
  const motion = html.indexOf('/app/assets/motion-foundation.css');
  assert.ok(appCss >= 0 && motion > appCss);
  assert.equal(html.split('/app/assets/motion-foundation.css').length - 1, 1);
});

test('UI motion styles change presentation only and respect reduced motion', async () => {
  const css = await readFile(motionPath, 'utf8');
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.sauti-action\[data-sauti-action="like"\]\.active svg/);
  assert.match(css, /\.settings-toggle-row i b/);
  assert.match(css, /\.mobile-nav \.mobile-nav-icon/);
  assert.doesNotMatch(css, /^\s*(?:display|visibility|position|pointer-events|z-index|width|height|grid-template-columns)\s*:/m);
  assert.doesNotMatch(css, /url\s*\(/i);
});
