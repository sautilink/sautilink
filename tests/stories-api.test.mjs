import test from 'node:test';
import assert from 'node:assert/strict';
import { handleStoriesRequest, groupStories, runStoriesAndStreamMaintenance } from '../src/stories-api.js';

const ID = '00000000-0000-4000-8000-000000000001';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'Bearer synthetic-story-test-token';
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64'));
const future = () => new Date(Date.now() + 60_000).toISOString();
const expired = () => new Date(Date.now() - 1_000).toISOString();
const author = (id = OWNER) => ({ id, username: 'sampleuser', display_name: 'Sample User', is_verified: true, verification_badge_type: 'standard', has_avatar: true });
const row = (overrides = {}) => ({ id: ID, owner_id: OWNER, media_kind: 'image', content_type: 'image/png',
  object_key: `stories/${OWNER}/${ID}.png`, size_bytes: PNG.length, caption: 'A real moment',
  published_at: new Date(Date.now() - 1_000).toISOString(), expires_at: future(), upload_expires_at: future(),
  width: 1, height: 1, viewed: false, view_count: 2, author: author(), ...overrides });
function request(path, method = 'GET', value, headers = {}) {
  const isBytes = value instanceof Uint8Array;
  return new Request(`https://sautilink.com${path}`, { method,
    headers: { Authorization: TOKEN, ...(value !== undefined ? { 'Content-Type': isBytes ? 'image/png' : 'application/json' } : {}), ...headers },
    ...(value !== undefined ? { body: isBytes ? value : JSON.stringify(value) } : {}) });
}
function bucket() {
  const map = new Map(); const writes = []; const deletes = [];
  return {
    map, writes, deletes,
    async head(key) { return map.get(key) || null; },
    async get(key) {
      const object = map.get(key);
      return object ? { ...object, body: new Uint8Array(object.bytes), async text() { return new TextDecoder().decode(object.bytes); },
        async json() { return JSON.parse(new TextDecoder().decode(object.bytes)); } } : null;
    },
    async put(key, value, options = {}) {
      writes.push({ key, options });
      if (options.onlyIf?.etagDoesNotMatch === '*' && map.has(key)) return null;
      if (options.onlyIf?.etagMatches && map.get(key)?.etag !== options.onlyIf.etagMatches) return null;
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
      const object = { bytes, size: bytes.length, etag: `test-etag-${writes.length}`,
        customMetadata: options.customMetadata || {}, httpMetadata: options.httpMetadata || {} };
      map.set(key, object); return object;
    },
    async delete(key) { deletes.push(key); map.delete(key); },
    async list() { return { objects: [], truncated: false }; }
  };
}
function environment(overrides = {}) {
  return { SAUTI_STORIES_ENABLED: 'true', SAUTI_STORIES_WORKER_KEY: 'synthetic-worker-key', SAUTI_MEDIA: bucket(),
    SAUTI_MEDIA_BEGIN_LIMITER: { async limit() { return { success: true }; } },
    SOCIAL_LIKE_LIMITER: { async limit() { return { success: true }; } }, ...overrides };
}
async function usingRpc(routes, callback) {
  const saved = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const match = /^https:\/\/rggpyiterdbbugluejcs\.supabase\.co\/rest\/v1\/rpc\/([a-z_]+)$/.exec(String(url));
    assert.ok(match, 'No external provider or user request is allowed in fixture tests');
    const args = JSON.parse(options.body || '{}'); const name = match[1];
    calls.push({ name, args, headers: options.headers });
    assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal, 'RPC calls have a deadline');
    if (!(name in routes)) throw new Error(`Unexpected RPC ${name}`);
    const result = typeof routes[name] === 'function' ? await routes[name](args, calls) : routes[name];
    return result instanceof Response ? result : new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  };
  try { await callback(calls); } finally { globalThis.fetch = saved; }
}
function dbError(message, status = 400) { return new Response(JSON.stringify({ message }), { status }); }
async function data(response, expected = 200) { assert.equal(response.status, expected); return response.json(); }
async function seedImage(env, item = row()) {
  await env.SAUTI_MEDIA.put(item.object_key, PNG, { httpMetadata: { contentType: item.content_type },
    customMetadata: { validated: 'true', ownerId: item.owner_id, storyId: item.id, width: '1', height: '1' } });
}

