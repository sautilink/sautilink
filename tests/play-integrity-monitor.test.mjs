import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64Url, createHandler, evaluateVerdict, MonitorError, normalizeCertificate,
  requestHash, readLimitedJson,
} from '../supabase/functions/sautilink-play-integrity/core.ts';
import { createRuntime } from '../supabase/functions/sautilink-play-integrity/runtime.ts';

const now = 1_792_367_100_000;
const identity = { userId: '00000000-0000-4000-8000-000000000001', sessionId: '00000000-0000-4000-8000-000000000002' };
const challenge = {
  status: 'ready', challenge_id: '00000000-0000-4000-8000-000000000003',
  version_code: 44, issued_at_ms: now - 60_000, expires_at_ms: now + 240_000,
};
const certificate = base64Url(new Uint8Array(32).fill(42));
const config = { cloudProjectNumber: '93555813548', allowedCertificates: new Set([certificate]) };
const authorization = 'Bearer header.payload.signature';
const encryptedToken = 'opaque_encrypted_integrity_token_for_this_test_only';
const hash = await requestHash(identity, challenge);

function verdict() {
  return { tokenPayloadExternal: {
    requestDetails: { requestPackageName: 'com.sautilink.app', requestHash: hash, timestampMillis: String(now) },
    appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: 'com.sautilink.app', certificateSha256Digest: [certificate], versionCode: '44' },
    accountDetails: { appLicensingVerdict: 'LICENSED' },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
  } };
}

function request(body, headers = {}) {
  return new Request('https://example.invalid/functions/v1/sautilink-play-integrity', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization, ...headers }, body: JSON.stringify(body),
  });
}

function harness(overrides = {}) {
  const calls = { auth: 0, begin: 0, consume: 0, decode: 0, records: [] };
  let consumed = false;
  const dependencies = {
    config: () => config,
    authenticate: async () => { calls.auth++; return identity; },
    begin: async () => { calls.begin++; return challenge; },
    consume: async () => {
      calls.consume++;
      if (consumed) return { status: 'invalid_challenge' };
      consumed = true;
      return challenge;
    },
    decode: async () => { calls.decode++; return verdict(); },
    record: async (actor, id, summary) => { calls.records.push({ actor, id, summary }); return true; },
    now: () => now,
    ...overrides,
  };
  return { handler: createHandler(dependencies), calls };
}

test('request hash binds user, live session, server challenge and version without exposing them', async () => {
  assert.match(hash, /^[A-Za-z0-9_-]{43}$/);
  for (const [actor, pending] of [
    [{ ...identity, userId: '00000000-0000-4000-8000-000000000005' }, challenge],
    [{ ...identity, sessionId: '00000000-0000-4000-8000-000000000006' }, challenge],
    [identity, { ...challenge, challenge_id: '00000000-0000-4000-8000-000000000007' }],
    [identity, { ...challenge, version_code: 45 }],
  ]) assert.notEqual(await requestHash(actor, pending), hash);
  assert.equal(await requestHash(identity, challenge), hash);
  assert.equal(hash.includes(identity.userId), false);
});

test('Play app-signing digest accepts hex/colon-hex/base64url forms only', () => {
  const hex = '2a'.repeat(32);
  assert.equal(normalizeCertificate(hex), certificate);
  assert.equal(normalizeCertificate(hex.match(/../g).join(':').toUpperCase()), certificate);
  assert.equal(normalizeCertificate(certificate), certificate);
  assert.equal(normalizeCertificate(certificate + '='), certificate);
  for (const invalid of ['', '2a'.repeat(31), 'not-a-certificate', [], 'a'.repeat(500)]) assert.equal(normalizeCertificate(invalid), null);
});

test('recognized verdict records exact primary signals without authorizing the user', () => {
  assert.deepEqual(evaluateVerdict(verdict(), hash, challenge, config.allowedCertificates, now), {
    outcome: 'observed', app_recognition: 'PLAY_RECOGNIZED', certificate_match: true, version_match: true,
    app_version_code: 44, licensing: 'LICENSED', device_recognition: ['MEETS_DEVICE_INTEGRITY'],
  });
});

