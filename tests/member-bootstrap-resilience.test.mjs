import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformBootstrapResilienceSource } from '../scripts/bootstrap-resilience-source-transform.mjs';
import { transformMemberBootstrapResilienceSource } from '../scripts/member-bootstrap-resilience-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function transformedApp() {
  const source = await read('src/app.js');
  return transformMemberBootstrapResilienceSource(
    '/repo/src/app.js',
    transformBootstrapResilienceSource('/repo/src/app.js', source),
  );
}

test('signed-in bootstrap cannot wait forever on member profile reads', async () => {
  const app = await transformedApp();
  assert.match(app, /const MEMBER_BOOT_TIMEOUT_MS = 4500/);
  assert.match(app, /Member profile loading timed out\./);
  assert.match(app, /memberFallbackProfile/);
  assert.match(app, /refreshMemberProfileAfterFallback/);
  assert.match(app, /let memberLoadPromise = null/);
});

test('member shell opens before optional profile decoration', async () => {
  const app = await transformedApp();
  const renderStart = app.indexOf('function renderMember(profile');
  const renderEnd = app.indexOf('async function loadMemberOnce', renderStart);
  const render = app.slice(renderStart, renderEnd);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.ok(render.indexOf('loadingView.hidden = true;') < render.indexOf('renderProfile(currentMember)'));
  assert.match(render, /showMemberSurface\('stream', \{ syncUrl: false \}\)/);
  assert.match(render, /void loadStream\(\{ reset: true \}\)/);
});

test('bootstrap uses the already-restored session user instead of an extra blocking getUser call', async () => {
  const app = await transformedApp();
  const start = app.indexOf('async function bootstrap()');
  const bootstrap = app.slice(start);
  assert.match(bootstrap, /const user = session\.user;/);
  assert.doesNotMatch(bootstrap, /await supabase\.auth\.getUser\(\)/);
});

test('login bootstrap cannot remain trapped while session restoration is blocked', async () => {
  const app = await transformedApp();
  const start = app.indexOf('async function bootstrap()');
  const bootstrap = app.slice(start);
  assert.match(app, /const AUTH_SESSION_BOOT_TIMEOUT_MS = 4500/);
  assert.match(app, /const AUTH_ROUTE_REVEAL_MS = 1800/);
  assert.match(app, /function cachedAuthSession\(\)/);
  assert.match(bootstrap, /authSessionBootWithTimeout\(supabase\.auth\.getSession\(\)\)/);
  assert.match(bootstrap, /if \(!loadingView\.hidden\) showAuthPanel\(initialAuthRoute\[1\]\)/);
  assert.match(bootstrap, /renderMember\(fallback, cachedSession\.user\.id\)/);
  assert.doesNotMatch(bootstrap, /const \{ data: \{ session \}, error \} = await supabase\.auth\.getSession\(\)/);
});

test('normal and production builders apply member bootstrap resilience and production busts app JS cache', async () => {
  const [normal, production, verifier] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
    read('scripts/verify-production-artifact.mjs'),
  ]);
  assert.match(normal, /transformMemberBootstrapResilienceSource/);
  assert.match(production, /transformMemberBootstrapResilienceSource/);
  assert.match(production, /20260912-durable1/);
  assert.match(verifier, /app\.js\?v=20260912-durable1/);
});
