import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTotpMfaController, canEnrollMfaOnClient, mfaEnrollmentClientStatus, mfaGateDecision, normalizeTotpQrImage, validTotpCode } from '../src/mfa-totp.js';
import { transformTotpMfaSource } from '../scripts/totp-mfa-source-transform.mjs';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
function element() {
  const events = new Map();
  const attrs = new Map();
  return {
    events, attrs, dataset: {}, hidden: false, value: '', textContent: '', disabled: false,
    classList: { add() {}, remove() {} },
    addEventListener(name, callback) { events.set(name, callback); },
    removeAttribute(name) { attrs.delete(name); },
    setAttribute(name, val) { attrs.set(name, val); },
    focus() { this.didFocus = true; },
    replaceChildren(...nodes) { this.children = nodes; },
  };
}
function harness() {
  const ids = new Map();
  const doc = {
    body: element(),
    getElementById(id) { return ids.get(id) || null; },
    createElement() { return element(); },
  };
  for (const id of [
    'sautilink-mfa-gate', 'member-view', 'auth-view',
    'sautilink-mfa-login-form', 'sautilink-mfa-login-code', 'sautilink-mfa-login-submit',
    'sautilink-mfa-login-message', 'sautilink-mfa-login-factor', 'sautilink-mfa-factor-label', 'sautilink-mfa-retry', 'sautilink-mfa-signout',
    'sautilink-mfa-enable', 'sautilink-mfa-status', 'sautilink-mfa-remove',
    'sautilink-mfa-remove-factor', 'sautilink-mfa-enrollment', 'sautilink-mfa-qr',
    'sautilink-mfa-secret', 'sautilink-mfa-setup-code',
    'sautilink-mfa-setup-message', 'sautilink-mfa-setup-form',
    'sautilink-mfa-setup-submit', 'sautilink-mfa-cancel',
  ]) ids.set(id, element());
  ids.get('sautilink-mfa-gate').hidden = true;
  return { doc, at: (id) => ids.get(id) };
}
const evt = { preventDefault() {} };

test('MFA verification codes must be precisely six digits; unknown AAL state is fail closed', () => {
  assert.equal(validTotpCode('123456'), true);
  for (const value of ['12345', '1234567', 'abcdef', '', '123 456']) assert.equal(validTotpCode(value), false);
  assert.equal(mfaGateDecision({ currentLevel: 'aal1', nextLevel: 'aal2' }), 'challenge');
  assert.equal(mfaGateDecision({ currentLevel: 'aal2', nextLevel: 'aal2' }), 'allowed');
  assert.equal(mfaGateDecision({ currentLevel: 'aal1', nextLevel: 'aal1' }), 'allowed');
  assert.equal(mfaGateDecision(null), 'unavailable');
  assert.equal(mfaGateDecision({ currentLevel: null, nextLevel: 'aal2' }), 'unavailable');
});

test('2FA-enrolled login stays locked until authenticator verification promotes AAL to aal2', async () => {
  const h = harness();
  let level = 'aal1';
  let onUnlocked = 0;
  const calls = [];
  const auth = {
    async getSession() { return { data: { session: { user: { id: 'person-1' }, access_token: 'access-person-1' } }, error: null }; },
    mfa: {
      async getAuthenticatorAssuranceLevel() {
        return { data: { currentLevel: level, nextLevel: 'aal2' }, error: null };
      },
      async listFactors() { return { data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null }; },
      async challengeAndVerify(payload) {
        calls.push(payload);
        level = 'aal2';
        return { data: {}, error: null };
      },
    },
  };
  const mfa = createTotpMfaController({ auth, doc: h.doc, onUnlocked: () => { onUnlocked += 1; } });
  assert.equal(await mfa.guard({ id: 'person-1' }), false);
  assert.equal(h.at('sautilink-mfa-gate').hidden, false);
  assert.equal(h.at('member-view').inert, true);
  assert.equal(mfa.isUnlockedFor('person-1'), false);
  h.at('sautilink-mfa-login-code').value = '123456';
  await h.at('sautilink-mfa-login-form').events.get('submit')(evt);
  assert.deepEqual(calls, [{ factorId: 'factor-1', code: '123456' }]);
  assert.equal(mfa.isUnlockedFor('person-1'), true);
  assert.equal(h.at('sautilink-mfa-gate').hidden, true);
  assert.equal(onUnlocked, 1);
  mfa.reset();
  assert.equal(mfa.isUnlockedFor('person-1'), false);
});

