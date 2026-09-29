import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';
import { transformRoomCoverPerformanceSource } from '../scripts/room-cover-performance-source-transform.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('Room cover delivery creates responsive WebP variants and edge/browser cache layers', async () => {
  const source = await read('src/room-media-api.js');

  assert.match(source, /COVER_VARIANT_WIDTHS = Object\.freeze\(\[480, 960, 1440\]\)/);
  assert.match(source, /env\.IMAGES[\s\S]*?\.transform\(\{ width: targetWidth, fit: 'scale-down' \}\)[\s\S]*?format: 'image\/webp'/);
  assert.match(source, /globalThis\.caches\?\.default/);
  assert.match(source, /X-Sauti-Room-Cover-Cache/);
  assert.match(source, /private, max-age=\$\{COVER_BROWSER_TTL_SECONDS\}/);
  assert.match(source, /public, max-age=\$\{COVER_EDGE_TTL_SECONDS\}, immutable/);
  assert.match(source, /requestHasEtag/);
});

test('Rooms client requests a small preview variant and a higher-priority detail variant', async () => {
  const path = resolve(root, 'src/rooms-platform.js');
  const output = transformRoomCoverPerformanceSource(path, await readFile(path, 'utf8'));

  assert.match(output, /ROOM_COVER_VARIANT_WIDTHS = Object\.freeze\(\[480, 960, 1440\]\)/);
  assert.match(output, /cache: 'force-cache'/);
  assert.match(output, /url\.searchParams\.set\('v', version\)/);
  assert.match(output, /coverKey: room\.cover_key, width: 480/);
  assert.match(output, /width: window\.innerWidth <= 680 \? 960 : 1440/);
  assert.match(output, /priority: true/);
  assert.match(output, /image\.loading = priority \? 'eager' : 'lazy'/);
  assert.match(output, /image\.fetchPriority = priority \? 'high' : 'auto'/);
});

test('Room cover API cache headers survive the general API no-store finalizer', async () => {
  const path = resolve(root, 'src/asset-router.js');
  const base = await readFile(path, 'utf8');
  const mediaTransformed = transformMediaPerformanceSource(path, base);
  const output = transformRoomCoverPerformanceSource(path, mediaTransformed);

  assert.match(output, /room-media/);
  assert.match(output, /protectedMediaDelivery/);
  assert.match(output, /!protectedMediaDelivery/);
});

test('normal and production builders apply Room cover performance transforms', async () => {
  const [normalBuilder, productionBuilder] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(normalBuilder, /transformRoomCoverPerformanceSource/);
  assert.match(productionBuilder, /transformRoomCoverPerformanceSource\(file, output\)/);
  assert.match(productionBuilder, /20260930-swala-otp1/);
});
