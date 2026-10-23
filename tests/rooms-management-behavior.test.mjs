import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/asset-router.js';
import { handleRoomManagementRequest } from '../src/room-management-api.js';
import { handleRoomPostApprovalRequest } from '../src/room-post-approval-api.js';

const ACTOR = '10000000-0000-4000-8000-000000000004';
const ROOM = '20000000-0000-4000-8000-000000000001';
const POST = '30000000-0000-4000-8000-000000000001';
const REQUEST = '40000000-0000-4000-8000-000000000001';
const RULE = '50000000-0000-4000-8000-000000000001';
const QUESTION = '60000000-0000-4000-8000-000000000001';
const OTHER = '70000000-0000-4000-8000-000000000001';
const TIME = '2026-10-16T00:00:00.000Z';
const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const env = () => ({ SAUTI_CREATE_LIMITER: { limit: async () => ({ success: true }) } });
const path = (suffix) => `/api/rooms/${ROOM}/${suffix}`;
const request = (suffix, method = 'GET', payload) => new Request(`https://sautilink.com${suffix.startsWith('/api/') ? suffix : path(suffix)}`, {
  method, headers: { Authorization: 'Bearer fixture-bearer', 'Content-Type': 'application/json' },
  ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});
const state = () => ({ room_id: ROOM, version: 2, rules: [{ id: RULE, title: 'Be kind', body: 'Respect other members.' }],
  questions: [{ id: QUESTION, prompt: 'Why join?', required: true }], pin_limit: 3 });
const config = () => ({ expected_version: 1, request_id: REQUEST, rules: state().rules, questions: state().questions });
async function withFetch(mock, action, { actor = ACTOR, authStatus = 200 } = {}) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(init.headers.Authorization, 'Bearer fixture-bearer');
    if (String(url).endsWith('/auth/v1/user')) return respond({ id: actor }, authStatus);
    assert.ok(!String(init.headers.apikey).includes('service_role'));
    return mock(new URL(url), init);
  };
  try { return await action(); } finally { globalThis.fetch = previous; }
}
function streamed(suffix, chunks, { method = 'POST', fail = false, declaredLength } = {}) {
  const stats = { pulls: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      stats.pulls += 1;
      if (chunks.length) controller.enqueue(chunks.shift());
      else if (fail) controller.error(new Error('fixture incomplete body'));
      else controller.close();
    }, cancel() { stats.cancelled = true; },
  }, { highWaterMark: 0 });
  const req = new Request(`https://sautilink.com${path(suffix)}`, { method, body, duplex: 'half',
    headers: { Authorization: 'Bearer fixture-bearer', 'Content-Type': 'application/json',
      ...(declaredLength == null ? {} : { 'Content-Length': String(declaredLength) }) } });
  return { req, stats };
}

test('unrelated and existing approval routes stay outside new management dispatch', async () => {
  for (const suffix of ['post-submissions', 'post-approval-audit', 'capabilities', 'management/extra']) {
    assert.equal(await handleRoomManagementRequest(request(suffix), env()), null);
  }
});

test('management reads require authenticated identity and reject invalid room/target ids without scoped RPC', async () => {
  await withFetch(() => assert.fail('Unauthenticated RPC'), async () => {
    assert.equal((await handleRoomManagementRequest(request('management'), env())).status, 401);
  }, { authStatus: 401 });
  await withFetch(() => assert.fail('Invalid identifier RPC'), async () => {
    assert.equal((await handleRoomManagementRequest(request('/api/rooms/not-uuid/management'), env())).status, 404);
    assert.equal((await handleRoomManagementRequest(request('membership-requests/not-uuid/answers'), env())).status, 404);
  });
});

test('management state and answer snapshots are private no-store caller-scoped reads', async () => {
  const answer = { room_id: ROOM, requester_id: OTHER, config_version: 1, questions: state().questions,
    answers: [{ question_id: QUESTION, answer: 'Learn together' }], submitted_at: TIME };
  await withFetch(async (url, init) => {
    const args = JSON.parse(init.body);
    assert.equal(args.p_room_id, ROOM);
    if (url.pathname.endsWith('/room_management_state')) return respond(state());
    assert.ok(url.pathname.endsWith('/room_membership_request_answers'));
    assert.equal(args.p_requester_id, OTHER);
    return respond(answer);
  }, async () => {
    for (const suffix of ['management', `membership-requests/${OTHER}/answers`]) {
      const response = await handleRoomManagementRequest(request(suffix), env());
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.headers.get('Vary'), 'Authorization');
      assert.equal((await response.json()).ok, true);
    }
  });
});

