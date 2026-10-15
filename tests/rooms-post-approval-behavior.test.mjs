import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSautiRequest } from '../src/sauti-posts-api.js';
import { handleSautiMediaRequest } from '../src/sauti-media-api.js';
import { handleRoomPostApprovalRequest } from '../src/room-post-approval-api.js';
import { roomPublishRequestId, confirmRoomPublishRequest, roomPublishOutcome } from '../src/room-publish-outcome.js';

const ACTOR = '10000000-0000-4000-8000-000000000004';
const ROOM = '20000000-0000-4000-8000-000000000001';
const MEDIA = '30000000-0000-4000-8000-000000000001';
const REQUEST = '40000000-0000-4000-8000-000000000001';
const SUBMISSION = '50000000-0000-4000-8000-000000000001';
const POST = '60000000-0000-4000-8000-000000000001';
const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const env = () => ({ SAUTI_CREATE_LIMITER: { limit: async () => ({ success: true }) } });
const request = (path, method = 'GET', payload) => new Request(`https://sautilink.com${path}`, {
  method, headers: { Authorization: 'Bearer fixture-bearer', 'Content-Type': 'application/json' },
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});
async function withFetch(mock, action) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/auth/v1/user')) return respond({ id: ACTOR });
    return mock(new URL(url), init);
  };
  try { return await action(); } finally { globalThis.fetch = previous; }
}
const readyMedia = () => ({ id: MEDIA, owner_id: ACTOR, object_key: 'fixture/image.jpg', media_kind: 'image', content_type: 'image/jpeg', size_bytes: 42 });
const objectHead = () => ({ size: 42, customMetadata: { ownerId: ACTOR, mediaId: MEDIA, validated: 'true' } });
const pending = () => ({ id: SUBMISSION, room_id: ROOM, author_id: ACTOR, body: 'Room fixture', state: 'pending', version: 1 });
function streamedAction(chunks, { withdraw = false, fail = false, declaredLength } = {}) {
  const stats = { pulls: 0, cancelled: false };
  const stream = new ReadableStream({
    pull(controller) {
      stats.pulls += 1;
      if (chunks.length) controller.enqueue(chunks.shift());
      else if (fail) controller.error(new Error('fixture incomplete body'));
      else controller.close();
    },
    cancel() { stats.cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request(`https://sautilink.com/api/rooms/${ROOM}/post-submissions/${SUBMISSION}${withdraw ? '' : '/decision'}`, {
    method: withdraw ? 'DELETE' : 'POST', duplex: 'half', body: stream,
    headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json',
      ...(declaredLength == null ? {} : { 'Content-Length': String(declaredLength) }) },
  });
  return { request, stats };
}

test('non-Room text publishing retains 201 and makes no review RPC', async () => {
  const inserts = [];
  await withFetch(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/social_posts');
    assert.equal(init.method, 'POST');
    inserts.push(JSON.parse(init.body));
    return respond([{ id: POST }], 201);
  }, async () => {
    const response = await handleSautiRequest(request('/api/sauti', 'POST', { body: 'Normal fixture' }), env());
    assert.equal(response.status, 201);
    assert.equal((await response.json()).data.post.id, POST);
  });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].circle_id, null);
  assert.equal(inserts[0].post_status, 'published');
});

test('Room flag OFF and pre-migration server both keep existing 201 behavior', async () => {
  for (const missing of [false, true]) {
    let inserted = 0;
    await withFetch(async (url) => {
      if (url.pathname.endsWith('/room_post_submission_route')) return missing ? respond({ code: 'PGRST202' }, 404) : respond({ requires_review: false });
      if (url.pathname === '/rest/v1/social_posts') { inserted += 1; return respond([{ id: POST }], 201); }
      assert.fail(`Unexpected ${url.pathname}`);
    }, async () => {
      const response = await handleSautiRequest(request('/api/sauti', 'POST', { body: 'Room fixture', circle_id: ROOM }), env());
      assert.equal(response.status, 201);
    });
    assert.equal(inserted, 1);
  }
});

