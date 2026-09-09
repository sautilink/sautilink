import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('social OAuth buttons use clean provider brand marks without inherited strokes', async () => {
  const source = await read('src/social-oauth-auth.js');

  assert.match(source, /social-oauth-brand-icon social-oauth-google-icon/);
  assert.match(source, /social-oauth-brand-icon social-oauth-facebook-icon/);
  assert.match(source, /social-oauth-brand-icon social-oauth-microsoft-icon/);

  assert.match(source, /#1877F2/);
  assert.match(source, /#F25022/);
  assert.match(source, /#7FBA00/);
  assert.match(source, /#00A4EF/);
  assert.match(source, /#FFB900/);

  assert.match(source, /<circle style="stroke:none"[^>]+fill="#1877F2"/);
  assert.match(source, /<rect style="stroke:none" x="0" y="0" width="10" height="10" fill="#F25022"/);
  assert.match(source, /<rect style="stroke:none" x="11" y="11" width="10" height="10" fill="#FFB900"/);
  assert.match(source, /guest-entry-gate\.css\?v=20260909-social4/);
});