test('config mutation forwards only agreed fields and requires an actual matching receipt', async () => {
  await withFetch(async (url, init) => {
    assert.ok(url.pathname.endsWith('/room_update_management'));
    assert.deepEqual(JSON.parse(init.body), { p_room_id: ROOM, p_request_id: REQUEST, p_expected_version: 1,
      p_rules: state().rules, p_questions: state().questions });
    return respond(state());
  }, async () => {
    const response = await handleRoomManagementRequest(request('management', 'PUT', {
      ...config(), actor_id: OTHER, is_admin: true, room_id: OTHER,
    }), env());
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, state());
  });
  for (const wrong of [null, {}, { ...state(), room_id: OTHER }, { ...state(), version: 0 },
    { ...state(), version: 1 }, { ...state(), rules: [] }]) {
    await withFetch(async () => respond(wrong), async () => {
      const response = await handleRoomManagementRequest(request('management', 'PUT', config()), env());
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'ROOM_MANAGEMENT_RESPONSE_INVALID');
    });
  }
});

test('config validates rule/question limits and duplicate UUIDs before mutation', async () => {
  const invalid = [
    { ...config(), expected_version: 0 }, { ...config(), expected_version: 1.5 },
    { ...config(), rules: Array.from({ length: 11 }, () => state().rules[0]) },
    { ...config(), rules: [{ id: RULE, title: 'x'.repeat(121), body: '' }] },
    { ...config(), rules: [{ id: RULE, title: ' ', body: '' }] },
    { ...config(), rules: [{ id: RULE, title: 'OK', body: 'x'.repeat(1001) }] },
    { ...config(), rules: [state().rules[0], { ...state().rules[0], id: RULE.toUpperCase() }] },
    { ...config(), questions: Array.from({ length: 4 }, () => state().questions[0]) },
    { ...config(), questions: [{ id: QUESTION, prompt: 'x'.repeat(301), required: true }] },
    { ...config(), questions: [{ id: QUESTION, prompt: 'OK', required: 'true' }] },
    { ...config(), questions: [state().questions[0], state().questions[0]] },
  ];
  await withFetch(() => assert.fail('Invalid config reached mutation RPC'), async () => {
    for (const payload of invalid) assert.equal((await handleRoomManagementRequest(request('management', 'PUT', payload), env())).status, 400);
  });
});

test('rule limits count Unicode characters consistently with Postgres and accept empty defaults', async () => {
  const rules = [{ id: RULE, title: '😀'.repeat(120), body: '😀'.repeat(1000) }];
  await withFetch(async (url, init) => {
    const args = JSON.parse(init.body);
    assert.deepEqual(args.p_rules, rules);
    return respond({ ...state(), rules, questions: [] });
  }, async () => {
    assert.equal((await handleRoomManagementRequest(request('management', 'PUT', { ...config(), rules, questions: [] }), env())).status, 200);
  });
  await withFetch(async () => respond({ ...state(), rules: [], questions: [] }), async () => {
    assert.equal((await handleRoomManagementRequest(request('management', 'PUT', { ...config(), rules: [], questions: [] }), env())).status, 200);
  });
});

test('membership request forwards answer IDs/version and confirms current user/status/request identity', async () => {
  for (const status of ['member', 'pending']) {
    await withFetch(async (url, init) => {
      assert.ok(url.pathname.endsWith('/room_submit_membership_request'));
      assert.deepEqual(JSON.parse(init.body), { p_room_id: ROOM, p_request_id: REQUEST, p_expected_version: 1,
        p_action_kind: 'request', p_answers: [{ question_id: QUESTION, answer: 'Learn together' }] });
      return respond({ room_id: ROOM, requester_id: ACTOR, status, config_version: 1, request_id: REQUEST });
    }, async () => {
      const response = await handleRoomManagementRequest(request('membership-request', 'POST', {
        request_id: REQUEST, expected_version: 1, action_kind: 'request', answers: [{ question_id: QUESTION, answer: ' Learn together ' }], requester_id: OTHER,
      }), env());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.status, status);
    });
  }
  for (const change of [{ requester_id: OTHER }, { request_id: OTHER }, { room_id: OTHER }, { status: 'approved' }, { config_version: 0 }, { config_version: 2 }]) {
    await withFetch(async () => respond({ room_id: ROOM, requester_id: ACTOR, status: 'pending', config_version: 1, request_id: REQUEST, ...change }), async () => {
      assert.equal((await handleRoomManagementRequest(request('membership-request', 'POST', {
        request_id: REQUEST, expected_version: 1, action_kind: 'request', answers: [],
      }), env())).status, 503);
    });
  }
});

