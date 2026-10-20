import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAccountControlRequest } from '../src/account-controls-api.js';

const route = 'https://test.sautilink.com/api/account/verification/remove';
const memberId = '00000000-0000-4000-8000-000000000001';
const requestId = '89ed83c9-e7f3-4070-874a-c30f252d2a9f';
const confirmation = 'remove-verification-v1';
const auth = 'Bearer synthetic-verification-removal-test';
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const removalResult = (status = 'removed') => ({
  status, user_id: memberId, username_unlocked: true,
  profile: { id: memberId, username: 'synthetic_member', display_name: 'Synthetic Member', is_verified: false, verification_badge_type: 'standard' },
});

function request({ method = 'POST', payload = { request_id: requestId, confirmation }, body = JSON.stringify(payload), headers = {}, anonymous = false, ...options } = {}) {
  return new Request(route, {
    method,
    headers: { ...(anonymous ? {} : { Authorization: auth }), 'Content-Type': 'application/json', ...headers },
    ...(!['GET', 'HEAD'].includes(method) ? { body } : {}),
    ...options,
  });
}

function harness(t, { user = { id: memberId }, authStatus = 200, provider = removalResult(), providerStatus = 200, allowed = true, limiterReady = true, providerTransportError = false } = {}) {
  const calls = [];
  const limits = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, method: options.method || 'GET', headers: new Headers(options.headers), body: options.body });
    if (target === 'https://rggpyiterdbbugluejcs.supabase.co/auth/v1/user') return jsonResponse(user, authStatus);
    assert.equal(target, 'https://rggpyiterdbbugluejcs.supabase.co/rest/v1/rpc/remove_my_social_verification', 'Only the dedicated owner RPC may run');
    assert.equal(options.method, 'POST', 'Generic profile CRUD/PATCH is forbidden');
    if (providerTransportError) throw new Error('Synthetic upstream connection interrupted.');
    return typeof provider === 'function' ? provider() : jsonResponse(provider, providerStatus);
  });
  const env = {
    // Deliberate unused sentinel proves the request uses the caller and public key.
    SUPABASE_SERVICE_ROLE_KEY: 'unused-test-elevated-key',
    ...(limiterReady ? { ACCOUNT_CONTROL_LIMITER: { limit: async ({ key }) => { limits.push(key); return { success: allowed }; } } } : {}),
  };
  return { calls, limits, env, run: value => handleAccountControlRequest(value || request(), env) };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
  return payload;
}

test('anonymous and malformed authentication cannot call verification removal RPC', async t => {
  const h = harness(t);
  for (const Authorization of ['', 'Basic user:password', 'Bearer token with spaces', 'Bearer']) {
    await expectError(await h.run(request({ anonymous: true, headers: { Authorization } })), 401, 'AUTH_REQUIRED');
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.limits.length, 0);
});

test('unaccepted or missing upstream user identity stops before limiter and RPC', async t => {
  for (const options of [{ authStatus: 401 }, { user: {} }, { user: null }]) {
    await t.test(JSON.stringify(options), async sub => {
      const h = harness(sub, options);
      await expectError(await h.run(), 401, 'AUTH_REQUIRED');
      assert.equal(h.calls.length, 1);
      assert.equal(h.limits.length, 0);
    });
  }
});

test('verification removal requires a ready owner-scoped rate limiter', async t => {
  await t.test('unready returns503', async sub => {
    const h = harness(sub, { limiterReady: false });
    await expectError(await h.run(), 503, 'RATE_LIMIT_NOT_READY');
    assert.equal(h.calls.length, 1);
  });
  await t.test('exhausted returns429', async sub => {
    const h = harness(sub, { allowed: false });
    await expectError(await h.run(), 429, 'RATE_LIMITED');
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.limits, [memberId]);
  });
});