test('approval queues202 after media validation and never inserts/attaches a published post', async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push(url.pathname);
    if (url.pathname.endsWith('/room_post_submission_route')) return respond({ requires_review: true, existing_submission: false });
    if (url.pathname === '/rest/v1/social_post_media') return respond([readyMedia()]);
    if (url.pathname.endsWith('/room_submit_post_for_review')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_client_request_id, REQUEST);
      assert.deepEqual(body.p_media, [{ id: MEDIA, alt_text: 'Fixture' }]);
      return respond({ submission: pending(), published: false });
    }
    assert.fail(`Unexpected ${url.pathname}`);
  }, async () => {
    const response = await handleSautiRequest(request('/api/sauti', 'POST', {
      body: 'Room fixture', circle_id: ROOM, client_request_id: REQUEST, media: [{ id: MEDIA, alt_text: 'Fixture' }],
    }), { ...env(), SAUTI_MEDIA: { head: async () => objectHead() } });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).data.published, false);
  });
  assert.ok(!calls.includes('/rest/v1/social_posts'));
});

test('lost202 retries confirm pending/approved exactly once; removed/rejected never fake publication', async () => {
  for (const state of ['pending', 'approved', 'removed', 'rejected']) {
    await withFetch(async (url, init) => {
      if (url.pathname.endsWith('/room_post_submission_route')) return respond({ requires_review: true, existing_submission: true });
      if (url.pathname.endsWith('/room_submit_post_for_review')) {
        assert.equal(JSON.parse(init.body).p_client_request_id, REQUEST);
        return respond({ submission: { ...pending(), state: state === 'removed' ? 'approved' : state, published_post_id: state === 'approved' ? POST : null }, published: false });
      }
      assert.fail(`Retry must not touch media or posts: ${url.pathname}`);
    }, async () => {
      const response = await handleSautiRequest(request('/api/sauti', 'POST', {
        body: 'Room fixture', circle_id: ROOM, client_request_id: REQUEST, media: [{ id: MEDIA }],
      }), env());
      assert.equal(response.status, state === 'pending' ? 202 : state === 'approved' ? 201 : 409);
      if (state === 'removed' || state === 'rejected') assert.equal((await response.json()).error.code, 'ALREADY_DECIDED');
    });
  }
});

