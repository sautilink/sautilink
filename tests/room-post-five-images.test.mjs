import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Room composer supports up to five image attachments without adding a global observer', async () => {
  const source = await read('src/room-post-images.js');
  const css = await read('app/assets/room-post-images.css');

  assert.match(source, /ROOM_POST_IMAGE_LIMIT = 5/);
  assert.match(source, /image\/jpeg/);
  assert.match(source, /image\/png/);
  assert.match(source, /image\/webp/);
  assert.match(source, /ROOM_POST_IMAGE_MAX_BYTES = 8 \* 1024 \* 1024/);
  assert.match(source, /input\.multiple = true/);
  assert.match(source, /\/api\/sauti-media\/begin/);
  assert.match(source, /media: roomPostImages\.map/);
  assert.match(source, /circle_id: room\.id/);
  assert.match(source, /form\.addEventListener\('submit', publishRoomPostWithImages, true\)/);
  assert.doesNotMatch(source, /new MutationObserver/);
  assert.match(css, /\.room-post-image-preview/);
  assert.match(css, /repeat\(5, minmax\(0, 1fr\)\)/);
});

test('Room image feature is included in regular and production app builds', async () => {
  const regular = await read('scripts/build-app.mjs');
  const production = await read('scripts/build-production-release.mjs');

  assert.match(regular, /room-post-images\.js/);
  assert.match(production, /room-post-images\.js/);
});

test('database accepts the fifth media slot expected by the existing five-item API build', async () => {
  const migration = await read('supabase/migrations/20260910064000_allow_five_post_media_items.sql');
  const transform = await read('scripts/post-media-source-transform.mjs');

  assert.match(migration, /media_count >= 0 and media_count <= 5/);
  assert.match(migration, /position between 0 and 4/);
  assert.match(migration, /upload_status = 'attached'::text/);
  assert.match(transform, /requestedMedia\.length > 5/);
  assert.match(transform, /data\.slice\(0, 5\)/);
});