test('only POST is allowed and rejected methods perform no authentication or mutation', async t => {
  const h = harness(t);
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await h.run(request({ method }));
    assert.equal(response.headers.get('Allow'), 'POST');
    await expectError(response, 405, 'METHOD_NOT_ALLOWED');
  }
  assert.equal(h.calls.length, 0);
});

test('removal accepts JSON only and rejects malformed JSON or UTF8 before RPC', async t => {
  const h = harness(t);
  for (const contentType of ['', 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonp']) {
    await expectError(await h.run(request({ headers: { 'Content-Type': contentType } })), 415, 'JSON_REQUIRED');
  }
  for (const body of ['{broken', '', '[', new Uint8Array([0xc3, 0x28])]) {
    await expectError(await h.run(request({ body })), 400, 'VERIFICATION_REMOVAL_REQUEST_INVALID');
  }
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
});

test('missing body, confirmation or valid request UUID cannot remove verification', async t => {
  const h = harness(t);
  await expectError(await h.run(request({ body: null })), 400, 'VERIFICATION_REMOVAL_CONFIRMATION_REQUIRED');
  for (const payload of [{ request_id: requestId }, { request_id: requestId, confirmation: true }, { request_id: requestId, confirmation: 'remove-verification' }]) {
    await expectError(await h.run(request({ payload })), 400, 'VERIFICATION_REMOVAL_CONFIRMATION_REQUIRED');
  }
  for (const value of [undefined, null, 123, 'bad-id', '00000000-0000-0000-0000-000000000000']) {
    await expectError(await h.run(request({ payload: { request_id: value, confirmation } })), 400, 'REQUEST_ID_REQUIRED');
  }
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
});

test('target IDs and extra arguments are rejected instead of permitting another profile mutation', async t => {
  const h = harness(t);
  for (const payload of [null, [], 'member', true, 1,
    { request_id: requestId, confirmation, user_id: 'another-member' },
    { request_id: requestId, confirmation, profile_id: 'another-member' },
    { request_id: requestId, confirmation, is_verified: false },
    { request_id: requestId, confirmation, verification_badge_type: 'team' },
  ]) {
    await expectError(await h.run(request({ payload })), 400, 'VERIFICATION_REMOVAL_REQUEST_INVALID');
  }
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
});

test('the actual streamed body limit rejects more than1024bytes even with a misleading length header', async t => {
  const h = harness(t);
  let cancelled = false;
  let sent = 0;
  const chunk = new TextEncoder().encode(' '.repeat(300));
  const body = new ReadableStream({
    pull(controller) { if (++sent < 7) controller.enqueue(chunk); else controller.close(); },
    cancel() { cancelled = true; },
  });
  await expectError(await h.run(request({ body, duplex: 'half', headers: { 'Content-Length': '1' } })), 413, 'VERIFICATION_REMOVAL_REQUEST_TOO_LARGE');
  assert.equal(cancelled, true);
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
});

test('confirmed removal uses the caller token and only the dedicated owner RPC arguments', async t => {
  const h = harness(t);
  const body = JSON.stringify({ request_id: requestId.toUpperCase(), confirmation });
  const response = await h.run(request({ body: body.padEnd(1024), headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  assert.equal(response.status, 200);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.limits, [memberId]);
  const [authentication, mutation] = h.calls;
  assert.equal(authentication.headers.get('Authorization'), auth);
  assert.equal(mutation.headers.get('Authorization'), auth);
  assert.equal(mutation.headers.get('apikey'), authentication.headers.get('apikey'));
  assert.match(mutation.headers.get('apikey'), /^sb_publishable_/);
  assert.notEqual(mutation.headers.get('apikey'), h.env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(mutation.headers.get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(mutation.body), { p_request_id: requestId, p_confirmation: confirmation });
  assert.equal(Object.hasOwn(JSON.parse(mutation.body), 'user_id'), false);
});

test('removed and already_removed results return only the authoritative public response shape', async t => {
  for (const status of ['removed', 'already_removed']) {
    await t.test(status, async sub => {
      const provider = removalResult(status);
      provider.private_events = ['must-not-leak'];
      provider.service_debug = 'must-not-leak';
      provider.profile.username_locked_at = '2026-10-20T00:00:00Z';
      provider.profile.private_flag = 'must-not-leak';
      const h = harness(sub, { provider });
      const response = await h.run();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const body = await response.json();
      assert.deepEqual(body, { ok: true, data: removalResult(status) });
      assert.equal(h.calls.length, 2);
    });
  }
});

test('provider policy failures map to stable client errors without leaking provider details', async t => {
  const cases = [
    ['VERIFICATION_NOT_ACTIVE', 409, 'VERIFICATION_NOT_ACTIVE'],
    ['REQUEST_ID_REUSED', 409, 'REQUEST_ID_REUSED'],
    ['VERIFICATION_REMOVAL_REPLAY_REJECTED', 409, 'VERIFICATION_REMOVAL_REPLAY_REJECTED'],
    ['AUTH_REQUIRED', 401, 'AUTH_REQUIRED'],
    ['PROFILE_UNAVAILABLE', 404, 'PROFILE_UNAVAILABLE'],
    ['VERIFICATION_REMOVAL_CONFIRMATION_REQUIRED', 400, 'VERIFICATION_REMOVAL_CONFIRMATION_REQUIRED'],
    ['REQUEST_ID_REQUIRED', 400, 'REQUEST_ID_REQUIRED'],
    ['UNKNOWN_DATABASE_FAILURE', 503, 'VERIFICATION_REMOVAL_UNAVAILABLE'],
  ];
  for (const [message, status, code] of cases) {
    await t.test(message, async sub => {
      const h = harness(sub, { provider: { code: 'P0001', message, details: 'sensitive-provider-detail', hint: 'must-not-leak' }, providerStatus: 400 });
      const body = await expectError(await h.run(), status, code);
      assert.equal(JSON.stringify(body).includes('sensitive-provider-detail'), false);
      assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
      assert.equal(h.calls.length, 2);
    });
  }
});

test('a successful upstream response must identify the same owner and confirm badge and username removal', async t => {
  const mutations = [
    ['wrong owner', value => { value.user_id = 'someone-else'; }],
    ['wrong profile', value => { value.profile.id = 'someone-else'; }],
    ['still verified', value => { value.profile.is_verified = true; }],
    ['truthy verification', value => { value.profile.is_verified = 'false'; }],
    ['team badge', value => { value.profile.verification_badge_type = 'team'; }],
    ['username locked', value => { value.username_unlocked = false; }],
    ['truthy unlocked', value => { value.username_unlocked = 'true'; }],
    ['missing username', value => { delete value.profile.username; }],
    ['invalid name', value => { value.profile.display_name = null; }],
    ['unconfirmed status', value => { value.status = 'pending'; }],
  ];
  for (const [label, mutate] of mutations) {
    await t.test(label, async sub => {
      const provider = removalResult();
      mutate(provider);
      const h = harness(sub, { provider });
      await expectError(await h.run(), 502, 'VERIFICATION_REMOVAL_RESPONSE_INVALID');
    });
  }
});

test('unreadable successful responses fail closed and upstream transport failures return503', async t => {
  await t.test('invalid success JSON', async sub => {
    const h = harness(sub, { provider: () => new Response('{broken', { status: 200 }) });
    await expectError(await h.run(), 502, 'VERIFICATION_REMOVAL_RESPONSE_INVALID');
  });
  await t.test('invalid upstream error JSON', async sub => {
    const h = harness(sub, { provider: () => new Response('unavailable', { status: 503 }) });
    await expectError(await h.run(), 503, 'VERIFICATION_REMOVAL_UNAVAILABLE');
  });
  await t.test('RPC transport failure', async sub => {
    const h = harness(sub, { providerTransportError: true });
    await expectError(await h.run(), 503, 'VERIFICATION_REMOVAL_UNAVAILABLE');
    assert.equal(h.calls.length, 2);
  });
});
