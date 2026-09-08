import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('social auth uses Supabase OAuth and the production SautiLink return URL', async () => {
  const source = await read('src/social-oauth-auth.js');

  assert.match(source, /client\.auth\.signInWithOAuth\(/);
  assert.match(source, /id: 'google'/);
  assert.match(source, /id: 'facebook'/);
  assert.match(source, /provider: provider\.id/);
  assert.match(source, /SOCIAL_OAUTH_REDIRECT = 'https:\/\/sautilink\.com\/home'/);
  assert.doesNotMatch(source, /signUp\(/);
});

test('Google and Facebook social auth are available from sign-in and create-account surfaces', async () => {
  const source = await read('src/social-oauth-auth.js');

  assert.match(source, /createBlock\('login-panel', 'login-form', 'login'\)/);
  assert.match(source, /createBlock\('signup-panel', 'signup-form', 'signup'\)/);
  assert.match(source, /Continue with Google/);
  assert.match(source, /Continue with Facebook/);
  assert.match(source, /SOCIAL_OAUTH_PROVIDERS\.forEach/);
  assert.match(source, /By continuing, you agree to the/);
  assert.match(source, /href=\"\/terms\"/);
  assert.match(source, /href=\"\/privacy\"/);
});

test('social OAuth styling is external and compatible with the production CSP', async () => {
  const [source, css] = await Promise.all([
    read('src/social-oauth-auth.js'),
    read('app/assets/guest-entry-gate.css'),
  ]);

  assert.match(source, /SOCIAL_OAUTH_STYLESHEET = '\/app\/assets\/guest-entry-gate\.css/);
  assert.match(source, /document\.createElement\('link'\)/);
  assert.match(source, /link\.rel = 'stylesheet'/);
  assert.doesNotMatch(source, /document\.createElement\('style'\)/);
  assert.match(css, /\.social-oauth-button/);
  assert.match(css, /\.social-oauth-separator/);
  assert.match(css, /body\.auth-entry \.social-oauth-button/);
  assert.match(css, /:focus-visible/);
});

test('Google and Facebook use dedicated provider marks', async () => {
  const source = await read('src/social-oauth-auth.js');

  assert.match(source, /social-oauth-google-icon/);
  assert.match(source, /#4285F4/);
  assert.match(source, /#34A853/);
  assert.match(source, /#FBBC05/);
  assert.match(source, /#EA4335/);
  assert.match(source, /social-oauth-facebook-icon/);
  assert.match(source, /#1877F2/);
  assert.doesNotMatch(source, /social-oauth-mark/);
});

test('social OAuth frontend contains no provider client secrets', async () => {
  const source = await read('src/social-oauth-auth.js');

  assert.doesNotMatch(source, /client_secret/i);
  assert.doesNotMatch(source, /GOOGLE_SECRET/i);
  assert.doesNotMatch(source, /FACEBOOK_SECRET/i);
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}/);
});

test('provider buttons share busy state and provider-specific safe errors', async () => {
  const source = await read('src/social-oauth-auth.js');

  assert.match(source, /setProviderButtonsBusy\(block, true\)/);
  assert.match(source, /setProviderButtonsBusy\(block, false\)/);
  assert.match(source, /provider_disabled/);
  assert.match(source, /Too many sign-in attempts/);
  assert.doesNotMatch(source, /error\.message/);
});

test('social OAuth is bundled through the canonical app build', async () => {
  const [appBuild, productionBuild] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);
  assert.match(appBuild, /src\/social-oauth-auth\.js/);
  assert.match(productionBuild, /src\/social-oauth-auth\.js/);
});

test('new OAuth identities reuse the existing SautiLink onboarding path', async () => {
  const app = await read('src/app.js');

  assert.match(app, /showAuthPanel\('onboarding'\)/);
  assert.match(app, /complete_social_onboarding/);
});