test('package/hash/timestamp mismatches never contribute trusted signal details', () => {
  const mutations = [
    (p) => { p.requestDetails.requestPackageName = 'com.example.copy'; },
    (p) => { p.requestDetails.requestHash = 'hash-from-another-user'; },
    (p) => { p.requestDetails.timestampMillis = String(challenge.issued_at_ms - 30_001); },
    (p) => { p.requestDetails.timestampMillis = String(now + 30_001); },
    (p) => { p.requestDetails.timestampMillis = String(challenge.expires_at_ms + 1); },
    (p) => { p.requestDetails.timestampMillis = 'not-a-time'; },
    (p) => { delete p.requestDetails; },
  ];
  for (const change of mutations) {
    const value = verdict(); change(value.tokenPayloadExternal);
    assert.deepEqual(evaluateVerdict(value, hash, challenge, config.allowedCertificates, now), { outcome: 'binding_failed' });
  }
  assert.deepEqual(evaluateVerdict(verdict(), hash, challenge, config.allowedCertificates, challenge.expires_at_ms + 30_001), { outcome: 'binding_failed' });
});

test('unrecognized/unlicensed/empty-device results remain monitoring signals', () => {
  const value = verdict();
  value.tokenPayloadExternal.appIntegrity = { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' };
  value.tokenPayloadExternal.accountDetails.appLicensingVerdict = 'UNLICENSED';
  value.tokenPayloadExternal.deviceIntegrity = {};
  assert.deepEqual(evaluateVerdict(value, hash, challenge, config.allowedCertificates, now), {
    outcome: 'observed', app_recognition: 'UNRECOGNIZED_VERSION', certificate_match: false, version_match: false,
    licensing: 'UNLICENSED', device_recognition: [],
  });
});

test('wrong Play signing certificate and version are separate false flags', () => {
  const value = verdict();
  value.tokenPayloadExternal.appIntegrity.certificateSha256Digest = [base64Url(new Uint8Array(32).fill(1))];
  value.tokenPayloadExternal.appIntegrity.versionCode = '43';
  const result = evaluateVerdict(value, hash, challenge, config.allowedCertificates, now);
  assert.equal(result.certificate_match, false);
  assert.equal(result.version_match, false);
  assert.equal(result.app_version_code, 43);
  assert.equal(result.outcome, 'observed');
});

test('unknown data, environment signals, account details and injected strings are discarded', () => {
  const value = verdict();
  value.tokenPayloadExternal.accountDetails.email = 'private@example.invalid';
  value.tokenPayloadExternal.environmentDetails = { playProtectVerdict: 'NO_ISSUES', appAccessRiskVerdict: { appsDetected: ['KNOWN_INSTALLED'] } };
  value.tokenPayloadExternal.deviceIntegrity.deviceRecall = { values: { bitFirst: true } };
  value.tokenPayloadExternal.deviceIntegrity.deviceRecognitionVerdict.push('private@example.invalid', 'MEETS_DEVICE_INTEGRITY');
  value.tokenPayloadExternal.appIntegrity.appRecognitionVerdict = 'private@example.invalid';
  const result = evaluateVerdict(value, hash, challenge, config.allowedCertificates, now);
  assert.equal(result.app_recognition, 'UNEVALUATED');
  assert.deepEqual(result.device_recognition, ['MEETS_DEVICE_INTEGRITY']);
  assert.equal(JSON.stringify(result).includes('private@'), false);
  assert.equal('environmentDetails' in result, false);
  assert.equal('deviceRecall' in result, false);
});

test('unauthenticated traffic cannot obtain challenges or trigger Google calls', async () => {
  const first = harness();
  const missing = await first.handler(request({ action: 'challenge', version_code: 44 }, { Authorization: '' }));
  assert.equal(missing.status, 401); assert.equal(first.calls.auth, 0);
  const second = harness({ authenticate: async () => null });
  const invalid = await second.handler(request({ action: 'challenge', version_code: 44 }));
  assert.equal(invalid.status, 401); assert.equal(second.calls.begin, 0); assert.equal(second.calls.decode, 0);
});

test('configuration disabled/unavailable still requires authentication and never calls Google', async () => {
  const { handler, calls } = harness({ config: () => null });
  const result = await handler(request({ action: 'challenge', version_code: 44 }));
  assert.deepEqual(await result.json(), { mode: 'monitor', status: 'unavailable', retry_after_seconds: 3600 });
  assert.equal(calls.auth, 1); assert.equal(calls.begin, 0); assert.equal(calls.decode, 0);
});

test('ready challenge sends opaque hash, Cloud number and expiry; no identity', async () => {
  const { handler } = harness();
  const response = await handler(request({ action: 'challenge', version_code: 44 }));
  assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
  const body = await response.json();
  assert.deepEqual(body, { mode: 'monitor', status: 'ready', challenge_id: challenge.challenge_id,
    request_hash: hash, cloud_project_number: '93555813548', expires_at_ms: challenge.expires_at_ms, retry_after_seconds: 21600 });
  assert.equal(JSON.stringify(body).includes(identity.userId), false);
});

test('unknown request fields, wrong types and oversized inputs fail before authentication or Google', async () => {
  const { handler, calls } = harness();
  for (const body of [
    { action: 'challenge', version_code: '44' }, { action: 'challenge', version_code: 44, user_id: identity.userId },
    { action: 'observe', challenge_id: challenge.challenge_id, integrity_token: 'bad' },
    { action: 'observe', challenge_id: 'not-uuid', integrity_token: encryptedToken },
    { action: 'client_error', error: 'private data' }, { action: 'challenge', version_code: -1 },
  ]) assert.equal((await handler(request(body))).status, 400);
  assert.equal((await handler(request({ action: 'observe', challenge_id: challenge.challenge_id, integrity_token: 'a'.repeat(40_000) }))).status, 400);
  assert.equal(calls.auth, 0); assert.equal(calls.decode, 0);
});

test('actual streamed byte limit catches bodies without content-length', async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('"' + 'a'.repeat(50) + '"')); c.close(); } });
  await assert.rejects(readLimitedJson(new Response(stream), 40), /body_too_large/);
});