test('membership action explicitly distinguishes join/request/invitation and rejects missing or unknown intent', async () => {
  for (const action of ['join', 'request', 'accept_invitation']) {
    await withFetch(async (url, init) => {
      assert.ok(url.pathname.endsWith('/room_submit_membership_request'));
      assert.equal(JSON.parse(init.body).p_action_kind, action);
      return respond({ room_id: ROOM, requester_id: ACTOR, status: action === 'request' ? 'pending' : 'member', config_version: 1, request_id: REQUEST });
    }, async () => {
      assert.equal((await handleRoomManagementRequest(request('membership-request', 'POST', {
        request_id: REQUEST, expected_version: 1, action_kind: action, answers: [],
      }), env())).status, 200);
    });
  }
  await withFetch(() => assert.fail('Unknown membership intent reached RPC'), async () => {
    for (const action of [undefined, null, '', 'request_join', 'accept', true]) {
      assert.equal((await handleRoomManagementRequest(request('membership-request', 'POST', {
        request_id: REQUEST, expected_version: 1, action_kind: action, answers: [],
      }), env())).status, 400);
    }
  });
});

test('membership answer duplicates, malformed IDs and overlong answers stop before RPC', async () => {
  await withFetch(() => assert.fail('Invalid membership mutation'), async () => {
    for (const answers of [null, [{ question_id: QUESTION, answer: 'x'.repeat(1001) }],
      [{ question_id: 'invalid', answer: 'OK' }], [{ question_id: QUESTION, answer: 'one' }, { question_id: QUESTION, answer: 'two' }]]) {
      assert.equal((await handleRoomManagementRequest(request('membership-request', 'POST', {
        request_id: REQUEST, expected_version: 1, action_kind: 'request', answers,
      }), env())).status, 400);
    }
  });
});

test('pins list returns only server-authorized metadata and invalid ACK never claims pinned', async () => {
  const pins = { posts: [{ post_id: POST, pinned_at: TIME, pinned_by: ACTOR }], pin_limit: 3 };
  for (const pinner of [ACTOR, null]) {
    const historic = { ...pins, posts: [{ ...pins.posts[0], pinned_by: pinner }] };
    await withFetch(async (url) => { assert.ok(url.pathname.endsWith('/room_pinned_posts')); return respond(historic); }, async () => {
      const response = await handleRoomManagementRequest(request('pinned-posts'), env());
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data, historic);
    });
  }
  for (const pinner of [undefined, '', 'deleted account', false]) {
    await withFetch(async () => respond({ ...pins, posts: [{ ...pins.posts[0], pinned_by: pinner }] }), async () => {
      assert.equal((await handleRoomManagementRequest(request('pinned-posts'), env())).status, 503);
    });
  }
  for (const pinned of [true, false]) {
    await withFetch(async (url, init) => {
      assert.ok(url.pathname.endsWith('/room_set_post_pin'));
      assert.deepEqual(JSON.parse(init.body), { p_room_id: ROOM, p_post_id: POST, p_pinned: pinned, p_request_id: REQUEST });
      return respond({ room_id: ROOM, post_id: POST, pinned, pinned_at: pinned ? TIME : null });
    }, async () => {
      assert.equal((await handleRoomManagementRequest(request(`posts/${POST}/pin`, 'PUT', { request_id: REQUEST, pinned }), env())).status, 200);
    });
  }
  await withFetch(async () => respond({ room_id: ROOM, post_id: POST, pinned: false, pinned_at: null }), async () => {
    assert.equal((await handleRoomManagementRequest(request(`posts/${POST}/pin`, 'PUT', { request_id: REQUEST, pinned: true }), env())).status, 503);
  });
});

