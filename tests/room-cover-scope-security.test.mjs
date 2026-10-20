import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRoomMediaRequest } from '../src/room-media-api.js';

const ownerId = '71000000-0000-4000-8000-000000000001';
const roomId = '71000000-0000-4000-8000-000000000002';
const otherRoomId = '71000000-0000-4000-8000-000000000003';
const mediaId = '71000000-0000-4000-8000-000000000004';
const auth = 'Bearer synthetic-room-cover-security-test';
const validKey = `rooms/${roomId}/cover/${mediaId}.jpg`;
const invalidKeys = [
  `profiles/${ownerId}/avatar/${mediaId}.jpg`,
  `profiles/${otherRoomId}/header/${mediaId}.jpg`,
  `dm/${roomId}/${otherRoomId}/${mediaId}.jpg`,
  `sauti/${otherRoomId}/${mediaId}.jpg`,
  `rooms/${otherRoomId}/cover/${mediaId}.jpg`,
  `rooms/${roomId}/cover/../${mediaId}.jpg`,
  `rooms/${roomId}/cover/${mediaId}.svg`,
  `rooms/${roomId}/cover/${mediaId}.jpg?source=private`,
  `rooms/${roomId}/cover/${mediaId}.jpg/extra`,
  `rooms/${roomId}/cover/not-a-uuid.jpg`,
  `${validKey}\n`,
  `${validKey}\0`,
];

function request(path = '/api/room-media/audit-room/cover', { method = 'GET', headers = {}, body, anonymous = false } = {}) {
  return new Request(`https://test.sautilink.com${path}`, {
    method,
    headers: { ...(anonymous ? {} : { Authorization: auth }), ...headers },
    ...(body === undefined ? {} : { body }),
  });
}

function harness(t, { key = validKey, images = false, cache = false, patchOk = true, storagePutFails = false, manager = true } = {}) {
  const fetches = [];
  const patches = [];
  const storage = { get: [], head: [], put: [], delete: [] };
  const cacheCalls = { match: [], put: [] };
  const room = { id: roomId, owner_id: manager ? ownerId : otherRoomId, slug: 'audit-room', privacy: 'private', cover_key: key };
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://rggpyiterdbbugluejcs.supabase.co', 'Every provider request is mocked; no network fallback');
    assert.equal(new Headers(options.headers).get('Authorization'), auth);
    fetches.push({ pathname: url.pathname, method: options.method || 'GET' });
    if (url.pathname === '/auth/v1/user') return Response.json({ id: ownerId });
    if (url.pathname === '/rest/v1/social_circle_members') return Response.json([{ member_role: 'member' }]);
    assert.equal(url.pathname, '/rest/v1/social_circles');
    if (options.method === 'PATCH') {
      assert.equal(url.searchParams.get('id'), `eq.${roomId}`);
      const patch = JSON.parse(options.body);
      patches.push(patch);
      if (!patchOk) return Response.json({ message: 'synthetic denial' }, { status: 403 });
      return Response.json([{ id: roomId, cover_key: patch.cover_key }]);
    }
    return Response.json([room]);
  });

  const env = {
    PROFILE_MEDIA: {
      async get(value) {
        storage.get.push(value);
        return { body: 'synthetic-scoped-original', httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { roomId, slot: 'room-cover', width: '800' } };
      },
      async head(value) { storage.head.push(value); throw new Error('Unexpected HEAD storage access'); },
      async put(value, bytes, options) {
        storage.put.push({ key: value, bytes: new Uint8Array(bytes), options });
        if (storagePutFails) throw new Error('Synthetic storage outage');
      },
      async delete(value) { storage.delete.push(value); },
    },
  };
  if (images) env.IMAGES = {
    input() {
      if (images === 'failure') throw new Error('Synthetic transform unavailable');
      return { transform() { return { async output() { return { response() { return new Response('synthetic-scoped-variant', { headers: { 'Content-Type': 'image/webp' } }); } }; } }; } };
    },
  };
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  t.after(() => {
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else delete globalThis.caches;
  });
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: {
    default: {
      async match(value) {
        const url = new URL(value.url);
        cacheCalls.match.push(url);
        if (cache === 'hit') return new Response('synthetic-scoped-cached', { headers: { 'Content-Type': 'image/webp' } });
        // A pre-fix entry can contain another namespace's image under a reused
        // filename. It must never match the new versioned/scoped cache key.
        if (cache === 'legacy-poison' && !url.searchParams.has('variant')) return new Response('synthetic-foreign-legacy-cache');
        return null;
      },
      async put(value, response) { cacheCalls.put.push({ url: new URL(value.url), body: await response.text() }); },
    },
  } });
  return { env, room, fetches, patches, storage, cacheCalls, run: req => handleRoomMediaRequest(req || request(), env) };
}

