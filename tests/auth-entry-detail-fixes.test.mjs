import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('username prefix is separated from the placeholder without changing the auth field markup', async () => {
  const [html, css] = await Promise.all([
    read('app/index.html'),
    read('app/assets/auth-entry-detail-fixes.css'),
  ]);

  assert.match(html, /<div class="username-field"><span aria-hidden="true">@<\/span><input id="signup-username"/);
  assert.match(css, /body\.auth-entry \.username-field > span\s*\{[^}]*position:\s*static !important/s);
  assert.match(css, /body\.auth-entry \.username-field > span\s*\{[^}]*inset:\s*auto !important/s);
  assert.match(css, /body\.auth-entry \.username-field > span\s*\{[^}]*margin:\s*0 0 0 17px !important/s);
  assert.match(css, /body\.auth-entry \.username-field input\s*\{[^}]*padding-left:\s*9px !important/s);
});

test('detail corrections load after the approved auth stylesheet and only target small visual details', async () => {
  const [source, css] = await Promise.all([
    read('src/social-oauth-auth.js'),
    read('app/assets/auth-entry-detail-fixes.css'),
  ]);

  const polishIndex = source.indexOf("ensureStylesheetLink('auth-entry-polish-styles'");
  const detailIndex = source.indexOf("ensureStylesheetLink('auth-entry-detail-fixes-styles'");
  assert.ok(polishIndex >= 0 && detailIndex > polishIndex);
  assert.match(css, /body\.auth-entry img\.social-oauth-brand-icon/);
  assert.doesNotMatch(css, /auth-card|auth-view|auth-tabs|form-submit/);
});