test('published-post removal forwards only remove/reason and never touches R2', async () => {
  await withFetch(async (url, init) => {
    assert.ok(url.pathname.endsWith('/room_moderate_published_post'));
    assert.deepEqual(JSON.parse(init.body), { p_room_id: ROOM, p_post_id: POST, p_request_id: REQUEST, p_action: 'remove', p_reason: 'Rule violation' });
    return respond({ room_id: ROOM, post_id: POST, action: 'remove', removed: true, removed_at: TIME });
  }, async () => {
    const response = await handleRoomManagementRequest(request(`posts/${POST}/moderation`, 'POST', {
      request_id: REQUEST, action: 'remove', reason: ' Rule violation ', author_id: ACTOR, role: 'owner',
    }), { ...env(), SAUTI_MEDIA: { delete: () => assert.fail('Removal must not delete storage') } });
    assert.equal(response.status, 200);
  });
  await withFetch(() => assert.fail('Invalid moderation action'), async () => {
    for (const change of [{ action: 'restore' }, { reason: '' }, { reason: 'x'.repeat(501) }]) {
      assert.equal((await handleRoomManagementRequest(request(`posts/${POST}/moderation`, 'POST', {
        request_id: REQUEST, action: 'remove', reason: 'Rule violation', ...change,
      }), env())).status, 400);
    }
  });
});

test('staff denial, missing RPC, stale version, pin cap and network failures never acknowledge mutation', async () => {
  for (const [value, status, expected, code] of [
    [{ message: 'ROOM_STAFF_REQUIRED' }, 403, 403, 'ROOM_STAFF_REQUIRED'],
    [{ message: 'ROOM_MANAGEMENT_VERSION_CONFLICT' }, 409, 409, 'ROOM_MANAGEMENT_VERSION_CONFLICT'],
    [{ message: 'MEMBERSHIP_STATE_CHANGED' }, 409, 409, 'MEMBERSHIP_STATE_CHANGED'],
    [{ message: 'ROOM_MODERATION_FORBIDDEN' }, 403, 403, 'ROOM_MODERATION_FORBIDDEN'],
    [{ message: 'ROOM_PIN_LIMIT' }, 409, 409, 'ROOM_PIN_LIMIT'],
    [{ message: 'ROOM_POST_UNAVAILABLE' }, 404, 404, 'ROOM_POST_UNAVAILABLE'],
    [{ code: 'PGRST202' }, 404, 503, 'ROOM_MANAGEMENT_UNAVAILABLE'],
  ]) {
    await withFetch(async () => respond(value, status), async () => {
      const response = await handleRoomManagementRequest(request('management', 'PUT', config()), env());
      assert.equal(response.status, expected);
      assert.equal((await response.json()).error.code, code);
    });
  }
  await withFetch(async () => { throw new Error('fixture upstream unavailable'); }, async () => {
    assert.equal((await handleRoomManagementRequest(request('management'), env())).status, 503);
  });
});

test('writes require ready rate limit and JSON; wrong methods never call scoped mutation', async () => {
  await withFetch(() => assert.fail('Blocked mutation reached RPC'), async () => {
    assert.equal((await handleRoomManagementRequest(request('management', 'PUT', config()), {})).status, 503);
    assert.equal((await handleRoomManagementRequest(request('management', 'PUT', config()), {
      SAUTI_CREATE_LIMITER: { limit: async () => ({ success: false }) },
    })).status, 429);
    const wrongType = request('management', 'PUT', config()); wrongType.headers.set('Content-Type', 'text/plain');
    assert.equal((await handleRoomManagementRequest(wrongType, env())).status, 415);
    assert.equal((await handleRoomManagementRequest(request('management', 'DELETE'), env())).status, 405);
    assert.equal((await handleRoomManagementRequest(request('membership-request'), env())).status, 405);
  });
});

test('unknown-length config and action bodies cancel at actual byte bounds before scoped RPC', async () => {
  await withFetch(() => assert.fail('Oversized body reached RPC'), async () => {
    for (const [suffix, method, limit] of [['management', 'PUT', 65536], [`posts/${POST}/moderation`, 'POST', 16384]]) {
      const { req, stats } = streamed(suffix, [new Uint8Array(limit), new Uint8Array(1), new Uint8Array(100)], { method });
      assert.equal((await handleRoomManagementRequest(req, env())).status, 413);
      assert.equal(stats.cancelled, true);
      assert.equal(stats.pulls, 2);
    }
    const { req, stats } = streamed('management', [new Uint8Array(1)], { method: 'PUT', declaredLength: 65537 });
    assert.equal((await handleRoomManagementRequest(req, env())).status, 413);
    assert.equal(stats.pulls, 0);
    assert.equal(stats.cancelled, true);
  });
});

test('malformed, incomplete and invalid UTF8 JSON produces controlled400 without scoped mutation', async () => {
  await withFetch(() => assert.fail('Malformed body reached RPC'), async () => {
    for (const fixture of [streamed('management', [new TextEncoder().encode('{')], { method: 'PUT' }),
      streamed('management', [new TextEncoder().encode('{')], { method: 'PUT', fail: true }),
      streamed('management', [new Uint8Array([0xff])], { method: 'PUT' })]) {
      assert.equal((await handleRoomManagementRequest(fixture.req, env())).status, 400);
    }
  });
});

