import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformAuthSessionStabilitySource } from '../scripts/auth-session-stability-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('signed-in refresh for the already active member does not reboot the member shell', async () => {
  const source = await read('src/app.js');
  const transformed = transformAuthSessionStabilitySource('/repo/src/app.js', source);

  assert.match(transformed, /if \(currentMemberId && currentMemberId === session\.user\.id\)/);
  assert.match(transformed, /currentAccountEmail = normalizeEmail\(session\.user\.email \|\| currentAccountEmail\)/);
  assert.match(transformed, /syncAccountSecurityEmail\(\);\s*return;\s*}\s*window\.setTimeout\(\(\) => loadMember\(session\.user\), 0\);/s);
});

test('auth session stability transform is wired into normal and production builds with a fresh cache key', async () => {
  const [normal, production] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(normal, /transformAuthSessionStabilitySource/);
  assert.match(production, /transformAuthSessionStabilitySource/);
  assert.match(production, /APP_JS_FEATURE_RELEASE = '20260918-dashboardroute1'/);
});

test('auth session stability transform leaves unrelated source files unchanged', () => {
  const source = 'export const value = 1;';
  assert.equal(transformAuthSessionStabilitySource('/repo/src/other.js', source), source);
});
