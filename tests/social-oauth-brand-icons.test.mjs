import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('social OAuth buttons use repository brand assets for Facebook and Microsoft', async () => {
  const source = await read('src/social-oauth-auth.js');

  assert.match(source, /social-oauth-brand-icon social-oauth-google-icon/);
  assert.match(source, /FACEBOOK_ICON_ASSET = '\/assets\/facebook\.webp'/);
  assert.match(source, /MICROSOFT_ICON_ASSET = '\/assets\/microsoft\.svg'/);
  assert.match(source, /repositoryImageIconMarkup\('social-oauth-facebook-icon', FACEBOOK_ICON_ASSET\)/);
  assert.match(source, /repositoryImageIconMarkup\('social-oauth-microsoft-icon', MICROSOFT_ICON_ASSET\)/);
  assert.match(source, /<img class="social-oauth-brand-icon \$\{className\}" src="\$\{src\}"/);

  assert.match(source, /guest-entry-gate\.css\?v=20260920-authui2/);
  assert.match(source, /auth-entry-polish\.css\?v=20260920-authui2/);
  assert.match(source, /auth-entry-detail-fixes\.css\?v=20260920-authui3/);
});

test('the referenced Facebook and Microsoft logo assets exist in the repository', async () => {
  const [facebook, microsoft] = await Promise.all([
    read('assets/facebook.webp'),
    read('assets/microsoft.svg'),
  ]);

  assert.ok(facebook.length > 0);
  assert.match(microsoft, /<svg[\s\S]*viewBox="0 0 32 32"/);
});
