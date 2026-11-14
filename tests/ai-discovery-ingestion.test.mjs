import test from 'node:test';
import assert from 'node:assert/strict';
import { syncDiscoveryPost } from '../src/ai-discovery-ingestion.js';

const AUTHOR = '12345678-1234-4234-8234-1234567890bb';
const POST = '12345678-1234-4234-8234-1234567890a1';
function valid() {
  return {
    id: POST, author_id: AUTHOR, audience_owner_id: AUTHOR,
    body: 'Public technology tutorial',
    visibility: 'public', post_status: 'published',
    moderation_state: 'visible', deleted_at: null, circle_id: null,
    parent_post_id: null, updated_at: '2026-11-14T19:00:00Z',
  };
}
function setup(reads, discoverable = true) {
  const calls = { reads: 0, embed: 0, upserts: [], deletes: [] };
  const deps = {
    calls,
    fetchPost: async () => reads[Math.min(calls.reads++, reads.length - 1)],
    authorAndAudienceDiscoverable: async () => discoverable,
    ai: { async run() {
      calls.embed++;
      return { data: [{ embedding: Array(256).fill(0.1) }] };
    } },
    index: {
      async upsert(vectors) { calls.upserts.push(vectors); return { mutationId: 'test-queued' }; },
      async deleteByIds(ids) { calls.deletes.push(...ids); return { mutationId: 'test-removed' }; },
    },
  };
  return deps;
}

test('valid published public post is indexed only after a second DB read', async () => {
  const deps = setup([valid(), valid()]);
  const result = await syncDiscoveryPost(POST, deps);
  assert.deepEqual(result, { synced: true, action: 'indexed', mutationId: 'test-queued' });
  assert.equal(deps.calls.reads, 2);
  assert.equal(deps.calls.embed, 1);
  assert.equal(deps.calls.upserts.length, 1);
  assert.equal(deps.calls.upserts[0][0].values.length, 256);
  assert.deepEqual(deps.calls.deletes, []);
});

test('deleted, followers-only, circle, removed and non-discoverable posts revoke vectors', async () => {
  for (const row of [
    null,
    { ...valid(), visibility: 'followers' },
    { ...valid(), visibility: 'circle' },
    { ...valid(), circle_id: POST },
    { ...valid(), moderation_state: 'removed' },
    { ...valid(), post_status: 'draft' },
    { ...valid(), deleted_at: '2026-11-14T20:00:00Z' },
  ]) {
    const deps = setup([row]);
    const result = await syncDiscoveryPost(POST, deps);
    assert.equal(result.action, 'removed');
    assert.deepEqual(deps.calls.deletes, [POST]);
    assert.equal(deps.calls.embed, 0);
  }
  const hiddenAuthor = setup([valid()], false);
  assert.equal((await syncDiscoveryPost(POST, hiddenAuthor)).action, 'removed');
  assert.equal(hiddenAuthor.calls.upserts.length, 0);
});

test('edit during inference invalidates old vector rather than indexing stale text', async () => {
  const deps = setup([valid(), { ...valid(), body: 'Updated text', updated_at: '2026-11-14T19:01:00Z' }]);
  const result = await syncDiscoveryPost(POST, deps);
  assert.equal(result.reason, 'changed_during_inference');
  assert.deepEqual(deps.calls.deletes, [POST]);
  assert.equal(deps.calls.upserts.length, 0);
});

test('moderation change during inference prevents stale indexing', async () => {
  const deps = setup([valid(), { ...valid(), moderation_state: 'removed' }]);
  const result = await syncDiscoveryPost(POST, deps);
  assert.equal(result.action, 'removed');
  assert.deepEqual(deps.calls.deletes, [POST]);
  assert.equal(deps.calls.upserts.length, 0);
});

test('temporary reader failures do not silently mark post deleted', async () => {
  const deps = setup([valid()]);
  deps.fetchPost = async () => { throw new Error('Database unavailable'); };
  await assert.rejects(syncDiscoveryPost(POST, deps), /Database unavailable/);
  assert.deepEqual(deps.calls.deletes, []);
});

test('invalid post IDs are rejected without side effects', async () => {
  const deps = setup([valid()]);
  await assert.rejects(syncDiscoveryPost('bad-id', deps), /Invalid post id/);
  assert.equal(deps.calls.reads, 0);
  assert.equal(deps.calls.embed, 0);
});
