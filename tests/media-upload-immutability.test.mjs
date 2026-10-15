import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSautiMediaRequest } from '../src/sauti-media-api.js';
import { handleSautiRequest } from '../src/sauti-posts-api.js';

const USER = '10000000-0000-4000-8000-000000000004';
const ID = '30000000-0000-4000-8000-000000000001';
const SECOND = '30000000-0000-4000-8000-000000000002';
const POST = '60000000-0000-4000-8000-000000000001';
const KEY = `sauti/${USER}/${ID}.png`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
function png(width = 10) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, 20, false);
  return bytes;
}
const row = () => ({ id: ID, owner_id: USER, post_id: null, object_key: KEY, media_kind: 'image',
  content_type: 'image/png', size_bytes: 24, upload_status: 'pending', expires_at: '2099-01-01T00:00:00Z' });
const upload = (bytes = png()) => new Request(`https://sautilink.com/api/sauti-media/upload/${ID}`, {
  method: 'PUT', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'image/png' }, body: bytes,
});
async function mockFetch(mock, run) {
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => String(url).endsWith('/auth/v1/user') ? json({ id: USER }) : mock(new URL(url), init);
  try { return await run(); } finally { globalThis.fetch = saved; }
}

test('stale PUT crossing ready/held or attached transition cannot overwrite or delete the first object', async () => {
  for (const advanced of ['held', 'attached']) {
    let current = row();
    const original = png(5);
    let stored = original;
    let putOptions;
    const deletions = [];
    const request = upload(png(15));
    request.arrayBuffer = async () => {
      current = { ...current, upload_status: advanced === 'attached' ? 'attached' : 'ready', post_id: advanced === 'attached' ? POST : null };
      return png(15).buffer;
    };
    await mockFetch(async (_, init) => {
      if (!init.method) return json([{ ...current }]);
      if (init.method === 'PATCH') return json({ message: 'MEDIA_HELD_FOR_ROOM_REVIEW' }, 403);
      if (init.method === 'DELETE') return json({ message: 'MEDIA_HELD_FOR_ROOM_REVIEW' }, 403);
      assert.fail(init.method);
    }, async () => {
      const response = await handleSautiMediaRequest(request, { SAUTI_MEDIA: {
        put: async (_, bytes, options) => {
          putOptions = options;
          if (stored && options.onlyIf?.etagDoesNotMatch === '*') return null;
          stored = bytes; return { key: KEY };
        }, delete: async (key) => { deletions.push(key); stored = null; },
      } });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, 'UPLOAD_ALREADY_STORED');
    });
    assert.deepEqual(putOptions.onlyIf, { etagDoesNotMatch: '*' });
    assert.deepEqual(stored, original);
    assert.deepEqual(deletions, []);
  }
});