test('rate-limited issues do not call Google or create a client verdict', async () => {
  const { handler, calls } = harness({ begin: async () => ({ status: 'rate_limited', retry_after_seconds: 600 }) });
  const response = await handler(request({ action: 'challenge', version_code: 44 }));
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '600');
  assert.deepEqual(await response.json(), { mode: 'monitor', status: 'rate_limited', retry_after_seconds: 600 });
  assert.equal(calls.decode, 0);
});

test('concurrent/replayed observations decode only the atomically claimed challenge', async () => {
  const { handler, calls } = harness();
  const body = { action: 'observe', challenge_id: challenge.challenge_id, integrity_token: encryptedToken };
  const results = await Promise.all([handler(request(body)), handler(request(body)), handler(request(body))]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
  assert.equal(calls.decode, 1); assert.equal(calls.records.length, 1);
  const receipt = await results.find((r) => r.status === 200).json();
  assert.deepEqual(receipt, { mode: 'monitor', status: 'recorded', retry_after_seconds: 21600 });
  assert.equal('certificate_match' in receipt, false); assert.equal('allowed' in receipt, false);
});

test('wrong-owner, expired or consumed challenges never reach Google', async () => {
  const { handler, calls } = harness({ consume: async () => ({ status: 'invalid_challenge' }) });
  const response = await handler(request({ action: 'observe', challenge_id: challenge.challenge_id, integrity_token: encryptedToken }));
  assert.equal(response.status, 409); assert.equal(calls.decode, 0); assert.equal(calls.records.length, 0);
});

test('encrypted token remains opaque and permits either standard or URL-safe base64 characters', async () => {
  const token = 'opaque+base64/token_with-padding=.and.url-safe-' + 'A'.repeat(32);
  let received;
  const { handler } = harness({ decode: async (value) => { received = value; return verdict(); } });
  const result = await handler(request({ action: 'observe', challenge_id: challenge.challenge_id, integrity_token: token }));
  assert.equal(result.status, 200);
  assert.equal(received, token);
});

test('Google failures are bounded sanitized observations, with no diagnostics returned to the app', async () => {
  for (const error of [new MonitorError('token_rejected'), new Error('Bearer secret private@example.invalid')]) {
    const { handler, calls } = harness({ decode: async () => { throw error; } });
    const response = await handler(request({ action: 'observe', challenge_id: challenge.challenge_id, integrity_token: encryptedToken }));
    assert.deepEqual(await response.json(), { mode: 'monitor', status: 'recorded', retry_after_seconds: 21600 });
    assert.deepEqual(calls.records[0].summary, { outcome: error instanceof MonitorError ? 'token_rejected' : 'google_unavailable' });
  }
});

test('database failure cannot accidentally report a stored result or gate app behavior', async () => {
  const { handler } = harness({ record: async () => false });
  const result = await handler(request({ action: 'observe', challenge_id: challenge.challenge_id, integrity_token: encryptedToken }));
  assert.deepEqual(await result.json(), { mode: 'monitor', status: 'unavailable', retry_after_seconds: 3600 });
});

const jwt = (claims) => `Bearer ${base64Url(new TextEncoder().encode('{}'))}.${base64Url(new TextEncoder().encode(JSON.stringify(claims)))}.signature`;
const claims = { sub: identity.userId, session_id: identity.sessionId, role: 'authenticated', iss: 'https://rggpyiterdbbugluejcs.supabase.co/auth/v1', exp: now / 1000 + 600 };
const databaseEnv = { SUPABASE_URL: 'https://rggpyiterdbbugluejcs.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test_server_key' };

test('runtime verifies the original JWT with Supabase Auth and rejects fake/anonymous/expired claims', async () => {
  const requests = [];
  const runtime = createRuntime((key) => databaseEnv[key], async (url, init) => {
    requests.push({ url, init }); return Response.json({ id: identity.userId, is_anonymous: false, email: 'discard@example.invalid' });
  }, () => now);
  assert.deepEqual(await runtime.authenticate(jwt(claims)), identity);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://rggpyiterdbbugluejcs.supabase.co/auth/v1/user');
  assert.equal(requests[0].init.headers.Authorization, jwt(claims));
  for (const invalid of [{ ...claims, role: 'anon' }, { ...claims, is_anonymous: true }, { ...claims, exp: 1 },
    { ...claims, session_id: null }, { ...claims, iss: 'https://example.invalid/auth/v1' }]) assert.equal(await runtime.authenticate(jwt(invalid)), null);
  assert.equal(requests.length, 1);
  const rejected = createRuntime((key) => databaseEnv[key], async () => Response.json({ message: 'bad JWT' }, { status: 401 }), () => now);
  assert.equal(await rejected.authenticate(jwt(claims)), null);
});

test('user JWT reaches user-scoped RPCs, but the result RPC uses only server credentials', async () => {
  const requests = [];
  const env = { ...databaseEnv, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only' };
  const runtime = createRuntime((key) => env[key], async (url, init) => {
    requests.push({ url, init }); return Response.json(url.endsWith('record_play_integrity_observation_v1') ? true : challenge);
  }, () => now);
  await runtime.begin(jwt(claims), 44); await runtime.consume(jwt(claims), challenge.challenge_id);
  assert.equal(await runtime.record(identity, challenge.challenge_id, { outcome: 'binding_failed' }), true);
  assert.equal(requests[0].init.headers.Authorization, jwt(claims));
  assert.equal(requests[1].init.headers.Authorization, jwt(claims));
  assert.equal('Authorization' in requests[2].init.headers, false);
  assert.equal(requests[2].init.headers.apikey, 'sb_secret_test_only');
  assert.deepEqual(JSON.parse(requests[2].init.body), { p_user_id: identity.userId, p_session_id: identity.sessionId,
    p_challenge_id: challenge.challenge_id, p_summary: { outcome: 'binding_failed' } });
});

const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
const serviceAccount = { type: 'service_account', project_id: 'sautilink', client_email: 'test-integrity@sautilink.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://malicious.invalid' };
const accountBase64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const configuredEnv = { ...databaseEnv, PLAY_INTEGRITY_MODE: 'monitor', PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '93555813548',
  PLAY_INTEGRITY_ALLOWED_CERTIFICATE_SHA256: certificate, FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: accountBase64(serviceAccount) };

test('runtime defaults off and only accepts the expected Google project and a valid app certificate', () => {
  const configured = (values) => createRuntime((key) => values[key], async () => { throw new Error('network forbidden in config test'); }, () => now).config();
  assert.equal(configured({ ...configuredEnv, PLAY_INTEGRITY_MODE: undefined }), null);
  assert.equal(configured({ ...configuredEnv, PLAY_INTEGRITY_MODE: 'enforce' }), null);
  assert.equal(configured({ ...configuredEnv, PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '123456789' }), null);
  assert.equal(configured({ ...configuredEnv, PLAY_INTEGRITY_ALLOWED_CERTIFICATE_SHA256: 'invalid' }), null);
  assert.equal(configured({ ...configuredEnv, FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: accountBase64({ ...serviceAccount, project_id: 'another-project' }) }), null);
  assert.equal(configured({ ...configuredEnv, PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON_BASE64: 'bad base64' }), null);
  assert.equal(configured({ ...configuredEnv, FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: accountBase64({ ...serviceAccount, client_email: 'test@another-project.iam.gserviceaccount.com' }) }), null);
  assert.equal(configured(configuredEnv).cloudProjectNumber, '93555813548');
});

test('Google OAuth assertion uses actual RS256, fixed endpoints and only playintegrity scope; cached across decodes', async () => {
  let oauth = 0; let decode = 0;
  const runtime = createRuntime((key) => configuredEnv[key], async (url, init) => {
    assert.equal(init.redirect, 'error');
    if (url === 'https://oauth2.googleapis.com/token') {
      oauth++;
      const assertion = init.body.get('assertion');
      const [header, payload, signature] = assertion.split('.');
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
      assert.equal(parsed.scope, 'https://www.googleapis.com/auth/playintegrity');
      assert.equal(parsed.iss, serviceAccount.client_email);
      assert.equal(parsed.aud, 'https://oauth2.googleapis.com/token');
      assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${payload}`)), true);
      return Response.json({ access_token: 'ephemeral_test_oauth', expires_in: 3600 });
    }
    assert.equal(url, 'https://playintegrity.googleapis.com/v1/com.sautilink.app:decodeIntegrityToken');
    decode++;
    assert.equal(init.headers.Authorization, 'Bearer ephemeral_test_oauth');
    assert.deepEqual(JSON.parse(init.body), { integrity_token: encryptedToken });
    return Response.json(verdict());
  }, () => now);
  await Promise.all([runtime.decode(encryptedToken), runtime.decode(encryptedToken)]);
  assert.equal(oauth, 1); assert.equal(decode, 2);
});

test('Google 400 fails once with token_rejected; configured-off runtime makes no network call', async () => {
  let oauth = 0; let decode = 0;
  const runtime = createRuntime((key) => configuredEnv[key], async (url) => {
    if (url === 'https://oauth2.googleapis.com/token') { oauth++; return Response.json({ access_token: 'test_access', expires_in: 3600 }); }
    decode++; return Response.json({ error: { message: 'opaque sensitive diagnostic' } }, { status: 400 });
  }, () => now);
  await assert.rejects(runtime.decode(encryptedToken), (error) => error instanceof MonitorError && error.category === 'token_rejected');
  assert.equal(oauth, 1); assert.equal(decode, 1);
  const disabled = createRuntime((key) => ({ ...configuredEnv, PLAY_INTEGRITY_MODE: 'off' })[key], async () => { throw new Error('must not run'); }, () => now);
  await assert.rejects(disabled.decode(encryptedToken), /google_unavailable/);
});
