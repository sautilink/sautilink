import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('account entry reference layout stays presentation-only and keeps every existing auth panel', async () => {
  const [html, css, socialSource] = await Promise.all([
    read('app/index.html'),
    read('app/assets/auth-entry-polish.css'),
    read('src/social-oauth-auth.js'),
  ]);

  assert.match(socialSource, /guest-entry-gate\.css\?v=20260920-authui2/);
  assert.match(socialSource, /auth-entry-polish\.css\?v=20260920-authui2/);
  assert.match(socialSource, /ensureStylesheetLink\('social-oauth-auth-styles',[\s\S]*ensureStylesheetLink\('auth-entry-polish-styles'/);
  assert.match(socialSource, /title\.textContent = signingUp \? 'Create your SautiLink account' : 'Welcome back to SautiLink'/);
  assert.match(socialSource, /loginTab\.textContent = 'Login'/);
  assert.match(socialSource, /signupTab\.textContent = 'Register'/);
  assert.match(html, /<h2>Welcome back to SautiLink<\/h2>/);
  assert.match(html, /<p>Sign in to continue to your account\.<\/p>/);
  assert.match(html, /id="login-tab"[^>]*>Login<\/button>/);
  assert.match(html, /id="signup-tab"[^>]*>Register<\/button>/);
  assert.doesNotMatch(html, /Connect with people, communities and conversations/);
  assert.ok(
    html.indexOf('id="show-recovery"') < html.indexOf('class="form-submit auth-login-submit"'),
    'Forgot password must appear above the Login button',
  );

  for (const marker of [
    'id="login-panel"',
    'id="signup-panel"',
    'id="verify-panel"',
    'id="passwordless-panel"',
    'id="recovery-panel"',
    'id="password-panel"',
    'id="onboarding-panel"',
    'id="login-form"',
    'id="signup-form"',
  ]) assert.match(html, new RegExp(marker));

  assert.match(css, /--auth-entry-navy:\s*#192640/);
  assert.match(css, /body\.auth-entry \.auth-view[\s\S]*flex-direction:\s*column/);
  assert.match(css, /body\.auth-entry \.auth-card[\s\S]*margin:\s*-62px auto 0/);
  assert.match(css, /body\.auth-entry \.auth-tabs[\s\S]*border-radius:\s*999px/);
  assert.match(css, /body\.auth-entry \.auth-form > input[\s\S]*border-radius:\s*999px !important/);
  assert.match(css, /body\.auth-entry \.form-submit[\s\S]*background:\s*var\(--auth-entry-accent\) !important/);
  assert.match(css, /body\.auth-entry \.auth-forgot-action\s*\{[^}]*width:\s*auto;[^}]*justify-self:\s*end;[^}]*text-align:\s*right;/s);
  assert.match(css, /body\.auth-entry \.social-oauth-block[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /body\.auth-entry \.birth-date-control > select/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /url\(https?:\/\//i);
});

test('social providers follow the form like the reference instead of leading the fields', async () => {
  const source = await read('src/social-oauth-auth.js');
  assert.match(source, /separator\.textContent = context === 'login' \? 'Or login with' : 'Or register with'/);
  assert.match(source, /block\.append\(separator\)[\s\S]*SOCIAL_OAUTH_PROVIDERS\.forEach/);
  assert.match(source, /button\.setAttribute\('aria-label', provider\.label\)/);
  assert.match(source, /<span class="social-oauth-label">\$\{provider\.name\}<\/span>/);
  assert.match(source, /form\.insertAdjacentElement\('afterend', block\)/);
  assert.doesNotMatch(source, /form\.insertAdjacentElement\('beforebegin', block\)/);
});

test('account entry refresh does not introduce auth, storage, network or backend logic', async () => {
  const [css, socialSource] = await Promise.all([
    read('app/assets/auth-entry-polish.css'),
    read('src/social-oauth-auth.js'),
  ]);
  assert.doesNotMatch(css, /supabase|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/i);
  assert.doesNotMatch(socialSource, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/i);
});
