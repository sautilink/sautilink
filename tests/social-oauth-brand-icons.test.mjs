import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('social OAuth buttons use the approved provider assets and stable username prefix layout', async () => {
  const [source, prefixCss] = await Promise.all([
    read('src/social-oauth-auth.js'),
    read('app/assets/username-prefix-fix.css'),
  ]);

  assert.match(source, /social-oauth-brand-icon social-oauth-google-icon/);
  assert.match(source, /social-oauth-brand-icon social-oauth-facebook-icon/);
  assert.match(source, /social-oauth-brand-icon social-oauth-microsoft-icon/);

  assert.match(source, /\/assets\/facebook\.webp\?v=ebfaae33/);
  assert.match(source, /\/assets\/microsoft\.svg\?v=82f26260/);
  assert.doesNotMatch(source, /<circle style="stroke:none"[^>]+fill="#1877F2"/);
  assert.doesNotMatch(source, /<rect style="stroke:none" x="0" y="0" width="10" height="10" fill="#F25022"/);

  assert.match(source, /username-prefix-fix\.css\?v=20260920-authui3/);
  assert.match(source, /ensureStylesheetLink\('username-prefix-fix-styles', USERNAME_PREFIX_FIX_STYLESHEET\)/);
  assert.match(prefixCss, /#signup-form \.username-field > span/);
  assert.match(prefixCss, /#onboarding-form \.username-field > span/);
  assert.match(prefixCss, /position: static !important/);
  assert.match(prefixCss, /padding-left: 10px !important/);

  assert.match(source, /guest-entry-gate\.css\?v=20260920-authui2/);
  assert.match(source, /auth-entry-polish\.css\?v=20260920-authui2/);
});