test('a held upload cannot be reused by a normal post or have its bytes deleted', async () => {
  await withFetch(async (url) => {
    if (url.pathname === '/rest/v1/social_post_media') return respond([readyMedia()]);
    if (url.pathname.endsWith('/room_held_media_uploads')) return respond([MEDIA]);
    assert.fail(`Held reuse must stop: ${url.pathname}`);
  }, async () => {
    const response = await handleSautiRequest(request('/api/sauti', 'POST', { body: 'Reuse', media: [{ id: MEDIA }] }), {
      ...env(), SAUTI_MEDIA: { head: async () => objectHead(), delete: async () => assert.fail('Held bytes deleted') },
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'MEDIA_HELD_FOR_ROOM_REVIEW');
  });
});

test('expired upload cleanup deletes bytes only after confirmed DB deletion; held/zero-row failures preserve them', async () => {
  for (const result of ['held', 'zero', 'removed']) {
    const operations = [];
    await withFetch(async (url, init) => {
      if (url.pathname !== '/rest/v1/social_post_media') assert.fail(url.pathname);
      if (!init.method) return respond([{ id: MEDIA, object_key: 'fixture/image.jpg', media_kind: 'image' }]);
      if (init.method === 'DELETE') {
        operations.push('db-delete');
        assert.equal(init.headers.Prefer, 'return=representation');
        return result === 'held' ? respond({ message: 'MEDIA_HELD_FOR_ROOM_REVIEW' }, 403) : respond(result === 'zero' ? [] : [{ id: MEDIA }]);
      }
      if (init.method === 'POST') return respond([{ id: POST }], 201);
      assert.fail(init.method);
    }, async () => {
      const response = await handleSautiMediaRequest(request('/api/sauti-media/begin', 'POST', { content_type: 'image/jpeg', size_bytes: 42 }), {
        SAUTI_MEDIA_BEGIN_LIMITER: { limit: async () => ({ success: true }) },
        SAUTI_MEDIA: { delete: async () => operations.push('r2-delete') },
      });
      assert.equal(response.status, 201);
    });
    assert.deepEqual(operations, result === 'removed' ? ['db-delete', 'r2-delete'] : ['db-delete']);
  }
});

test('capability accurately falls back false only when migration RPC is missing', async () => {
  await withFetch(async () => respond({ code: 'PGRST202' }, 404), async () => {
    const response = await handleRoomPostApprovalRequest(request('/api/rooms/capabilities'), env());
    assert.deepEqual((await response.json()).data, { post_approval: false, version: 0 });
  });
  await withFetch(async () => respond({ message: 'database unavailable' }, 503), async () => {
    const response = await handleRoomPostApprovalRequest(request('/api/rooms/capabilities'), env());
    assert.equal(response.status, 503);
  });
});

test('missing pending R2 object aborts approval before decision RPC', async () => {
  await withFetch(async (url) => {
    if (url.pathname.endsWith('/room_get_post_submission')) return respond({ submission: { ...pending(), media: [{ id: MEDIA }] } });
    if (url.pathname.endsWith('/room_submission_media_for_review')) return respond(readyMedia());
    assert.fail(`Missing media must prevent decision: ${url.pathname}`);
  }, async () => {
    const response = await handleRoomPostApprovalRequest(request(`/api/rooms/${ROOM}/post-submissions/${SUBMISSION}/decision`, 'POST', {
      request_id: REQUEST, expected_version: 1, decision: 'approve',
    }), { ...env(), SAUTI_MEDIA: { head: async () => null } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'MEDIA_VALIDATION_FAILED');
  });
});

test('review media authorization uses scoped RPC and private no-store delivery', async () => {
  await withFetch(async (url, init) => {
    assert.ok(url.pathname.endsWith('/room_submission_media_for_review'));
    assert.deepEqual(JSON.parse(init.body), { p_room_id: ROOM, p_submission_id: SUBMISSION, p_media_id: MEDIA });
    return respond(readyMedia());
  }, async () => {
    const response = await handleRoomPostApprovalRequest(request(`/api/rooms/${ROOM}/post-submissions/${SUBMISSION}/media/${MEDIA}`), {
      SAUTI_MEDIA: { head: async () => objectHead(), get: async () => ({ size: 42, body: 'fixture' }) },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Vary'), 'Authorization');
  });
  await withFetch(async () => respond({ message: 'SUBMISSION_UNAVAILABLE' }, 404), async () => {
    const response = await handleRoomPostApprovalRequest(request(`/api/rooms/${ROOM}/post-submissions/${SUBMISSION}/media/${MEDIA}`), {
      SAUTI_MEDIA: { head: async () => assert.fail('Unauthorized R2 lookup') },
    });
    assert.equal(response.status, 404);
  });
});

test('competing decision returns conflict and never supplies a client-chosen actor', async () => {
  await withFetch(async (url, init) => {
    assert.ok(url.pathname.endsWith('/room_decide_post_submission'));
    const body = JSON.parse(init.body);
    assert.equal(body.p_expected_version, 1);
    assert.equal(body.p_reason, 'Fixture reason');
    assert.equal(body.actor_id, undefined);
    assert.equal(init.headers.Authorization, 'Bearer fixture-bearer');
    return respond({ message: 'ALREADY_DECIDED' }, 409);
  }, async () => {
    const response = await handleRoomPostApprovalRequest(request(`/api/rooms/${ROOM}/post-submissions/${SUBMISSION}/decision`, 'POST', {
      request_id: REQUEST, expected_version: 1, decision: 'reject', reason: 'Fixture reason', actor_id: POST,
    }), env());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'ALREADY_DECIDED');
  });
});

test('approve retry of a deleted published post returns unavailable while history remains truthful', async () => {
  const historical = { ...pending(), state: 'approved', version: 2, published_post_id: null, media: [] };
  await withFetch(async (url) => {
    if (url.pathname.endsWith('/room_get_post_submission')) return respond({ submission: historical });
    if (url.pathname.endsWith('/room_decide_post_submission')) return respond({ submission: historical, post_id: null });
    assert.fail(`Deleted post must not be republished: ${url.pathname}`);
  }, async () => {
    const history = await handleRoomPostApprovalRequest(request(`/api/rooms/${ROOM}/post-submissions/${SUBMISSION}`), env());
    assert.equal(history.status, 200);
    assert.equal((await history.json()).data.submission.published_post_id, null);
    const response = await handleRoomPostApprovalRequest(request(`/api/rooms/${ROOM}/post-submissions/${SUBMISSION}/decision`, 'POST', {
      request_id: REQUEST, expected_version: 1, decision: 'approve',
    }), env());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'POST_UNAVAILABLE');
  });
});

test('web retry IDs survive transport failure, change with content, and pending never claims published', () => {
  const snapshot = { circle_id: ROOM, body: 'Fixture' };
  const id = roomPublishRequestId(snapshot);
  assert.equal(roomPublishRequestId({ ...snapshot }), id);
  assert.notEqual(roomPublishRequestId({ ...snapshot, body: 'Edited' }), id);
  assert.deepEqual(roomPublishOutcome({ ok: true, status: 202 }, { ok: true, data: { published: false, submission: pending() } }), { pending: true, id: SUBMISSION });
  assert.throws(() => roomPublishOutcome({ ok: true, status: 202 }, { ok: true, data: { post: { id: POST } } }));
  confirmRoomPublishRequest(snapshot);
  assert.notEqual(roomPublishRequestId(snapshot), id);
});

test('unknown-length decision and withdrawal bodies stop at the byte limit and cancel before any scoped RPC', async () => {
  for (const withdraw of [false, true]) {
    const chunks = Array.from({ length: 40 }, () => new Uint8Array(256).fill(32));
    const action = streamedAction(chunks, { withdraw });
    await withFetch(async () => assert.fail('Oversize stream reached a scoped RPC'), async () => {
      const response = await handleRoomPostApprovalRequest(action.request, env());
      assert.equal(response.status, 413);
      assert.equal((await response.json()).error.code, 'BODY_TOO_LARGE');
    });
    assert.equal(action.stats.cancelled, true);
    assert.equal(action.stats.pulls, 17); //4096 bytes plus the first overflowing chunk, not the remaining body.
  }
});

test('body limit counts UTF8 bytes and rejects declared oversized bodies before reading', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify({ request_id: REQUEST, expected_version: 1,
    decision: 'reject', reason: 'Fixture reason', padding: '🙂'.repeat(1050) }));
  assert.ok(encoded.byteLength > 4096);
  for (const action of [streamedAction([encoded]), streamedAction([new Uint8Array(16)], { declaredLength: 4097 })]) {
    await withFetch(async () => assert.fail('Oversize body reached a scoped RPC'), async () => {
      const response = await handleRoomPostApprovalRequest(action.request, env());
      assert.equal(response.status, 413);
    });
    assert.equal(action.stats.cancelled, true);
    assert.ok(action.stats.pulls <= 1);
  }
});