function assertNoStorage(h) {
  for (const calls of Object.values(h.storage)) assert.equal(calls.length, 0, 'Rejected metadata must not touch any R2 operation');
}

function pngFile() {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 800);
  view.setUint32(20, 300);
  return new File([bytes], 'synthetic-room-cover.png', { type: 'image/png' });
}

function uploadRequest() {
  const form = new FormData();
  form.set('room_id', roomId);
  form.set('file', pngFile());
  return request('/api/room-media/upload', { method: 'POST', body: form });
}

function removeRequest() {
  return request('/api/room-media/remove', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room_id: roomId }) });
}

test('foreign and malformed cover pointers are rejected before original, variant, HEAD, ETag or cache delivery', async t => {
  for (const [index, key] of invalidKeys.entries()) {
    for (const mode of ['original', 'cached-variant', 'HEAD', 'conditional']) {
      await t.test(`key ${index}: ${mode}`, async sub => {
        const h = harness(sub, { key, images: mode !== 'original', cache: 'hit' });
        const response = await h.run(request('/api/room-media/audit-room/cover?w=960', {
          method: mode === 'HEAD' ? 'HEAD' : 'GET',
          headers: mode === 'conditional' ? { 'If-None-Match': `"room-cover-room-scope-v2-${mediaId}-960"` } : {},
        }));
        assert.equal(response.status, 404);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assertNoStorage(h);
        assert.equal(h.cacheCalls.match.length, 0, 'The cache must not bypass the scope gate');
        assert.equal(h.cacheCalls.put.length, 0);
        assert.equal(h.patches.length, 0);
      });
    }
  }
});

test('all existing canonical JPEG, PNG and WebP cover keys keep original delivery', async t => {
  for (const extension of ['jpg', 'png', 'webp']) {
    await t.test(extension, async sub => {
      const key = `rooms/${roomId}/cover/${mediaId}.${extension}`;
      const h = harness(sub, { key });
      const response = await h.run();
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'synthetic-scoped-original');
      assert.deepEqual(h.storage.get, [key]);
      assert.equal(response.headers.get('Vary'), 'Authorization');
      assert.match(response.headers.get('Cache-Control'), /^private,/);
    });
  }
});

