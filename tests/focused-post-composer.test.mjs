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
  assert.match(html, /placeholder="What’s on your mind\?"/);
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

test('wider composer shows one media action row while keeping drag and drop', async () => {
  const [html, css, tools] = await Promise.all([
    read('app/index.html'),
    read('app/assets/composer-formats.css'),
    read('src/composer-formats.js'),
  ]);

  assert.match(html, /class="composer-add-label"/);
  assert.match(css, /@media \(min-width: 501px\)[\s\S]*?\.composer-dialog \.composer-upload-zone \{ display: none; \}/);
  assert.match(css, /\.composer-dialog \.composer-meta \.composer-audience \{ display: none; \}/);
  assert.match(css, /\.composer-dialog \.composer-actions \.composer-tools\.drag-over/);
  assert.match(tools, /for \(const target of \[zone, tools\]\.filter\(Boolean\)\)/);
});
