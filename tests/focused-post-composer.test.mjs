import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('post composer keeps SautiLink copy and uses a focused responsive surface', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  assert.match(html, /id="sauti-composer-dialog"/);
  assert.match(html, /id="sauti-composer-close"/);
  assert.match(html, /data-open-sauti-composer/);
  assert.match(html, /placeholder="What deserves to be heard\?"/);
  assert.doesNotMatch(html, /What(?:'|’)s happening\?/i);
  assert.match(css, /\.composer-dialog::backdrop/);
  assert.match(css, /\.composer-header #sauti-submit/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.composer-dialog\s*\{[\s\S]*?width: 100vw;[\s\S]*?height: 100dvh;/);
});

test('post composer open and close behavior stays in the browser UI layer', async () => {
  const source = await read('src/app.js');

  assert.match(source, /function openSautiComposer/);
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /function closeSautiComposer/);
  assert.match(source, /dialog\.close\(\)/);
  assert.match(source, /querySelectorAll\('\[data-open-sauti-composer\]'\)/);
  assert.match(source, /addEventListener\('cancel'/);
});
