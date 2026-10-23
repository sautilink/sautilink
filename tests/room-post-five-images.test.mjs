import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Room composer supports up to ten image attachments without adding a global observer', async () => {
  const source = await read('src/room-post-images.js');
  const css = await read('app/assets/room-post-images.css');

  assert.match(source, /ROOM_POST_IMAGE_LIMIT = 10/);
  assert.match(source, /image\/jpeg/);
  assert.match(source, /image\/png/);
  assert.match(source, /image\/webp/);
  assert.match(source, /ROOM_POST_IMAGE_MAX_BYTES = 5 \* 1024 \* 1024/);
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

test('Room image selection queues at most ten files and rejects over 5 MiB before upload', async () => {
  const source = await read('src/room-post-images.js');
  const start = source.indexOf('function addRoomPostImages('), end = source.indexOf('\nasync function ', start);
  const images = [], uploads = [], messages = [];
  const add = runInNewContext(`${source.slice(start, end)}\naddRoomPostImages;`, {
    roomPostImages: images, roomPostImageRoomSlug: 'room', roomPostSlug: () => 'room',
    ROOM_POST_IMAGE_LIMIT: 10, ROOM_POST_IMAGE_MAX_BYTES: 5242880,
    ROOM_POST_IMAGE_TYPES: new Set(['image/jpeg', 'image/png', 'image/webp']),
    roomPostMessage: (message) => messages.push(message), crypto: { randomUUID: () => String(uploads.length) },
    URL: { createObjectURL: () => 'blob:selected' }, uploadRoomPostImage: (id) => uploads.push(id),
    renderRoomPostImages() {}, queueMicrotask() {}, syncRoomPostImageComposer() {},
  });
  add([{ name: 'too-large.jpg', type: 'image/jpeg', size: 5242881 }]);
  assert.equal(uploads.length, 0);
  assert.ok(messages.at(-1).includes('5 MiB'));
  add(Array.from({ length: 12 }, (_, i) => ({ name: `${i}.jpg`, type: 'image/jpeg', size: 5242880 })));
  assert.equal(images.length, 10);
  assert.equal(uploads.length, 10);
  assert.ok(messages.at(-1).includes('first ten'));
  add([{ name: 'eleventh.jpg', type: 'image/jpeg', size: 1 }]);
  assert.equal(uploads.length, 10);
});

test('database accepts the fifth media slot expected by the existing five-item API build', async () => {
  const migration = await read('supabase/migrations/20260910064000_allow_five_post_media_items.sql');
  const transform = await read('scripts/post-media-source-transform.mjs');

  assert.match(migration, /media_count >= 0 and media_count <= 5/);
  assert.match(migration, /position between 0 and 4/);
  assert.match(migration, /upload_status = 'attached'::text/);
  assert.match(transform, /requestedMedia\.length > 10/);
  assert.match(transform, /data\.slice\(0, 10\)/);
});
