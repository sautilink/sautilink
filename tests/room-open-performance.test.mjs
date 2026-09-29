import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';
import { transformRoomCoverPerformanceSource } from '../scripts/room-cover-performance-source-transform.mjs';
import { transformRoomOpenPerformanceSource } from '../scripts/room-open-performance-source-transform.mjs';
import { transformRoomsStartupIsolationSource } from '../scripts/rooms-startup-isolation-source-transform.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('Room stream batches post media metadata instead of issuing one metadata request per card', async () => {
  const path = resolve(root, 'src/app.js');
  const source = await readFile(path, 'utf8');
  const transformed = transformRoomOpenPerformanceSource(
    path,
    transformMediaPerformanceSource(path, source),
  );

  assert.match(transformed, /ROOM_MEDIA_ROWS_CACHE_TTL_MS = 60 \* 1000/);
  assert.match(transformed, /primeRoomStreamMediaRows\(postIds\)/);
  assert.match(transformed, /\.select\('post_id,id,media_kind,content_type,width,height,duration_ms,alt_text,position'\)/);
  assert.match(transformed, /\.in\('post_id', missing\)/);
  assert.match(transformed, /primeRoomStreamMediaRows\(rows\.map\(\(post\) => post\.id\)\)/);
  assert.match(transformed, /cachedRoomMediaRows\(postId\)/);
});

test('Room detail reuses the primary detail query and defers owner management lists', async () => {
  const path = resolve(root, 'src/app.js');
  const transformed = transformRoomOpenPerformanceSource(path, await readFile(path, 'utf8'));

  assert.match(transformed, /created_at, category, privacy, cover_key, member_count, post_permission, invite_permission, updated_at/);
  assert.match(transformed, /window\.__sautiRoomDetailSnapshot = Object\.freeze/);
  assert.match(transformed, /requestIdleCallback\(runOwnerRoomManagement, \{ timeout: 1800 \}\)/);
  assert.doesNotMatch(transformed, /if \(circle\.owner_id === currentMemberId\) \{\s*await Promise\.all\(\[/);
});

test('Rooms enhancement layer coalesces metadata reads and only enhances the visible Rooms surface', async () => {
  const path = resolve(root, 'src/rooms-platform.js');
  const source = transformRoomsStartupIsolationSource(path, await readFile(path, 'utf8'));
  const transformed = transformRoomCoverPerformanceSource(
    path,
    transformRoomOpenPerformanceSource(path, source),
  );

  assert.match(transformed, /ROOM_DISCOVERY_CACHE_TTL_MS = 30 \* 1000/);
  assert.match(transformed, /roomDiscoveryRuntimeCache\.promise/);
  assert.match(transformed, /ROOM_DETAIL_CACHE_TTL_MS = 15 \* 1000/);
  assert.match(transformed, /roomRoleRuntimeCache/);
  assert.match(transformed, /window\.__sautiRoomDetailSnapshot/);
  assert.match(transformed, /scheduleRoomPeopleLoad\(room, role, people\)/);
  assert.match(transformed, /IntersectionObserver/);
  assert.match(transformed, /if \(roomDetailRouteActive\(\)\) enhanceActiveRoom\(\);\s*else enhanceRoomCards\(\);/);
  assert.doesNotMatch(transformed, /\n    loadRoomPeople\(room, role, people\);/);

  // The cover optimization must still compose after the Room-open optimization.
  assert.match(transformed, /ROOM_COVER_VARIANT_WIDTHS = Object\.freeze\(\[480, 960, 1440\]\)/);
  assert.match(transformed, /fetchPriority = priority \? 'high' : 'auto'/);
});

test('normal and production builders apply the Room open performance transform', async () => {
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