test('users without MFA enrolled can still sign in; API failures cannot open member UI', async () => {
  const h = harness();
  const auth = { async getSession() { return { data: { session: { user: { id: 'no-factor' }, access_token: 'access-no-factor' } }, error: null }; }, mfa: { async getAuthenticatorAssuranceLevel() {
    return { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null };
  } } };
  const mfa = createTotpMfaController({ auth, doc: h.doc });
  assert.equal(await mfa.guard({ id: 'no-factor' }), true);
  assert.equal(mfa.isUnlockedFor('no-factor'), true);
  assert.equal(mfa.isUnlockedFor('different-user'), false);
  mfa.reset();
  auth.mfa.getAuthenticatorAssuranceLevel = async () => ({ data: null, error: new Error('offline') });
  assert.equal(await mfa.guard({ id: 'no-factor' }), false);
  assert.equal(h.at('sautilink-mfa-gate').hidden, false);
});

test('TOTP enrollment clears the secret from the page after successful verification', async () => {
  const h = harness();
  let enrolled = false;
  const auth = { mfa: {
    async enroll() { return { data: {
      id: 'factor-new', totp: { secret: 'TESTSECRET', qr_code: 'data:image/svg+xml;base64,ZXhhbXBsZQ==' },
    }, error: null }; },
    async challengeAndVerify({ factorId, code }) {
      assert.deepEqual([factorId, code], ['factor-new', '654321']);
      enrolled = true;
      return { error: null };
    },
    async listFactors() {
      return { data: { totp: enrolled ? [{ id: 'factor-new', status: 'verified', friendly_name: 'SautiLink Authenticator' }] : [] }, error: null };
    },
  } };
  createTotpMfaController({ auth, doc: h.doc, runtime: { location: { hostname: 'sautilink.com' }, confirm: () => true } });
  await h.at('sautilink-mfa-enable').events.get('click')();
  assert.equal(h.at('sautilink-mfa-secret').textContent, 'TESTSECRET');
  assert.equal(h.at('sautilink-mfa-enrollment').hidden, false);
  h.at('sautilink-mfa-setup-code').value = '654321';
  await h.at('sautilink-mfa-setup-form').events.get('submit')(evt);
  assert.equal(enrolled, true);
  assert.equal(h.at('sautilink-mfa-secret').textContent, '');
  assert.equal(h.at('sautilink-mfa-qr').attrs.get('src'), undefined);
  assert.equal(h.at('sautilink-mfa-enrollment').hidden, true);
  assert.match(h.at('sautilink-mfa-status').textContent, /On — 1 authenticator/);
});

