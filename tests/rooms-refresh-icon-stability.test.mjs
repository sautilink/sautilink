import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { transformRoomsStartupIsolationSource } from '../scripts/rooms-startup-isolation-source-transform.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('Room refresh keeps generated SVG icons intrinsically bounded before scoped CSS finishes loading', async () => {
  const path = resolve(root, 'src/rooms-facebook-ui.js');
  const output = transformRoomsStartupIsolationSource(path, await readFile(path, 'utf8'));

  assert.match(output, /svg\.setAttribute\('width', '24'\)/);
  assert.match(output, /svg\.setAttribute\('height', '24'\)/);
  assert.match(output, /svg\.setAttribute\('focusable', 'false'\)/);
});

test('Room scoped styles start loading before member-ready initialization', async () => {
  const path = resolve(root, 'src/rooms-facebook-ui.js');
  const output = transformRoomsStartupIsolationSource(path, await readFile(path, 'utf8'));
  const start = output.indexOf('function startRoomsFacebookWhenMemberReady()');
  const preload = output.indexOf('ensureRoomsFacebookStyles();', start);
  const memberLookup = output.indexOf("const memberView = roomFbById('member-view');", start);

  assert.ok(start >= 0);
  assert.ok(preload > start);
  assert.ok(memberLookup > preload);
});

test('Room refresh fix stays wired through normal and production builders without global CSS leakage', async () => {
  const [normalBuilder, productionBuilder, css] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
    read('app/assets/rooms-facebook.css'),
  ]);

  assert.match(normalBuilder, /transformRoomsStartupIsolationSource/);
  assert.match(productionBuilder, /transformRoomsStartupIsolationSource/);
  assert.match(css, /body\.rooms-facebook-view/);
  assert.doesNotMatch(css, /^body\s*\{/m);
});
