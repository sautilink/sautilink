import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transformRoomsStartupIsolationSource } from '../scripts/rooms-startup-isolation-source-transform.mjs';

const root = resolve(import.meta.dirname, '..');

async function source(path) {
  return readFile(resolve(root, path), 'utf8');
}

test('Rooms platform does not start its global observer while auth entry is visible', async () => {
  const path = resolve(root, 'src/rooms-platform.js');
  const output = transformRoomsStartupIsolationSource(path, await readFile(path, 'utf8'));

  assert.match(output, /function startRoomsPlatformWhenMemberReady\(\)/);
  assert.match(output, /if \(!memberView\.hidden\) \{[\s\S]*initRoomsPlatform\(\)/);
  assert.match(output, /memberObserver\.observe\(memberView, \{ attributes: true, attributeFilter: \['hidden'\] \}\)/);
  assert.doesNotMatch(output, /installRoomRouteBridge\(\);\s*initRoomsPlatform\(\);\s*$/);
});

test('Rooms platform observer ignores its own text-only and no-op mutations', async () => {
  const path = resolve(root, 'src/rooms-platform.js');
  const output = transformRoomsStartupIsolationSource(path, await readFile(path, 'utf8'));

  assert.match(output, /mutation\.oldValue !== currentValue/);
  assert.match(output, /changedNodes\.some\(\(node\) => node\.nodeType === Node\.ELEMENT_NODE\)/);
  assert.match(output, /attributeOldValue: true/);
  assert.match(output, /if \(shouldSchedule\) scheduleRoomsUi\(\)/);
});

test('Rooms Facebook enhancement is also deferred until member view is open', async () => {
  const path = resolve(root, 'src/rooms-facebook-ui.js');
  const output = transformRoomsStartupIsolationSource(path, await readFile(path, 'utf8'));

  assert.match(output, /function startRoomsFacebookWhenMemberReady\(\)/);
  assert.match(output, /function initRoomsFacebookUi\(\)/);
  assert.match(output, /mutations\.some\(roomFacebookMutationChangesUi\)/);
  assert.match(output, /attributeOldValue: true/);
  assert.doesNotMatch(output, /^ensureRoomsFacebookStyles\(\);/m);
});

test('normal and production builders apply Rooms startup isolation', async () => {
  const normalBuilder = await source('scripts/build-app.mjs');
  const productionBuilder = await source('scripts/build-production-release.mjs');

  assert.match(normalBuilder, /transformRoomsStartupIsolationSource/);
  assert.match(normalBuilder, /plugins: \[roomsStartupIsolationPlugin\]/);
  assert.match(productionBuilder, /transformRoomsStartupIsolationSource\(/);
});