test('management capability distinguishes explicit unsupported from unresolved failures and preserves approval', async () => {
  for (const outcome of ['enabled', 'disabled', 'missing', 'error', 'malformed', 'network', 'auth', 'forbidden']) {
    await withFetch(async (url) => {
      if (url.pathname.endsWith('/room_post_approval_capabilities')) return respond({ post_approval: true, version: 1 });
      assert.ok(url.pathname.endsWith('/room_management_capabilities'));
      if (outcome === 'enabled') return respond({ room_management: true, management_version: 1 });
      if (outcome === 'disabled') return respond({ room_management: false, management_version: 0 });
      if (outcome === 'missing') return respond({ code: 'PGRST202' }, 404);
      if (outcome === 'error') return respond({ message: 'private diagnostic' }, 503);
      if (outcome === 'network') throw new Error('fixture network failure');
      if (outcome === 'auth') return respond({ message: 'private diagnostic' }, 401);
      if (outcome === 'forbidden') return respond({ message: 'private diagnostic' }, 403);
      return respond({ room_management: 'true', management_version: 1 });
    }, async () => {
      const response = await handleRoomPostApprovalRequest(request('/api/rooms/capabilities'), env());
      const known = ['enabled', 'disabled', 'missing'].includes(outcome);
      assert.equal(response.status, known ? 200 : outcome === 'auth' ? 401 : outcome === 'forbidden' ? 403 : 503);
      const payload = await response.json();
      if (known) assert.deepEqual(payload.data, { post_approval: true, version: 1,
        room_management: outcome === 'enabled', management_version: outcome === 'enabled' ? 1 : 0 });
      else {
        assert.equal(payload.ok, false);
        assert.equal(payload.data, undefined);
        assert.ok(!JSON.stringify(payload).includes('private diagnostic'));
      }
    });
  }
});

test('capability matrix supports management independently when old approval migration is missing', async () => {
  for (const approval of ['missing', 'enabled', 'disabled']) {
    for (const management of ['missing', 'enabled', 'disabled']) {
      await withFetch(async (url) => {
        if (url.pathname.endsWith('/room_post_approval_capabilities')) return approval === 'missing' ? respond({ code: 'PGRST202' }, 404) :
          respond({ post_approval: approval === 'enabled', version: 1 });
        assert.ok(url.pathname.endsWith('/room_management_capabilities'));
        return management === 'missing' ? respond({ code: 'PGRST202' }, 404) : respond({ room_management: management === 'enabled', management_version: management === 'enabled' ? 1 : 0 });
      }, async () => {
        const response = await handleRoomPostApprovalRequest(request('/api/rooms/capabilities'), env());
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).data, { post_approval: approval === 'enabled', version: approval === 'missing' ? 0 : 1,
          room_management: management === 'enabled', management_version: management === 'enabled' ? 1 : 0 });
      });
    }
  }
});

test('invalid old capability or probe network failure never acknowledges unsupported legacy mode', async () => {
  for (const reply of [null, {}, { post_approval: true, version: 0 }, { post_approval: 'true', version: 1 }, { post_approval: true, version: 2 }, 'network']) {
    await withFetch(async (url) => {
      assert.ok(url.pathname.endsWith('/room_post_approval_capabilities'));
      if (reply === 'network') throw new Error('fixture unavailable');
      return respond(reply);
    }, async () => {
      const response = await handleRoomPostApprovalRequest(request('/api/rooms/capabilities'), env());
      assert.equal(response.status, 503);
      assert.equal((await response.json()).data, undefined);
    });
  }
  for (const status of [401, 403]) {
    await withFetch(async (url) => {
      assert.ok(url.pathname.endsWith('/room_post_approval_capabilities'));
      return respond({ message: 'private diagnostic' }, status);
    }, async () => {
      const response = await handleRoomPostApprovalRequest(request('/api/rooms/capabilities'), env());
      assert.equal(response.status, status);
      assert.equal((await response.json()).data, undefined);
    });
  }
});

test('shared asset router reaches new management routes and preserves response no-store', async () => {
  await withFetch(async (url) => { assert.ok(url.pathname.endsWith('/room_management_state')); return respond(state()); }, async () => {
    const response = await worker.fetch(request('management'), env(), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).data.room_id, ROOM);
  });
});
