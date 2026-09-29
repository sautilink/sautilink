import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('Room toolbar popovers are portaled and anchored to the viewport', async () => {
  const source = await read('src/rooms-transient-surfaces.js');

  assert.match(source, /document\.body\.append\(surface\)/);
  assert.match(source, /surface\.style\.position = 'fixed'/);
  assert.match(source, /getBoundingClientRect\(\)/);
  assert.match(source, /room-detail-menu/);
  assert.match(source, /room-detail-search/);
});

test('Room toolbar popovers dismiss on outside interaction, scroll, resize and Escape', async () => {
  const source = await read('src/rooms-transient-surfaces.js');

  assert.match(source, /addEventListener\('pointerdown', roomTransientHandlePointerDown, true\)/);
  assert.match(source, /addEventListener\('scroll', roomTransientHandleScroll, true\)/);
  assert.match(source, /addEventListener\('resize', roomTransientHandleResize/);
  assert.match(source, /event\.key !== 'Escape'/);
  assert.match(source, /roomTransientResetSearch/);
});

test('Room transient surface fix is included in staging and production bundles', async () => {
  const [stagingBuild, productionBuild] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(stagingBuild, /src\/rooms-transient-surfaces\.js/);
  assert.match(productionBuild, /rooms-transient-surfaces\.js/);
  assert.match(productionBuild, /20260929-room-transient1/);
});