test('valid chunked and exactly4096-byte actions preserve decision/withdraw fields', async () => {
  for (const withdraw of [false, true]) {
    const payload = { request_id: REQUEST, expected_version: 1, ...(withdraw ? {} : { decision: 'reject', reason: 'Fixture reason' }) };
    const text = JSON.stringify(payload);
    const padded = new TextEncoder().encode(text + ' '.repeat(4096 - new TextEncoder().encode(text).byteLength));
    const action = streamedAction([padded.slice(0, 13), padded.slice(13, 4095), padded.slice(4095)], { withdraw });
    await withFetch(async (url, init) => {
      assert.ok(url.pathname.endsWith(withdraw ? '/room_withdraw_post_submission' : '/room_decide_post_submission'));
      const args = JSON.parse(init.body);
      assert.equal(args.p_request_id, REQUEST);
      assert.equal(args.p_expected_version, 1);
      if (!withdraw) assert.equal(args.p_reason, 'Fixture reason');
      return respond({ submission: { ...pending(), state: withdraw ? 'withdrawn' : 'rejected' } });
    }, async () => {
      const response = await handleRoomPostApprovalRequest(action.request, env());
      assert.equal(response.status, 200);
    });
    assert.equal(action.stats.cancelled, false);
  }
});

test('invalid, incomplete, missing-field and aborted bodies return controlled400 without mutation', async () => {
  const encode = (value) => new TextEncoder().encode(value);
  for (const action of [
    streamedAction([encode('{')]), streamedAction([encode('{}')]), streamedAction([]),
    streamedAction([encode('{"request_id":')], { fail: true }), streamedAction([new Uint8Array([0xff])]),
  ]) {
    await withFetch(async () => assert.fail('Invalid action reached a scoped mutation RPC'), async () => {
      const response = await handleRoomPostApprovalRequest(action.request, env());
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'INVALID_DECISION');
    });
  }
});
