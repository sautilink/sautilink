import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('account entry keeps every existing auth panel and matches its first-paint presentation stylesheet', async () => {
  const [html, css, socialSource] = await Promise.all([
    read('app/index.html'),
    read('app/assets/auth-entry-polish.css'),
    read('src/social-oauth-auth.js'),
  ]);

  assert.match(socialSource, /guest-entry-gate\.css\?v=20260920-authui2/);
  const stylesheet = socialSource.match(/const AUTH_ENTRY_POLISH_STYLESHEET = '([^']+)'/)?.[1];
  assert.ok(stylesheet, 'The runtime must retain an explicit account-entry stylesheet');
  assert.ok(html.includes(`href="${stylesheet}"`), 'The initial shell and runtime must use the same stylesheet');
  assert.match(socialSource, /ensureStylesheetLink\('social-oauth-auth-styles',[\s\S]*ensureStylesheetLink\('auth-entry-polish-styles'/);
  assert.match(socialSource, /import \{ installAuthEntryPresentation \} from '\.\/auth-entry-presentation\.js'/);
  assert.match(socialSource, /installAuthEntryPresentation\(\)/);
  assert.match(html, /<h1 class="auth-eyebrow">Your SautiLink account<\/h1>/);
  assert.match(html, /<h2>Welcome back to SautiLink<\/h2>/);
  assert.match(html, /<p>Sign in to continue to your account\.<\/p>/);
  assert.match(html, /id="login-tab"[^>]*>Log in<\/button>/);
  assert.match(html, /id="signup-tab"[^>]*>Sign up<\/button>/);
  assert.doesNotMatch(html, /Connect with people, communities and conversations/);
  assert.ok(
    html.indexOf('id="show-recovery"') < html.indexOf('class="form-submit auth-login-submit"'),
    'Forgot password must appear above the Login button',
  );

  for (const marker of [
    'id="login-panel"',
    'id="signup-panel"',
    'id="signup-phone-panel"',
    'id="verify-panel"',
    'id="passwordless-panel"',
    'id="recovery-panel"',
    'id="password-panel"',
    'id="onboarding-panel"',
    'id="login-form"',
    'id="signup-form"',
    'id="signup-phone-form"',
    'id="signup-phone-verify-form"',
    'id="signup-verify-form"',
    'id="passwordless-request-form"',
    'id="passwordless-verify-form"',
    'id="recovery-form"',
    'id="password-form"',
    'id="onboarding-form"',
  ]) assert.match(html, new RegExp(marker));

  assert.match(css, /body\.auth-entry\s*\{[^}]*--auth-entry-page:\s*#f8f8fa;/s);
  assert.match(css, /html\[data-theme="dark"\] body\.auth-entry\s*\{[^}]*--auth-entry-page:\s*#101113;/s);
  assert.match(css, /body\.auth-entry \.auth-view\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 560px\);/s);
  assert.match(css, /body\.auth-entry \.auth-tabs\s*\{[^}]*display:\s*grid !important;/s);
  assert.match(css, /body\.auth-entry \.form-submit[\s\S]*background:\s*var\(--auth-entry-accent\) !important/);
  assert.match(css, /body\.auth-entry \.auth-forgot-action\s*\{[^}]*width:\s*auto;[^}]*justify-self:\s*end;[^}]*text-align:\s*right;/s);
  assert.match(css, /body\.auth-entry \.social-oauth-block[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /url\(https?:\/\//i);
});

test('social providers remain after the form and keep their original accessible provider labels', async () => {
  const source = await read('src/social-oauth-auth.js');
  assert.match(source, /separator\.textContent = 'Or continue with'/);
  assert.match(source, /block\.append\(separator\)[\s\S]*SOCIAL_OAUTH_PROVIDERS\.forEach/);
  assert.match(source, /button\.setAttribute\('aria-label', provider\.label\)/);
  assert.match(source, /<span class="social-oauth-label">\$\{provider\.name\}<\/span>/);
  assert.match(source, /form\.insertAdjacentElement\('afterend', block\)/);
  assert.doesNotMatch(source, /form\.insertAdjacentElement\('beforebegin', block\)/);
});

test('account entry refresh does not introduce auth, storage, network or backend logic', async () => {
  const [css, socialSource, presentationSource] = await Promise.all([
    read('app/assets/auth-entry-polish.css'),
    read('src/social-oauth-auth.js'),
    read('src/auth-entry-presentation.js'),
  ]);
  assert.doesNotMatch(css, /supabase|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/i);
  assert.doesNotMatch(socialSource, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/i);
  assert.doesNotMatch(presentationSource, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|signInWith|signUp\(/i);
  assert.doesNotMatch(presentationSource, /\.(?:hidden|value)\s*=(?!=)|body\.dataset\.authMode\s*=/);
});

test('account forms expose persistent labels, native birth-date controls and truthful setup guidance', async () => {
  const [html, css, birthDateSource] = await Promise.all([
    read('app/index.html'),
    read('app/assets/auth-entry-polish.css'),
    read('src/birth-date-controls.js'),
  ]);
  assert.match(html, /<label for="login-email">Email or username<\/label>/);
  assert.match(html, /<label for="login-password">Password<\/label>/);
  assert.match(html, /<fieldset class="auth-form-group auth-details-group">[\s\S]*<legend>Your details<\/legend>/);
  assert.match(html, /<div class="auth-field auth-field-wide">\s*<label for="signup-email">/);
  assert.match(html, /<fieldset class="auth-form-group auth-security-group">[\s\S]*<legend>Your password<\/legend>/);
  assert.match(html, /Confirm your profile, if requested\./);
  assert.doesNotMatch(html, /id="signup-birth-date-fieldset"/);
  assert.match(birthDateSource, /emailLabel\.insertAdjacentElement\('beforebegin', fieldset\)/);
  assert.match(css, /body\.auth-entry \.auth-form \.birth-date-control > label\s*\{[^}]*position:\s*static !important;[^}]*width:\s*auto !important;[^}]*height:\s*auto !important;/s);
  assert.match(css, /body\.auth-entry \.birth-date-control > select\s*\{[^}]*font-size:\s*16px;/s);
  assert.match(css, /body\.auth-entry \.birth-date-control:last-child\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
  assert.match(css, /\.auth-view:not\(\[data-presentation-mode\]\)/);
});

test('account controls retain clear focus, password clearance, readable OTP fields and real status messages', async () => {
  const css = await read('app/assets/auth-entry-polish.css');
  assert.match(css, /body\.auth-entry \.auth-form \.password-field input\s*\{[^}]*padding-right:\s*76px;/s);
  assert.match(css, /body\.auth-entry \.auth-form input\.otp-input\s*\{[^}]*min-height:\s*64px;/s);
  assert.match(css, /body\.auth-entry \.auth-theme-toggle\s*\{[^}]*flex:\s*0 0 44px;/s);
  assert.match(css, /body\.auth-entry \.auth-entry-header\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(css, /body\.auth-entry \.auth-view button:focus-visible,[\s\S]*outline:\s*2px solid var\(--auth-entry-focus\);/);
  assert.match(css, /body\.auth-entry \.auth-result\s*\{[^}]*display:\s*flex;/s);
  assert.match(css, /body\.auth-entry \.auth-view \[hidden\],[\s\S]*body\.auth-entry \.auth-result\[hidden\]\s*\{\s*display:\s*none !important;/);
  assert.doesNotMatch(css, /body\.auth-entry \.auth-result\s*\{[^}]*display:\s*none/s);
});
