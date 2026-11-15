import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTotpMfaController, mfaGateDecision, validTotpCode } from '../src/mfa-totp.js';
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
    async getSession() { return { data: { session: { user: { id: 'person-1' } } }, error: null }; },
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
  const auth = { async getSession() { return { data: { session: { user: { id: 'no-factor' } } }, error: null }; }, mfa: { async getAuthenticatorAssuranceLevel() {
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
  createTotpMfaController({ auth, doc: h.doc });
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
  assert.match(transform, /mfaController\.reset\(\)/);
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
    async getSession() { return { data: { session: { user: { id: 'backup-user' } } }, error: null }; },
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