test('disabled Stories and unauthenticated requests fail closed before touching storage or RPC', async () => {
  await usingRpc({}, async (calls) => {
    assert.equal((await handleStoriesRequest(request('/api/stories'), environment({ SAUTI_STORIES_ENABLED: 'false' }))).status, 503);
    for (const Authorization of ['', 'Basic synthetic', 'Bearer bad token']) {
      assert.equal((await handleStoriesRequest(request('/api/stories', 'GET', undefined, { Authorization }), environment())).status, 401);
    }
    assert.equal(calls.length, 0);
    assert.equal(await handleStoriesRequest(request('/api/unrelated'), environment()), null);
  });
});

test('feed/profile use authenticated RPCs and expose only public first-party media paths', async () => {
  const item = row({ stream_uid: 'provider-secret', object_key: 'internal-key-secret' });
  await usingRpc({ stories_feed: [item], stories_quota: { images_used: 1, videos_used: 0, resets_at: future() } }, async (calls) => {
    const output = await data(await handleStoriesRequest(request('/api/stories'), environment()));
    assert.equal(output.data.groups[0].author.username, 'sampleuser');
    assert.equal(output.data.groups[0].stories[0].media_path, `/api/stories/${ID}/media`);
    assert.equal(output.data.groups[0].stories[0].thumbnail_path, `/api/stories/${ID}/media?w=480`);
    assert.equal(output.data.groups[0].unseen_count, 1);
    assert.equal(output.data.quota.images_used, 1);
    assert.ok(Number.isFinite(Date.parse(output.data.server_now)));
    assert.ok(!JSON.stringify(output).includes('provider-secret'));
    assert.ok(!JSON.stringify(output).includes('internal-key-secret'));
    assert.ok(calls.every((call) => call.headers.Authorization === TOKEN));
    await data(await handleStoriesRequest(request('/api/stories/profile/sampleuser'), environment()));
    assert.equal(calls.findLast((call) => call.name === 'stories_feed').args.p_username, 'sampleuser');
  });
});

test('expired, malformed-expiry and cross-owner author rows are excluded from grouped previews', () => {
  assert.equal(groupStories([row({ expires_at: expired() })]).length, 0);
  assert.equal(groupStories([row({ expires_at: 'not-a-date' })]).length, 0);
  assert.equal(groupStories([row({ author: author(OTHER) })]).length, 0);
});

test('image reservation validates media type, byte limits, idempotency UUID and requires rate limiter', async () => {
  const good = { media_kind: 'image', content_type: 'image/png', size_bytes: PNG.length, idempotency_key: KEY };
  await usingRpc({ stories_reserve: row() }, async (calls) => {
    const output = await data(await handleStoriesRequest(request('/api/stories/uploads', 'POST', good), environment()), 201);
    assert.equal(output.data.upload_id, ID); assert.equal(output.data.upload_method, 'PUT');
    assert.equal(output.data.upload_url, `https://sautilink.com/api/stories/uploads/${ID}`);
    assert.equal(calls[0].args.p_client_key, KEY);
    const count = calls.length;
    for (const patch of [{ media_kind: 'audio' }, { content_type: 'text/html' }, { content_type: 'video/mp4' },
      { size_bytes: 0 }, { size_bytes: 8 * 1024 * 1024 + 1 }, { size_bytes: 1.5 }, { idempotency_key: 'forged' }]) {
      assert.equal((await handleStoriesRequest(request('/api/stories/uploads', 'POST', { ...good, ...patch }), environment())).status, 400);
    }
    assert.equal(calls.length, count);
    assert.equal((await handleStoriesRequest(request('/api/stories/uploads', 'POST', good), environment({ SAUTI_MEDIA_BEGIN_LIMITER: undefined }))).status, 503);
    assert.equal((await handleStoriesRequest(request('/api/stories/uploads', 'POST', good), environment({ SAUTI_MEDIA_BEGIN_LIMITER: { async limit() { return { success: false }; } } }))).status, 429);
    assert.equal(calls.length, count);
  });
});

