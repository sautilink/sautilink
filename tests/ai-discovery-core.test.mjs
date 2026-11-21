import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOVERY_MODEL, DISCOVERY_DIMENSIONS, isPublicDiscoveryPost,
  indexPublicPost, removePostVector, findSimilarPublicPostIds, rerankEligiblePublicPosts,
} from '../src/ai-discovery-core.js';

const USER_A = '12345678-1234-4234-8234-1234567890aa';
const USER_B = '12345678-1234-4234-8234-1234567890bb';
const POST_A = '12345678-1234-4234-8234-1234567890a1';
const POST_B = '12345678-1234-4234-8234-1234567890a2';
const POST_C = '12345678-1234-4234-8234-1234567890a3';
const base = (id, author_id = USER_A) => ({
  id, author_id, body: 'Smartphones and software in Tanzania',
  visibility: 'public', post_status: 'published', moderation_state: 'visible',
  deleted_at: null, circle_id: null, parent_post_id: null,
  created_at: '2026-11-14T00:00:00.000Z', viewer_authorized: true,
  like_count: 3, comment_count: 1, repost_count: 0,
});

function mockBindings() {
  const calls = { ai: [], upsert: [], query: [] };
  return {
    calls,
    ai: { async run(model, payload) {
      calls.ai.push({ model, payload });
      return { data: [{ embedding: Array(DISCOVERY_DIMENSIONS).fill(0.5) }] };
    } },
    index: {
      async upsert(vectors) {
        calls.upsert.push(vectors);
        return { mutationId: 'queued-test-mutation' };
      },
      async query(values, options) {
        calls.query.push({ values, options });
        return { matches: [{ id: POST_A, score: 0.85 }, { id: 'invalid-id', score: 1 }] };
      },
    },
  };
}

test('discovery indexes published visible public posts only', async () => {
  const valid = base(POST_A);
  assert.equal(isPublicDiscoveryPost(valid), true);
  for (const change of [
    { visibility: 'followers' }, { visibility: 'circle' }, { moderation_state: 'removed' },
    { post_status: 'draft' }, { deleted_at: '2026-11-14T00:00:00Z' },
    { circle_id: POST_C }, { parent_post_id: POST_C },
  ]) assert.equal(isPublicDiscoveryPost({ ...valid, ...change }), false);
  const bindings = mockBindings();
  const skip = await indexPublicPost({ ...valid, moderation_state: 'removed' }, bindings);
  assert.equal(skip.indexed, false);
  assert.equal(bindings.calls.ai.length, 0);
  assert.equal(bindings.calls.upsert.length, 0);
  const created = await indexPublicPost(valid, bindings);
  assert.equal(created.indexed, true);
  assert.equal(bindings.calls.ai[0].model, DISCOVERY_MODEL);
  assert.equal(bindings.calls.ai[0].payload.dimensions, 256);
  assert.equal(bindings.calls.upsert[0][0].metadata.visibility, 'public');
  assert.equal(bindings.calls.upsert[0][0].values.length, 256);
});

test('embedding size errors fail closed, not index invalid vectors', async () => {
  const bindings = mockBindings();
  bindings.ai.run = async () => ({ data: [{ embedding: [0.1] }] });
  await assert.rejects(indexPublicPost(base(POST_A), bindings), /dimensions/);
  assert.equal(bindings.calls.upsert.length, 0);
});

test('semantic queries return candidate IDs only; filtering is explicitly public', async () => {
  const bindings = mockBindings();
  const matches = await findSimilarPublicPostIds('technology phones', bindings, 100);
  assert.deepEqual(matches, [{ id: POST_A, score: 0.85 }]);
  assert.equal(bindings.calls.query[0].options.topK, 50);
  assert.deepEqual(bindings.calls.query[0].options.filter, { visibility: 'public' });
  assert.deepEqual(await findSimilarPublicPostIds('  ', bindings), []);
});

test('reranking preserves viewer eligibility and author diversity', () => {
  const posts = [
    { ...base(POST_A), baseline_score: 0.9 },
    { ...base(POST_B), baseline_score: 0.9 },
    { ...base(POST_C, USER_B), baseline_score: 0.5 },
    { ...base('12345678-1234-4234-8234-1234567890a4'), viewer_authorized: false },
    { ...base('12345678-1234-4234-8234-1234567890a5'), visibility: 'followers' },
    { ...base('12345678-1234-4234-8234-1234567890a6'), moderation_state: 'removed' },
    { ...base('12345678-1234-4234-8234-1234567890a7'), viewer_blocked: true },
    { ...base('12345678-1234-4234-8234-1234567890a8'), viewer_muted: true },
  ];
  const ranked = rerankEligiblePublicPosts(posts, [{ id: POST_A, score: 0.95 }, { id: POST_B, score: 0.9 }], {
    now: Date.parse('2026-11-14T01:00:00.000Z'), limit: 10, maxPerAuthor: 1,
  });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, POST_A);
  assert.equal(ranked[1].id, POST_C);
});

test('vector deletion is explicit for changes and invalid ids are rejected', async () => {
  const removed = [];
  const index = { deleteByIds: async (ids) => { removed.push(...ids); return { mutationId: 'delete' }; } };
  await removePostVector(POST_A, index);
  assert.deepEqual(removed, [POST_A]);
  await assert.rejects(removePostVector('bad-id', index), /Invalid post id/);
});