test('valid HEAD and conditional requests retain their fast paths after scope validation', async t => {
  const h = harness(t, { images: true });
  const head = await h.run(request(undefined, { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const etag = head.headers.get('ETag');
  assert.match(etag, /room-scope-v2/);
  const conditional = await h.run(request(undefined, { headers: { 'If-None-Match': etag } }));
  assert.equal(conditional.status, 304);
  assertNoStorage(h);
  assert.equal(h.cacheCalls.match.length, 0);
});

test('a valid variant miss never reuses an old cross-scope cached filename', async t => {
  const h = harness(t, { images: true, cache: 'legacy-poison' });
  const response = await h.run(request(`/api/room-media/audit-room/cover?w=960&v=foreign&variant=legacy&room=${otherRoomId}`));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'synthetic-scoped-variant');
  assert.deepEqual(h.storage.get, [validKey]);
  assert.equal(h.cacheCalls.match.length, 1);
  assert.equal(h.cacheCalls.put.length, 1);
  for (const url of [h.cacheCalls.match[0], h.cacheCalls.put[0].url]) {
    assert.equal(url.searchParams.get('variant'), 'room-scope-v2');
    assert.equal(url.searchParams.get('room'), roomId);
    assert.equal(url.searchParams.get('v'), mediaId);
  }
});

test('a scoped cache hit and transform fallback preserve authorized cover delivery', async t => {
  await t.test('versioned cache hit', async sub => {
    const h = harness(sub, { images: true, cache: 'hit' });
    const response = await h.run();
    assert.equal(await response.text(), 'synthetic-scoped-cached');
    assert.equal(response.headers.get('X-Sauti-Room-Cover-Cache'), 'HIT');
    assertNoStorage(h);
    assert.equal(h.cacheCalls.match[0].searchParams.get('room'), roomId);
  });
  await t.test('transform unavailable', async sub => {
    const h = harness(sub, { images: 'failure' });
    const response = await h.run();
    assert.equal(await response.text(), 'synthetic-scoped-original');
    assert.deepEqual(h.storage.get, [validKey]);
  });
});

test('removing a planted pointer clears only the owned Room metadata and never deletes a foreign object', async t => {
  for (const [index, key] of invalidKeys.entries()) {
    await t.test(`key ${index}`, async sub => {
      const h = harness(sub, { key });
      const response = await h.run(removeRequest());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.removed, true);
      assert.equal(h.patches.length, 1);
      assert.equal(h.patches[0].cover_key, null);
      assertNoStorage(h);
    });
  }
});

test('valid removal deletes only its own canonical object after metadata is cleared', async t => {
  const h = harness(t);
  const response = await h.run(removeRequest());
  assert.equal(response.status, 200);
  assert.equal(h.patches[0].cover_key, null);
  assert.deepEqual(h.storage.delete, [validKey]);
});

test('replacing a planted pointer uploads a valid Room cover and skips foreign cleanup', async t => {
  for (const [index, key] of invalidKeys.entries()) {
    await t.test(`key ${index}`, async sub => {
      const h = harness(sub, { key });
      const response = await h.run(uploadRequest());
      assert.equal(response.status, 200);
      assert.equal(h.storage.put.length, 1);
      const uploadedKey = h.storage.put[0].key;
      assert.match(uploadedKey, new RegExp(`^rooms/${roomId}/cover/[0-9a-f-]{36}\\.png$`));
      assert.equal(h.patches[0].cover_key, uploadedKey);
      assert.deepEqual(h.storage.delete, []);
      assert.equal(h.storage.put[0].options.customMetadata.roomId, roomId);
    });
  }
});

test('successful replacement cleans only the previous scoped cover', async t => {
  const h = harness(t);
  const response = await h.run(uploadRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(h.storage.delete, [validKey]);
  assert.notEqual(h.storage.put[0].key, validKey);
});

test('upload and metadata failures clean only the newly generated scoped object', async t => {
  for (const options of [{ patchOk: false }, { storagePutFails: true }]) {
    await t.test(JSON.stringify(options), async sub => {
      const h = harness(sub, { key: invalidKeys[2], ...options });
      const response = await h.run(uploadRequest());
      assert.ok([409, 502].includes(response.status));
      assert.equal(h.storage.put.length, 1);
      assert.deepEqual(h.storage.delete, [h.storage.put[0].key]);
      assert.match(h.storage.delete[0], new RegExp(`^rooms/${roomId}/cover/[0-9a-f-]{36}\\.png$`));
    });
  }
});

test('failed metadata removal never deletes a stored cover', async t => {
  const h = harness(t, { patchOk: false });
  const response = await h.run(removeRequest());
  assert.equal(response.status, 409);
  assertNoStorage(h);
});

test('authentication and manager checks remain required before storage changes', async t => {
  await t.test('anonymous original delivery', async sub => {
    const h = harness(sub);
    const response = await h.run(request(undefined, { anonymous: true }));
    assert.equal(response.status, 401);
    assert.equal(h.fetches.length, 0);
    assertNoStorage(h);
  });
  await t.test('non-manager removal and upload', async sub => {
    const h = harness(sub, { manager: false });
    assert.equal((await h.run(removeRequest())).status, 403);
    assert.equal((await h.run(uploadRequest())).status, 403);
    assert.equal(h.patches.length, 0);
    assertNoStorage(h);
  });
});