test('MFA hooks cover cached bootstrap, live auth events, member admission and both build pipelines', async () => {
  const [transform, appBuild, production, html, css, controller] = await Promise.all([
    read('scripts/totp-mfa-source-transform.mjs'),
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
    read('app/index.html'),
    read('app/assets/mfa-totp.css'),
    read('src/mfa-totp.js'),
  ]);
  assert.match(transform, /function renderMember/);
  assert.match(transform, /mfaController\.isUnlockedFor/);
  assert.match(transform, /if \(!await mfaController\.guard\(user\)\) return/);
  assert.match(transform, /mfaController\.onAuthEvent\(event, session\)/);
  assert.match(appBuild, /transformTotpMfaSource\(appSourcePath/);
  assert.match(production, /transformTotpMfaSource\(file, output\)/);
  assert.match(html, /id="sautilink-mfa-login-form"/);
  assert.match(html, /id="sautilink-mfa-setup-form"/);
  assert.match(html, /id="sautilink-mfa-remove"/);
  assert.match(html, /href="\/app\/assets\/mfa-totp\.css/);
  assert.match(css, /\.sautilink-mfa-gate/);
  assert.doesNotMatch(controller, /localStorage|sessionStorage|console\.log\(/);
  assert.match(controller, /auth\.mfa\.challengeAndVerify/);
  assert.match(controller, /auth\.mfa\.getAuthenticatorAssuranceLevel/);
  assert.match(controller, /currentLevel !== 'aal2'/);
});

test('members with two factors can select the backup authenticator for 2FA login', async () => {
  const h = harness();
  const calls = [];
  const auth = {
    async getSession() { return { data: { session: { user: { id: 'backup-user' }, access_token: 'access-backup-user' } }, error: null }; },
    mfa: {
      async getAuthenticatorAssuranceLevel() {
        return { data: { currentLevel: calls.length ? 'aal2' : 'aal1', nextLevel: 'aal2' }, error: null };
      },
      async listFactors() { return { data: { totp: [
        { id: 'primary', status: 'verified', friendly_name: 'Phone' },
        { id: 'backup', status: 'verified', friendly_name: 'Backup authenticator' },
      ] }, error: null }; },
      async challengeAndVerify(payload) { calls.push(payload); return { data: {}, error: null }; },
    },
  };
  const mfa = createTotpMfaController({ auth, doc: h.doc });
  assert.equal(await mfa.guard({ id: 'backup-user' }), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.at('sautilink-mfa-login-factor').hidden, false);
  h.at('sautilink-mfa-login-factor').value = 'backup';
  h.at('sautilink-mfa-login-code').value = '897654';
  await h.at('sautilink-mfa-login-form').events.get('submit')(evt);
  assert.equal(calls[0].factorId, 'backup');
  assert.equal(mfa.isUnlockedFor('backup-user'), true);
});

test('a fresh login with the same user but a different token revokes previous MFA admission', async () => {
  const h = harness();
  let token = 'initial-token';
  let assurance = 'aal2';
  let next = 'aal2';
  const auth = {
    async getSession() {
      return { data: { session: { user: { id: 'person-1' }, access_token: token } }, error: null };
    },
    mfa: {
      async getAuthenticatorAssuranceLevel() {
        return { data: { currentLevel: assurance, nextLevel: next }, error: null };
      },
      async listFactors() {
        return { data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null };
      },
    },
  };
  const mfa = createTotpMfaController({ auth, doc: h.doc });
  assert.equal(await mfa.guard({ id: 'person-1' }), true);
  assert.equal(mfa.isUnlockedFor('person-1'), true);

  // A second sign-in for the same account has only aal1. Member contents
  // must no longer be rendered on the strength of the earlier token.
  token = 'new-aal1-token';
  assurance = 'aal1';
  next = 'aal2';
  mfa.onAuthEvent('SIGNED_IN', { user: { id: 'person-1' }, access_token: token });
  assert.equal(mfa.isUnlockedFor('person-1'), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.at('sautilink-mfa-gate').hidden, false);
  assert.equal(h.at('member-view').inert, true);
  assert.equal(mfa.isUnlockedFor('person-1'), false);
});

test('a session changing during an asynchronous AAL check cannot unlock cached member UI', async () => {
  const h = harness();
  let token = 'start-token';
  const auth = {
    async getSession() {
      return { data: { session: { user: { id: 'person-1' }, access_token: token } }, error: null };
    },
    mfa: {
      async getAuthenticatorAssuranceLevel() {
        token = 'changed-token';
        return { data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null };
      },
      async listFactors() { return { data: { totp: [] }, error: null }; },
    },
  };
  const mfa = createTotpMfaController({ auth, doc: h.doc });
  assert.equal(await mfa.guard({ id: 'person-1' }), false);
  assert.equal(mfa.isUnlockedFor('person-1'), false);
  assert.equal(h.at('sautilink-mfa-gate').hidden, false);
});

test('sign-out invalidates an in-flight MFA check even if it completes later', async () => {
  const h = harness();
  let resolveAal;
  const auth = {
    async getSession() {
      return { data: { session: { user: { id: 'person-1' }, access_token: 'start-token' } }, error: null };
    },
    mfa: {
      getAuthenticatorAssuranceLevel: () => new Promise((resolve) => { resolveAal = resolve; }),
    },
  };
  const mfa = createTotpMfaController({ auth, doc: h.doc });
  const pending = mfa.guard({ id: 'person-1' });
  await new Promise((resolve) => setImmediate(resolve));
  mfa.onAuthEvent('SIGNED_OUT', null);
  resolveAal({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
  assert.equal(await pending, false);
  assert.equal(mfa.isUnlockedFor('person-1'), false);
});

test('early access enrollment is live Web only and needs explicit acknowledgement', async () => {
  assert.equal(canEnrollMfaOnClient({ location: { hostname: 'sautilink.com' } }), true);
  assert.equal(canEnrollMfaOnClient({ location: { hostname: 'www.sautilink.com' } }), true);
  assert.equal(canEnrollMfaOnClient({ location: { hostname: 'WWW.SAUTILINK.COM' }, Capacitor: { getPlatform: () => 'web' } }), true);
  assert.equal(canEnrollMfaOnClient({ location: { hostname: 'test.sautilink.com' } }), false);
  assert.equal(canEnrollMfaOnClient({ location: { hostname: 'www.sautilink.com.evil.test' } }), false);
  assert.equal(canEnrollMfaOnClient({ location: { hostname: 'sautilink.com' }, Capacitor: { getPlatform: () => 'android' } }), false);
  assert.equal(canEnrollMfaOnClient({ location: { hostname: 'www.sautilink.com' }, Capacitor: { getPlatform: () => 'android' } }), false);
  assert.equal(mfaEnrollmentClientStatus({ location: { hostname: 'www.sautilink.com' }, Capacitor: { isNativePlatform: () => true } }), 'native-app');
  let enrollCount = 0;
  const auth = { mfa: { async enroll() { enrollCount++; return { data: {}, error: null }; } } };
  const h = harness();
  createTotpMfaController({ auth, doc: h.doc, runtime: { location: { hostname: 'sautilink.com' }, confirm: () => false } });
  await h.at('sautilink-mfa-enable').events.get('click')();
  assert.equal(enrollCount, 0, 'cannot enroll without affirmative acknowledgement');
  const h2 = harness();
  createTotpMfaController({ auth, doc: h2.doc, runtime: { location: { hostname: 'test.sautilink.com' }, confirm: () => true } });
  await h2.at('sautilink-mfa-enable').events.get('click')();
  assert.equal(enrollCount, 0, 'cannot enroll on test or noncanonical origins');
});

test('live www SautiLink origin makes the authenticator enrollment action available after factor refresh', async () => {
  const h = harness();
  let enrolled = 0;
  const auth = { mfa: {
    async listFactors() { return { data: { totp: [] }, error: null }; },
    async enroll() {
      enrolled += 1;
      return { data: { id: 'www-test-factor', totp: { secret: 'WWWTESTSECRET', qr_code: 'data:image/svg+xml;base64,ZXhhbXBsZQ==' } }, error: null };
    },
  } };
  const mfa = createTotpMfaController({
    auth, doc: h.doc,
    runtime: { location: { hostname: 'www.sautilink.com' }, confirm: () => true },
  });
  await mfa.refreshSettings(true);
  assert.equal(h.at('sautilink-mfa-enable').disabled, false);
  assert.match(h.at('sautilink-mfa-status').textContent, /Web early access/);
  await h.at('sautilink-mfa-enable').events.get('click')();
  assert.equal(enrolled, 1);
  assert.equal(h.at('sautilink-mfa-enrollment').hidden, false);
});

test('native app shows actionable browser guidance and never enables MFA enrollment', async () => {
  const h = harness();
  const auth = { mfa: { async listFactors() { return { data: { totp: [] }, error: null }; } } };
  const mfa = createTotpMfaController({
    auth, doc: h.doc,
    runtime: { location: { hostname: 'www.sautilink.com' }, Capacitor: { getPlatform: () => 'android' } },
  });
  await mfa.refreshSettings(true);
  assert.equal(h.at('sautilink-mfa-enable').disabled, true);
  assert.match(h.at('sautilink-mfa-status').textContent, /open sautilink.com in Chrome/);
});

test('Supabase QR SVG is safely encoded into a valid inline image without losing the embedded otpauth URI', () => {
  const raw = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M0 0H12" /><text>otpauth://totp/SautiLink%3Auser%3Fsecret%3DABC123%26issuer%3DSautiLink</text></svg>';
  const encoded = normalizeTotpQrImage(raw);
  assert.ok(encoded.startsWith('data:image/svg+xml;charset=UTF-8,'));
  assert.equal(decodeURIComponent(encoded.slice('data:image/svg+xml;charset=UTF-8,'.length)), raw);
  assert.equal(encoded.includes('fill="#000"'), false, 'special characters must be percent-encoded');
  assert.equal(normalizeTotpQrImage('data:image/svg+xml;utf-8,' + raw), encoded);
  assert.equal(normalizeTotpQrImage('data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(raw)), encoded);
  assert.equal(normalizeTotpQrImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
  assert.equal(normalizeTotpQrImage('https://another-service.example/qr?secret=sensitive'), null);
  assert.equal(normalizeTotpQrImage('javascript:alert(1)'), null);
  assert.equal(normalizeTotpQrImage('<script>alert(1)</script>'), null);
});

test('rendering an SVG from Supabase enrollment shows a camera-scannable image without external network', async () => {
  const h = harness();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M0 0H10"/></svg>';
  const auth = { mfa: { async enroll() { return {
    data: { id: 'svg-factor', totp: { qr_code: 'data:image/svg+xml;utf-8,' + svg, secret: 'FAKESECRET123' } },
    error: null,
  }; } } };
  createTotpMfaController({ auth, doc: h.doc, runtime: { location: { hostname: 'www.sautilink.com' }, confirm: () => true } });
  await h.at('sautilink-mfa-enable').events.get('click')();
  const qr = h.at('sautilink-mfa-qr');
  assert.equal(qr.hidden, false);
  assert.ok(qr.src.startsWith('data:image/svg+xml;charset=UTF-8,'));
  assert.ok(qr.src.includes('%23') && qr.src.includes('%3Csvg'));
  assert.equal(h.at('sautilink-mfa-enrollment').hidden, false);
  assert.match(h.at('sautilink-mfa-setup-message').textContent, /Scan QR code/);
  qr.events.get('error')();
  assert.equal(qr.hidden, true);
  assert.match(h.at('sautilink-mfa-setup-message').textContent, /Enter setup key manually/);
});

test('restarting a broken QR setup clears only old unverified SautiLink TOTP factors', async () => {
  const h = harness();
  const removed = [];
  let enrollmentLabel = '';
  const auth = { mfa: {
    async listFactors() { return { data: { all: [
      { id: 'old-qr', factor_type: 'totp', status: 'unverified', friendly_name: 'SautiLink Authenticator' },
      { id: 'verified-primary', factor_type: 'totp', status: 'verified', friendly_name: 'Existing phone' },
      { id: 'other-pending', factor_type: 'totp', status: 'unverified', friendly_name: 'Other app' },
    ] }, error: null }; },
    async unenroll({ factorId }) { removed.push(factorId); return { error: null }; },
    async enroll(args) {
      enrollmentLabel = args.friendlyName;
      return { data: { id: 'new-qr', totp: { secret: 'NOTREAL', qr_code: '<svg><path/></svg>' } }, error: null };
    },
  } };
  createTotpMfaController({
    auth, doc: h.doc,
    runtime: { location: { hostname: 'sautilink.com' }, confirm: () => true },
  });
  await h.at('sautilink-mfa-enable').events.get('click')();
  assert.deepEqual(removed, ['old-qr']);
  assert.match(enrollmentLabel, /^SautiLink Backup /);
  assert.equal(h.at('sautilink-mfa-enrollment').hidden, false);
});

test('an error cleaning an abandoned factor aborts enrollment instead of creating duplicate factor', async () => {
  const h = harness();
  let attempts = 0;
  const auth = { mfa: {
    async listFactors() { return { data: { all: [
      { id: 'stale', factor_type: 'totp', status: 'unverified', friendly_name: 'SautiLink Authenticator' },
    ] }, error: null }; },
    async unenroll() { return { error: { code: 'test_failure' } }; },
    async enroll() { attempts++; return { data: null, error: null }; },
  } };
  createTotpMfaController({
    auth, doc: h.doc, runtime: { location: { hostname: 'sautilink.com' }, confirm: () => true },
  });
  await h.at('sautilink-mfa-enable').events.get('click')();
  assert.equal(attempts, 0);
  assert.match(h.at('sautilink-mfa-setup-message').textContent, /Could not start setup/);
});
