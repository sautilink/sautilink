import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAIDiscoveryPreviewRequest } from '../src/ai-discovery-preview-api.js';

const USER = '12345678-1234-4234-8234-1234567890aa';
const AUTHOR = '12345678-1234-4234-8234-1234567890bb';
const VISIBLE = '12345678-1234-4234-8234-1234567890a1';
const FILTERED = '12345678-1234-4234-8234-1234567890a2';
const url = 'https://test.sautilink.com/api/internal/ai-discovery/preview?q=technology';
function request(jwt = 'valid.user.token', at = url) {
  return new Request(at, { headers: jwt ? { Authorization: 'Bearer ' + jwt } : {} });
}
function environment() {
  const calls = { ai: 0, vector: 0, limiter: 0 };
  return {
    calls,
    AI_DISCOVERY_PREVIEW_ENABLED: 'true',
    DISCOVERY_SUPABASE_URL: 'https://example.supabase.co',
    DISCOVERY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    AI_DISCOVERY_PREVIEW_LIMITER: { async limit({ key }) {
      assert.equal(key, USER);
      calls.limiter++;
      return { success: true };
    } },
    AI: { async run() {
      calls.ai++;
      return { data: [{ embedding: Array(256).fill(0.25) }] };
    } },
    DISCOVERY_VECTOR_INDEX: { async query(_vector, options) {
      calls.vector++;
      assert.deepEqual(options.filter, { visibility: 'public' });
      return { matches: [{ id: VISIBLE, score: 0.93 }, { id: FILTERED, score: 0.85 }] };
    } },
  };
}
function dataRow(id = VISIBLE) {
  return {
    id, author_id: AUTHOR, visibility: 'public', post_status: 'published',
    moderation_state: 'visible', deleted_at: null, circle_id: null,
    parent_post_id: null, created_at: '2026-11-14T19:00:00.000Z',
    like_count: 4, comment_count: 0, repost_count: 0,
  };
}
function mockFetch(logs = [], { denied = false, visibleRows = [dataRow()] } = {}) {
  return async (uri, init) => {
    const parsed = new URL(String(uri));
    logs.push({ pathname: parsed.pathname, url: parsed, headers: init.headers });
    assert.equal(init.headers.apikey, 'sb_publishable_example');
    assert.equal(init.headers.Authorization, 'Bearer valid.user.token');
    if (parsed.pathname === '/auth/v1/user') return Response.json({ id: USER });
    if (parsed.pathname === '/rest/v1/social_posts') {
      assert.equal(parsed.searchParams.get('visibility'), 'eq.public');
      assert.equal(parsed.searchParams.get('moderation_state'), 'eq.visible');
      assert.equal(parsed.searchParams.get('post_status'), 'eq.published');
      assert.equal(parsed.searchParams.get('deleted_at'), 'is.null');
      assert.equal(parsed.searchParams.get('circle_id'), 'is.null');
      assert.equal(parsed.searchParams.get('parent_post_id'), 'is.null');
      assert.match(parsed.searchParams.get('id'), /in\.\(/);
      return denied ? new Response('server unavailable', { status: 503 }) : Response.json(visibleRows);
    }
    throw new Error('Unexpected path: ' + parsed.pathname);
  };
}

test('preview remains inaccessible on production, even with staging flag', async () => {
  const env = environment();
  const response = await handleAIDiscoveryPreviewRequest(
    request('valid.user.token', 'https://sautilink.com/api/internal/ai-discovery/preview?q=technology'), env,
    async () => { throw new Error('never fetch'); },
  );
  assert.equal(response.status, 404);
  assert.equal(env.calls.ai, 0);
});

test('preview is opt-in and rejects missing capabilities', async () => {
  const env = environment();
  env.AI_DISCOVERY_PREVIEW_ENABLED = 'false';
  assert.equal((await handleAIDiscoveryPreviewRequest(request(), env)).status, 404);
  env.AI_DISCOVERY_PREVIEW_ENABLED = 'true';
  delete env.AI_DISCOVERY_PREVIEW_LIMITER;
  assert.equal((await handleAIDiscoveryPreviewRequest(request(), env)).status, 503);
});

test('preview authenticates before inference, rate limiting or vector queries', async () => {
  const env = environment();
  const authFetch = async (uri) => {
    assert.equal(new URL(String(uri)).pathname, '/auth/v1/user');
    return new Response('denied', { status: 401 });
  };
  const response = await handleAIDiscoveryPreviewRequest(request(), env, authFetch);
  assert.equal(response.status, 401);
  assert.equal(env.calls.ai, 0);
  assert.equal(env.calls.limiter, 0);
  assert.equal(env.calls.vector, 0);
});

test('preview returns only viewer-authorized public IDs after PostgREST RLS', async () => {
  const env = environment();
  const calls = [];
  // RLS excludes FILTERED; it may be blocked, muted or undiscoverable.
  const response = await handleAIDiscoveryPreviewRequest(request(), env, mockFetch(calls));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.deepEqual(await response.json(), {
    ok: true, post_ids: [VISIBLE], count: 1, experimental: true,
  });
  assert.deepEqual(calls.map((x) => x.pathname), ['/auth/v1/user', '/rest/v1/social_posts']);
  assert.equal(env.calls.ai, 1);
  assert.equal(env.calls.vector, 1);
  assert.equal(env.calls.limiter, 1);
});

test('preview fails closed if RLS read fails', async () => {
  const env = environment();
  const response = await handleAIDiscoveryPreviewRequest(request(), env, mockFetch([], { denied: true }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false, error: 'DISCOVERY_UNAVAILABLE', fallback: 'current_feed',
  });
});

test('preview ignores ineligible rows even if the data API accidentally provides them', async () => {
  const env = environment();
  const response = await handleAIDiscoveryPreviewRequest(request(), env, mockFetch([], {
    visibleRows: [{ ...dataRow(), moderation_state: 'removed' }, dataRow(FILTERED)],
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).post_ids, [FILTERED]);
});

test('preview has no route response for unrelated paths', async () => {
  const env = environment();
  const response = await handleAIDiscoveryPreviewRequest(
    request(null, 'https://test.sautilink.com/api/health'), env,
  );
  assert.equal(response, null);
});
