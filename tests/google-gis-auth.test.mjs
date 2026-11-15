import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { installGoogleGis, shouldOfferGoogleGis, SAUTILINK_GOOGLE_WEB_CLIENT_ID } from '../src/google-gis-auth.js';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

function fakeButton() {
  const attrs = new Map();
  const classes = new Set();
  const label = { value: '', replaceChildren(value) { this.value = value; } };
  return {
    attrs, classes, label,
    classList: { add: (value) => classes.add(value), remove: (value) => classes.delete(value) },
    setAttribute: (name, value) => attrs.set(name, value),
    querySelector: (selector) => selector === '.social-oauth-label' ? label : null,
    before(slot) { this.slot = slot; },
  };
}
function harness({ failSdk = false } = {}) {
  const win = { location: { hostname: 'sautilink.com', pathname: '/login' } };
  const callbacks = {};
  const rendered = [];
  const provider = {
    initialize(options) { callbacks.initialize = options; },
    renderButton(slot, options) { rendered.push({ slot, options }); },
  };
  const button = fakeButton();
  const block = { querySelector(selector) { return selector === '[data-social-oauth-provider="google"]' ? button : null; } };
  const doc = {
    createElement(tag) {
      if (tag === 'div') return { className: '', dataset: {} };
      const listeners = {};
      return {
        listeners,
        addEventListener(name, fn) { listeners[name] = fn; },
      };
    },
    head: {
      append(script) {
        if (failSdk) script.listeners.error();
        else {
          win.google = { accounts: { id: provider } };
          script.listeners.load();
        }
      },
    },
    querySelectorAll() { return []; },
  };
  return { win, doc, button, block, rendered, callbacks };
}

test('GIS is restricted to the registered production web origin and login/signup, never native apps', () => {
  const prod = { location: { hostname: 'sautilink.com', pathname: '/login' } };
  assert.equal(shouldOfferGoogleGis(prod), true);
  prod.location.pathname = '/signup';
  assert.equal(shouldOfferGoogleGis(prod), true);
  prod.location.pathname = '/home';
  assert.equal(shouldOfferGoogleGis(prod), false);
  prod.location.hostname = 'test.sautilink.com';
  assert.equal(shouldOfferGoogleGis(prod), false);
  prod.location.hostname = 'sautilink.com';
  prod.Capacitor = { getPlatform: () => 'android' };
  assert.equal(shouldOfferGoogleGis(prod), false);
  assert.match(SAUTILINK_GOOGLE_WEB_CLIENT_ID, /^[a-z0-9-]+\.apps\.googleusercontent\.com$/);
});

test('GIS button exchanges ID token plus matching raw nonce; original OAuth action stays available', async () => {
  const h = harness();
  const exchanged = [];
  const outcomes = [];
  const auth = { async signInWithIdToken(options) { exchanged.push(options); return { data: { user: { id: 'test' } }, error: null }; } };
  const didInstall = await installGoogleGis({
    win: h.win, doc: h.doc, auth, cryptoImpl: webcrypto,
    blocks: [{ block: h.block, context: 'login' }],
    onError: (msg) => outcomes.push(msg),
    onSuccess: () => outcomes.push('ok'),
  });
  assert.equal(didInstall, true);
  assert.equal(h.rendered.length, 1);
  assert.equal(h.callbacks.initialize.client_id, SAUTILINK_GOOGLE_WEB_CLIENT_ID);
  assert.equal(h.callbacks.initialize.ux_mode, 'popup');
  assert.equal(h.rendered[0].options.text, 'continue_with');
  assert.ok(h.button.classes.has('social-oauth-google-alternative'));
  assert.equal(h.button.attrs.get('aria-label'), 'Alternative Google sign-in');

  await h.callbacks.initialize.callback({ credential: 'signed-google-id-token' });
  assert.deepEqual(outcomes, ['ok']);
  assert.equal(exchanged.length, 1);
  assert.equal(exchanged[0].provider, 'google');
  assert.equal(exchanged[0].token, 'signed-google-id-token');
  assert.match(exchanged[0].nonce, /^[0-9a-f]{64}$/);
  const digest = createHash('sha256').update(exchanged[0].nonce).digest('hex');
  assert.equal(digest, h.callbacks.initialize.nonce);
});

test('unavailable Google SDK keeps legacy OAuth login intact', async () => {
  const h = harness({ failSdk: true });
  const installed = await installGoogleGis({
    win: h.win, doc: h.doc, auth: { signInWithIdToken() {} },
    cryptoImpl: webcrypto,
    blocks: [{ block: h.block, context: 'login' }],
  });
  assert.equal(installed, false);
  assert.equal(h.rendered.length, 0);
  assert.equal(h.button.classes.size, 0);
});

test('GIS rejects empty token and handles rejected Supabase audience without logging credentials', async () => {
  const h = harness();
  const errors = [];
  const installed = await installGoogleGis({
    win: h.win, doc: h.doc, auth: {
      async signInWithIdToken() { return { error: { code: 'invalid_audience' } }; },
    },
    cryptoImpl: webcrypto,
    blocks: [{ block: h.block, context: 'login' }],
    onError: (msg) => errors.push(msg),
  });
  assert.equal(installed, true);
  await h.callbacks.initialize.callback({ credential: '' });
  await h.callbacks.initialize.callback({ credential: 'fake.jwt.token' });
  assert.equal(errors.length, 2);
  assert.ok(errors.every(msg => msg.includes('alternative Google sign-in')));
});

test('new Google ID client is not shipped with a secret and CSP limits SDK to Google GIS endpoints', async () => {
  const [loginSource, gisSource, html, headers] = await Promise.all([
    read('src/social-oauth-auth.js'),
    read('src/google-gis-auth.js'),
    read('app/index.html'),
    read('_headers'),
  ]);
  assert.match(loginSource, /installGoogleGis/);
  assert.match(loginSource, /client\.auth\.signInWithOAuth/);
  assert.doesNotMatch(gisSource, /client_secret|GOOGLE_SECRET|eval\s*\(/i);
  for (const source of [html, headers]) {
    assert.match(source, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/);
    assert.match(source, /frame-src https:\/\/accounts\.google\.com\/gsi\//);
    assert.match(source, /connect-src [^;]+ https:\/\/accounts\.google\.com\/gsi\//);
  }
});
