import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';
import { transformRoomCoverPerformanceSource } from '../scripts/room-cover-performance-source-transform.mjs';
import { transformRoomOpenPerformanceSource } from '../scripts/room-open-performance-source-transform.mjs';
import { transformRoomsStartupIsolationSource } from '../scripts/rooms-startup-isolation-source-transform.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('shared post hydration already batches Room media metadata for Room stream cards', async () => {
  const path = resolve(root, 'src/app.js');
  const transformed = transformPostMediaSource(path, await readFile(path, 'utf8'));

  assert.match(transformed, /async function loadSautiMediaRowsMap\(postIds\)/);
  assert.match(transformed, /\.select\('post_id,id,media_kind,content_type,width,height,duration_ms,alt_text,position'\)/);
  assert.match(transformed, /loadSautiMediaRowsMap\(postIds\)/);
  assert.match(transformed, /mediaRows: mediaMap\?\.get\(post\.id\)/);
});

test('Room detail reuses its primary query and defers owner management lists', async () => {
  const path = resolve(root, 'src/app.js');
  const transformed = transformRoomOpenPerformanceSource(path, await readFile(path, 'utf8'));

  assert.match(transformed, /created_at, category, privacy, cover_key, member_count, post_permission, invite_permission, updated_at/);
  assert.match(transformed, /window\.__sautiRoomDetailSnapshot = Object\.freeze/);
  assert.match(transformed, /requestIdleCallback\(runOwnerRoomManagement, \{ timeout: 1800 \}\)/);
  assert.doesNotMatch(transformed, /if \(circle\.owner_id === currentMemberId\) \{\s*await Promise\.all\(\[/);
});

test('Rooms enhancement coalesces metadata reads and only enhances the visible Rooms surface', async () => {
  const path = resolve(root, 'src/rooms-platform.js');
  const isolated = transformRoomsStartupIsolationSource(path, await readFile(path, 'utf8'));
  const optimized = transformRoomOpenPerformanceSource(path, isolated);
  const transformed = transformRoomCoverPerformanceSource(path, optimized);

  assert.match(transformed, /ROOM_DISCOVERY_CACHE_TTL_MS = 30 \* 1000/);
  assert.match(transformed, /roomDiscoveryRuntimeCache\.revision/);
  assert.match(transformed, /ROOM_DETAIL_CACHE_TTL_MS = 15 \* 1000/);
  assert.match(transformed, /ROOM_ROLE_CACHE_TTL_MS = 5 \* 1000/);
  assert.match(transformed, /window\.__sautiRoomDetailSnapshot = null/);
  assert.match(transformed, /scheduleRoomPeopleLoad\(room, role, people\)/);
  assert.match(transformed, /new IntersectionObserver/);
  assert.match(transformed, /activeRoomSlug\(\) !== slug/);
  assert.match(transformed, /if \(roomDetailRouteActive\(\)\) enhanceActiveRoom\(\);\s*else enhanceRoomCards\(\);/);
  assert.doesNotMatch(transformed, /\n    loadRoomPeople\(room, role, people\);/);

  // The previous cover optimization must still compose after this Room-open pass.
  assert.match(transformed, /ROOM_COVER_VARIANT_WIDTHS = Object\.freeze\(\[480, 960, 1440\]\)/);
  assert.match(transformed, /fetchPriority = priority \? 'high' : 'auto'/);
});

test('normal and production builders apply Room open performance transforms', async () => {
  const [normalBuilder, productionBuilder] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(normalBuilder, /transformRoomOpenPerformanceSource/);
  assert.match(normalBuilder, /transformRoomOpenPerformanceSource\(\s*appSourcePath/);
  assert.match(normalBuilder, /transformRoomOpenPerformanceSource\(\s*path/);
  assert.match(productionBuilder, /transformRoomOpenPerformanceSource\(file, output\)/);
  assert.match(productionBuilder, /transformRoomCoverPerformanceSource\(file, output\)/);
});
