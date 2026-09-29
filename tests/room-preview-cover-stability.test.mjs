import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transformRoomCoverPerformanceSource } from '../scripts/room-cover-performance-source-transform.mjs';
import { transformRoomOpenPerformanceSource } from '../scripts/room-open-performance-source-transform.mjs';
import { transformRoomPreviewCoverStabilitySource } from '../scripts/room-preview-cover-stability-source-transform.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

async function transformedRoomsPlatform() {
  const path = resolve(root, 'src/rooms-platform.js');
  const source = await readFile(path, 'utf8');
  const openOptimized = transformRoomOpenPerformanceSource(path, source);
  const coverOptimized = transformRoomCoverPerformanceSource(path, openOptimized);
  return transformRoomPreviewCoverStabilitySource(path, coverOptimized);
}

test('Room preview covers wait until near viewport and coalesce repeated protected-media requests', async () => {
  const output = await transformedRoomsPlatform();

  assert.match(output, /const roomCoverRequestCache = new Map\(\)/);
  assert.match(output, /const roomCoverVisibilityWaits = new WeakMap\(\)/);
  assert.match(output, /function waitForRoomCoverNearViewport\(container\)/);
  assert.match(output, /await waitForRoomCoverNearViewport\(container\)/);
  assert.match(output, /roomCoverRequestCache\.has\(cacheKey\)/);
  assert.match(output, /roomCoverRequestCache\.set\(cacheKey, request\)/);
  assert.match(output, /rootMargin: `\$\{margin\}px 0px`/);

  const waitIndex = output.indexOf('await waitForRoomCoverNearViewport(container)');
  const fetchIndex = output.indexOf('const url = await roomCoverUrl(slug, { coverKey, width: variantWidth })', waitIndex);
  assert.ok(waitIndex >= 0 && fetchIndex > waitIndex, 'preview cover fetch should start only after near-viewport gating');
});

test('Room preview images attach immediately instead of waiting on detached lazy-image decode', async () => {
  const output = await transformedRoomsPlatform();

  assert.match(output, /image\.loading = 'eager'/);
  assert.match(output, /image\.fetchPriority = priority \? 'high' : 'low'/);
  assert.doesNotMatch(output, /image\.loading = priority \? 'eager' : 'lazy'/);

  const attachIndex = output.indexOf('container.replaceChildren(image)');
  const decodeIndex = output.indexOf("if (priority) void image.decode?.().catch(() => {})");
  assert.ok(attachIndex >= 0 && decodeIndex > attachIndex, 'preview image must be attached before any optional decode warm-up');
});

test('normal and production builds apply the Room preview cover stability transform after cover optimization', async () => {
  const [normalBuilder, productionBuilder] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(normalBuilder, /transformRoomPreviewCoverStabilitySource/);
  assert.match(normalBuilder, /transformRoomPreviewCoverStabilitySource\([\s\S]*transformRoomCoverPerformanceSource/);
  assert.match(productionBuilder, /transformRoomCoverPerformanceSource\(file, output\);\n  output = transformRoomPreviewCoverStabilitySource\(file, output\);/);
});