test('two PUTs which both read pending perform exactly one immutable R2 write', async () => {
  let current = row();
  let stored;
  let writes = 0;
  const waiting = [];
  const a = upload(png(10));
  const b = upload(png(15));
  for (const [request, bytes] of [[a, png(10)], [b, png(15)]]) {
    request.arrayBuffer = () => new Promise((resolve) => waiting.push(() => resolve(bytes.buffer)));
  }
  await mockFetch(async (_, init) => {
    if (!init.method) return json([{ ...current }]);
    if (init.method === 'PATCH') {
      current = { ...current, ...JSON.parse(init.body) };
      return json([{ id: ID, upload_status: 'uploaded' }]);
    }
    assert.fail('Concurrent first-write conflict must not clean another object');
  }, async () => {
    const env = { SAUTI_MEDIA: {
      put: async (_, bytes, options) => {
        if (stored && options.onlyIf?.etagDoesNotMatch === '*') return null;
        writes += 1; stored = bytes; return { key: KEY };
      }, delete: async () => assert.fail('Concurrent object deleted'),
    } };
    const first = handleSautiMediaRequest(a, env);
    const second = handleSautiMediaRequest(b, env);
    while (waiting.length < 2) await new Promise((resolve) => setImmediate(resolve));
    waiting.forEach((resume) => resume());
    const responses = await Promise.all([first, second]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(writes, 1);
    assert.deepEqual(stored, png(10));
  });
});

test('metadata failure cleanup requires confirmed deletion of still-pending, unattached metadata', async () => {
  for (const state of ['pending-deleted', 'held', 'attached', 'delete-error', 'delete-zero']) {
    const operations = [];
    await mockFetch(async (url, init) => {
      if (!init.method) return json([row()]);
      if (init.method === 'PATCH') {
        operations.push('patch');
        assert.equal(url.searchParams.get('upload_status'), 'eq.pending');
        assert.equal(url.searchParams.get('post_id'), 'is.null');
        return json([], 200);
      }
      if (init.method === 'DELETE') {
        operations.push('db-delete');
        assert.equal(url.searchParams.get('upload_status'), 'eq.pending');
        assert.equal(url.searchParams.get('post_id'), 'is.null');
        return state === 'pending-deleted' ? json([{ id: ID }]) : state === 'delete-error' ? json({ message: 'denied' }, 403) : json([]);
      }
      assert.fail(init.method);
    }, async () => {
      const response = await handleSautiMediaRequest(upload(), { SAUTI_MEDIA: {
        put: async () => { operations.push('first-put'); return { key: KEY }; },
        delete: async () => operations.push('r2-delete'),
      } });
      assert.equal(response.status, 409);
    });
    assert.deepEqual(operations, state === 'pending-deleted' ? ['first-put', 'patch', 'db-delete', 'r2-delete'] : ['first-put', 'patch', 'db-delete']);
  }
});

test('lost body and uncertain R2 failure never delete a possibly stored object', async () => {
  for (const failure of ['body', 'put']) {
    const request = upload();
    if (failure === 'body') request.arrayBuffer = async () => { throw new Error('fixture disconnect'); };
    await mockFetch(async (_, init) => {
      if (!init.method) return json([row()]);
      assert.fail('Interrupted upload must not mutate metadata');
    }, async () => {
      const response = await handleSautiMediaRequest(request, { SAUTI_MEDIA: {
        put: async () => { if (failure === 'body') assert.fail('Body was not received'); throw new Error('fixture R2 timeout'); },
        delete: async () => assert.fail('Uncertain upload deleted bytes'),
      } });
      assert.equal(response.status, failure === 'body' ? 400 : 502);
    });
  }
});

test('post rollback checks current media row rather than stale attached log before deleting R2', async () => {
  for (const afterFirstAttach of ['requeued-held', 'cascade-absent', 'lookup-error']) {
    const deletions = [];
    let attachmentCount = 0;
    await mockFetch(async (url, init) => {
      if (url.pathname.endsWith('/room_held_media_uploads')) return json([]);
      if (url.pathname === '/rest/v1/social_posts') return init.method === 'POST' ? json([{ id: POST }], 201) : json([{ id: POST }]);
      assert.equal(url.pathname, '/rest/v1/social_post_media');
      const id = url.searchParams.get('id')?.slice(3);
      if (init.method === 'PATCH') {
        attachmentCount += 1;
        return attachmentCount === 1 ? json([{ id: ID }]) : json({ message: 'fixture attach failure' }, 409);
      }
      if (init.method === 'DELETE') {
        if (id === SECOND) return json([{ id: SECOND }]);
        return afterFirstAttach === 'requeued-held' ? json({ message: 'MEDIA_HELD_FOR_ROOM_REVIEW' }, 403) : json([]);
      }
      if (url.searchParams.get('select') === 'id') {
        return afterFirstAttach === 'lookup-error' ? json({ message: 'fixture unavailable' }, 503) : json(afterFirstAttach === 'requeued-held' ? [{ id: ID }] : []);
      }
      return json([{ ...row(), id, object_key: id === ID ? KEY : `sauti/${USER}/${SECOND}.png`, upload_status: 'ready' }]);
    }, async () => {
      const response = await handleSautiRequest(new Request('https://sautilink.com/api/sauti', {
        method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Rollback fixture', media: [{ id: ID }, { id: SECOND }] }),
      }), {
        SAUTI_CREATE_LIMITER: { limit: async () => ({ success: true }) },
        SAUTI_MEDIA: { head: async (key) => ({ size: 24, customMetadata: { ownerId: USER, mediaId: key === KEY ? ID : SECOND, validated: 'true' } }),
          delete: async (key) => deletions.push(key) },
      });
      assert.equal(response.status, 409);
    });
    assert.equal(deletions.includes(KEY), afterFirstAttach === 'cascade-absent');
    assert.ok(deletions.includes(`sauti/${USER}/${SECOND}.png`));
  }
});