test('reservation surfaces server quota as 429 and never exposes database errors', async () => {
  await usingRpc({ stories_reserve: dbError('STORY_QUOTA_REACHED: private database detail') }, async () => {
    const response = await handleStoriesRequest(request('/api/stories/uploads', 'POST', {
      media_kind: 'image', content_type: 'image/png', size_bytes: PNG.length, idempotency_key: KEY }), environment());
    const output = await data(response, 429);
    assert.equal(output.error.code, 'STORY_QUOTA_REACHED');
    assert.ok(!JSON.stringify(output).includes('private database detail'));
  });
});

test('JSON endpoints reject wrong content type, malformed body and oversized streamed data', async () => {
  await usingRpc({}, async (calls) => {
    const plain = new Request('https://sautilink.com/api/stories', { method: 'POST', headers: { Authorization: TOKEN, 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal((await handleStoriesRequest(plain, environment())).status, 415);
    for (const value of ['broken-json', '[]', 'null', `{"caption":"${'x'.repeat(9_000)}"}`]) {
      const bad = new Request('https://sautilink.com/api/stories', { method: 'POST', headers: { Authorization: TOKEN, 'Content-Type': 'application/json' }, body: value });
      assert.ok([400, 413].includes((await handleStoriesRequest(bad, environment())).status));
    }
    assert.equal(calls.length, 0);
  });
});

test('image upload inspects actual bytes and exact MIME/size before storing immutable validated object', async () => {
  const env = environment();
  await usingRpc({ stories_upload: row() }, async (calls) => {
    await data(await handleStoriesRequest(request(`/api/stories/uploads/${ID}`, 'PUT', PNG), env));
    assert.equal(env.SAUTI_MEDIA.writes.length, 1);
    assert.equal(env.SAUTI_MEDIA.writes[0].options.onlyIf.etagDoesNotMatch, '*');
    assert.equal(env.SAUTI_MEDIA.writes[0].options.customMetadata.ownerId, OWNER);
    const status = await data(await handleStoriesRequest(request(`/api/stories/uploads/${ID}`), env));
    assert.equal(status.data.uploaded, true); assert.equal(status.data.ready, true);
    const saved = env.SAUTI_MEDIA.map.get(row().object_key).bytes.slice();
    await data(await handleStoriesRequest(request(`/api/stories/uploads/${ID}`, 'PUT', PNG), env));
    assert.deepEqual(env.SAUTI_MEDIA.map.get(row().object_key).bytes, saved, 'retry cannot replace an immutable upload');
    assert.ok(calls.every((call) => call.args.p_id === ID && call.headers.Authorization === TOKEN));
    const prior = env.SAUTI_MEDIA.writes.length;
    assert.equal((await handleStoriesRequest(request(`/api/stories/uploads/${ID}`, 'PUT', PNG, { 'Content-Type': 'image/jpeg' }), env)).status, 415);
    assert.equal((await handleStoriesRequest(request(`/api/stories/uploads/${ID}`, 'PUT', new Uint8Array(PNG.length).fill(65)), env)).status, 400);
    assert.equal((await handleStoriesRequest(request(`/api/stories/uploads/${ID}`, 'PUT', new Uint8Array(PNG.length + 1)), env)).status, 413);
    assert.equal(env.SAUTI_MEDIA.writes.length, prior);
  });
});

test('forged upload row cannot write outside its canonical owner/story object key', async () => {
  const env = environment();
  await usingRpc({ stories_upload: row({ object_key: 'sauti/someone-elses-private-media.png' }) }, async () => {
    const response = await handleStoriesRequest(request(`/api/stories/uploads/${ID}`, 'PUT', PNG), env);
    assert.ok([400, 403, 404, 415].includes(response.status));
    assert.equal(env.SAUTI_MEDIA.writes.length, 0);
  });
});

test('upload lookup denial prevents raw media writes and leaks no ownership details', async () => {
  const env = environment();
  await usingRpc({ stories_upload: dbError('OWNER_REQUIRED') }, async () => {
    assert.equal((await handleStoriesRequest(request(`/api/stories/uploads/${ID}`, 'PUT', PNG), env)).status, 403);
    assert.equal(env.SAUTI_MEDIA.writes.length, 0);
  });
});

test('image publish requires a validated stored object and repeated confirmation uses the same reservation', async () => {
  const env = environment(); const item = row();
  await usingRpc({ stories_upload: item, stories_publish: (args) => { assert.equal(args.p_id, ID); assert.equal(args.p_duration_ms, null); assert.equal(args.p_worker_key, 'synthetic-worker-key'); return item; } }, async (calls) => {
    assert.equal((await handleStoriesRequest(request('/api/stories', 'POST', { upload_id: ID, caption: 'Hello' }), env)).status, 409);
    assert.ok(!calls.some((call) => call.name === 'stories_publish'));
    await seedImage(env);
    for (let attempt = 0; attempt < 2; attempt++) {
      const output = await data(await handleStoriesRequest(request('/api/stories', 'POST', { upload_id: ID, caption: ' Hello ' }), env), 201);
      assert.equal(output.data.story.id, ID);
    }
    assert.ok(calls.filter((call) => call.name === 'stories_publish').every((call) => call.args.p_caption === 'Hello'));
    assert.equal(calls.filter((call) => call.name === 'stories_reserve').length, 0);
  });
});

test('video processing confirmation becomes a single published story without another provider upload', async () => {
  const env = environment({ SAUTI_STREAM_ENABLED: 'true', SAUTI_STREAM_ORIGIN: 'https://customer-synthetic.cloudflarestream.com',
    SAUTI_STREAM_SOURCE_KEY: 'A'.repeat(43), STREAM: { video() { throw new Error('A ready job needs no second provider call'); }, upload() { throw new Error('Never reupload'); } } });
  const item = row({ media_kind: 'video', content_type: 'video/mp4', object_key: null, duration_ms: 29_900 });
  const jobKey = `stream-jobs/v2/story/${ID}.json`;
  const job = { version: 2, kind: 'story', id: ID, owner_id: OWNER, generation: KEY, state: 'ready',
    stream_uid: 'a'.repeat(32), duration_ms: 29_900, width: 720, height: 1280, updated_at: Math.floor(Date.now() / 1000) };
  await usingRpc({ stories_upload: item, stories_publish: (args) => {
    assert.equal(args.p_id, ID); assert.equal(args.p_duration_ms, 29_900); assert.equal(args.p_stream_uid, 'a'.repeat(32));
    return item;
  } }, async (calls) => {
    const pending = await data(await handleStoriesRequest(request('/api/stories', 'POST', { upload_id: ID, caption: 'Video story' }), env), 202);
    assert.equal(pending.data.processing, true); assert.equal(pending.data.upload_id, ID);
    assert.ok(!calls.some((call) => call.name === 'stories_publish'));
    await env.SAUTI_MEDIA.put(jobKey, JSON.stringify(job));
    const ready = await data(await handleStoriesRequest(request('/api/stories', 'POST', { upload_id: ID, caption: 'Video story' }), env), 201);
    assert.equal(ready.data.story.id, ID); assert.equal(ready.data.story.playback_path, `/api/stories/${ID}/playback`);
    assert.equal(calls.filter((call) => call.name === 'stories_publish').length, 1);
    await env.SAUTI_MEDIA.put(jobKey, JSON.stringify({ ...job, duration_ms: 30_001 }));
    assert.equal((await handleStoriesRequest(request('/api/stories', 'POST', { upload_id: ID, caption: '' }), env)).status, 400);
    assert.equal(calls.filter((call) => call.name === 'stories_publish').length, 1, 'over-30-second video never reaches the publish transaction');
  });
});

test('story playback descriptor stays first-party and expires no later than the story itself', async () => {
  const env = environment({ SAUTI_STREAM_ENABLED: 'true', SAUTI_STREAM_ORIGIN: 'https://customer-synthetic.cloudflarestream.com',
    SAUTI_STREAM_SOURCE_KEY: 'A'.repeat(43), STREAM: { video() { throw new Error('Descriptor must not expose or request provider tokens'); }, upload() {} } });
  const item = row({ media_kind: 'video', content_type: 'video/mp4', stream_uid: 'a'.repeat(32), duration_ms: 20_000 });
  await env.SAUTI_MEDIA.put(`stream-jobs/v2/story/${ID}.json`, JSON.stringify({ version: 2, kind: 'story', id: ID,
    owner_id: OWNER, generation: KEY, stream_uid: 'a'.repeat(32), state: 'ready', duration_ms: 20_000 }));
  await usingRpc({ stories_asset: item }, async (calls) => {
    const output = await data(await handleStoriesRequest(request(`/api/stories/${ID}/playback`), env));
    assert.equal(output.data.type, 'hls');
    const playback = new URL(output.data.url);
    assert.equal(playback.origin, 'https://sautilink.com'); assert.ok(playback.pathname.startsWith(`/api/stories/${ID}/hls/`));
    assert.ok(Date.parse(output.data.expires_at) <= Date.parse(item.expires_at));
    assert.ok(output.data.expires_in > 0 && output.data.expires_in <= 60);
    assert.ok(!JSON.stringify(output).includes('cloudflarestream.com'));
    assert.equal(calls[0].headers.Authorization, TOKEN);
  });
});

test('caption edits send only validated caption and preserve backend-issued expiry', async () => {
  const item = row();
  await usingRpc({ stories_edit: (args) => { assert.deepEqual(args, { p_id: ID, p_caption: 'Updated' }); return { ...item, caption: args.p_caption }; } }, async (calls) => {
    const output = await data(await handleStoriesRequest(request(`/api/stories/${ID}`, 'PATCH', { caption: ' Updated ', expires_at: future(), owner_id: OTHER }), environment()));
    assert.equal(output.data.story.caption, 'Updated'); assert.equal(output.data.story.expires_at, item.expires_at);
    for (const caption of ['x'.repeat(501), '\u0000', 123]) {
      assert.equal((await handleStoriesRequest(request(`/api/stories/${ID}`, 'PATCH', { caption }), environment())).status, 400);
    }
    assert.equal(calls.length, 1);
  });
});

test('owner-only viewer list preserves denial, validates cursor and maps pagination', async () => {
  await usingRpc({ stories_viewers: dbError('OWNER_REQUIRED') }, async () => {
    assert.equal((await handleStoriesRequest(request(`/api/stories/${ID}/viewers`), environment())).status, 403);
  });
  await usingRpc({ stories_viewers: { viewers: [{ ...author(OTHER), viewed_at: new Date().toISOString() }], total: 2, has_more: true } }, async (calls) => {
    const output = await data(await handleStoriesRequest(request(`/api/stories/${ID}/viewers?cursor=0`), environment()));
    assert.equal(output.data.total, 2); assert.equal(output.data.next_cursor, '1'); assert.equal(output.data.viewers[0].id, OTHER);
    for (const cursor of ['-1', 'NaN', '1.5', '1000001']) {
      assert.equal((await handleStoriesRequest(request(`/api/stories/${ID}/viewers?cursor=${cursor}`), environment())).status, 400);
    }
    assert.equal(calls.length, 1);
  });
});

test('view marking and reactions bind the authenticated viewer and reject unknown reaction values', async () => {
  await usingRpc({ stories_view: { viewed: true }, stories_react: (args) => ({ reaction: args.p_reaction }) }, async (calls) => {
    await data(await handleStoriesRequest(request(`/api/stories/${ID}/view`, 'POST'), environment()));
    for (const reaction of ['love', 'dislike', null]) {
      const output = await data(await handleStoriesRequest(request(`/api/stories/${ID}/reaction`, 'PUT', { reaction, viewer_id: OTHER }), environment()));
      assert.equal(output.data.reaction, reaction);
    }
    assert.ok(calls.every((call) => call.headers.Authorization === TOKEN));
    assert.ok(calls.every((call) => !('p_viewer_id' in call.args)), 'viewer identity must come from JWT, never JSON');
    const count = calls.length;
    assert.equal((await handleStoriesRequest(request(`/api/stories/${ID}/reaction`, 'PUT', { reaction: 'fire' }), environment())).status, 400);
    assert.equal((await handleStoriesRequest(request(`/api/stories/${ID}/reaction`, 'PUT', { reaction: 'love' }), environment({ SOCIAL_LIKE_LIMITER: { async limit() { return { success: false }; } } }))).status, 429);
    assert.equal(calls.length, count);
  });
});

test('authorized public photo revalidates expiry and storage metadata on every read and HEAD', async () => {
  const env = environment(); await seedImage(env);
  await usingRpc({ stories_asset: row() }, async (calls) => {
    const response = await handleStoriesRequest(request(`/api/stories/${ID}/media`), env);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);
    const head = await handleStoriesRequest(request(`/api/stories/${ID}/media`, 'HEAD'), env);
    assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(calls.filter((call) => call.name === 'stories_asset').length, 2);
    env.SAUTI_MEDIA.map.get(row().object_key).customMetadata.ownerId = OTHER;
    assert.equal((await handleStoriesRequest(request(`/api/stories/${ID}/media`), env)).status, 404);
  });
  for (const expires_at of [expired(), 'not-a-date']) await usingRpc({ stories_asset: row({ expires_at }) }, async () => {
    assert.equal((await handleStoriesRequest(request(`/api/stories/${ID}/media`), env)).status, 404);
  });
});

test('deletion checks server ownership before provider/object deletion and does not refund quota', async () => {
  const env = environment(); await seedImage(env);
  await usingRpc({ stories_asset: row(), stories_delete: dbError('OWNER_REQUIRED') }, async () => {
    assert.equal((await handleStoriesRequest(request(`/api/stories/${ID}`, 'DELETE'), env)).status, 403);
    assert.equal(env.SAUTI_MEDIA.deletes.length, 0);
  });
  await usingRpc({ stories_asset: row(), stories_delete: { id: ID, deleted: true } }, async (calls) => {
    await data(await handleStoriesRequest(request(`/api/stories/${ID}`, 'DELETE'), env));
    assert.deepEqual(env.SAUTI_MEDIA.deletes, [row().object_key]);
    assert.ok(!calls.some((call) => /quota|refund/.test(call.name)));
  });
});

test('maintenance acknowledges only actual deletion success and retains failed cleanup for retry', async () => {
  const good = row(); const bad = row({ id: KEY, object_key: `stories/${OWNER}/${KEY}.png` });
  const env = environment();
  env.SAUTI_MEDIA.delete = async (key) => { if (key === bad.object_key) throw new Error('temporary R2 outage'); env.SAUTI_MEDIA.deletes.push(key); };
  await usingRpc({ stories_cleanup: [good, bad], stories_cleanup_ack: { acknowledged: true } }, async (calls) => {
    const output = await runStoriesAndStreamMaintenance(env);
    assert.equal(output.cleaned, 1);
    assert.deepEqual(calls.filter((call) => call.name === 'stories_cleanup_ack').map((call) => call.args.p_id), [ID]);
    assert.ok(calls.every((call) => call.args.p_worker_key === 'synthetic-worker-key'));
    assert.ok(calls.every((call) => !call.headers.Authorization), 'scheduled jobs use dedicated worker capability, not user JWT');
  });
});

test('unknown story route and unsupported methods cannot trigger RPC or change media', async () => {
  await usingRpc({}, async (calls) => {
    const env = environment();
    for (const path of ['/api/stories/not-a-uuid', `/api/stories/${ID}/unknown`]) {
      assert.equal((await handleStoriesRequest(request(path), env)).status, 404);
    }
    assert.equal(await handleStoriesRequest(request('/api/stories/profile/../../private'), env), null, 'URL-normalized path escapes are handled by the main router, never Stories');
    assert.equal((await handleStoriesRequest(request(`/api/stories/${ID}`, 'PUT', {}), env)).status, 405);
    assert.equal(calls.length, 0); assert.equal(env.SAUTI_MEDIA.writes.length, 0);
  });
});
