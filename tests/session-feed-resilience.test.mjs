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

test('member profile bootstrap retries reads and does not treat a transient read as logout', async () => {
  const app = await transformedApp();
  const start = app.indexOf('async function loadMemberOnce(user)');
  const end = app.indexOf('async function loadMember(user)', start);
  const block = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(app, /const READ_RETRY_ATTEMPTS = 3/);
  assert.match(app, /async function resilientRead/);
  assert.match(block, /resilientRead\(\(\) => supabase/);
  assert.match(block, /memberFallbackProfile\(user/);
  assert.match(block, /cachedSession\?\.user\?\.id === user\.id/);
  assert.doesNotMatch(block, /Your session opened, but your profile could not be loaded/);
  assert.doesNotMatch(block, /Your account is secure, but social profile setup is unavailable right now/);
});

test('member identity has a small local fallback cache for transient backend failures', async () => {
  const app = await transformedApp();
  assert.match(app, /const MEMBER_CACHE_PREFIX = 'sautilink\.member\.cache\.v1:'/);
  assert.match(app, /function cachedMemberProfile\(userId\)/);
  assert.match(app, /function cacheMemberProfile\(profile/);
  assert.match(app, /cacheMemberProfile\(hydratedMember, user\.id\)/);
  assert.match(app, /refreshMemberProfileAfterFallback\(user\)/);
});

test('Home feed retries transient reads and preserves an already-rendered feed', async () => {
  const app = await transformedApp();
  const start = app.indexOf('async function loadStream({ reset = false } = {})');
  const end = app.indexOf('function sautiCardsForPost', start);
  const block = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(block, /const hadRenderedFeed = feed\.childElementCount > 0/);
  assert.match(block, /await resilientRead\(\(\) =>/);
  assert.match(block, /\(\) => hydrateStreamEvents\(page\)/);
  assert.match(block, /if \(hadRenderedFeed\)/);
  assert.match(block, /error\.hidden = true/);
});

test('non-critical member services are deferred so Home feed gets first network access', async () => {
  const app = await transformedApp();
  const renderStart = app.indexOf('function renderMember(profile');
  const renderEnd = app.indexOf('async function loadMemberOnce', renderStart);
  const render = app.slice(renderStart, renderEnd);

  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(render, /void loadStream\(\{ reset: true \}\);/);
  assert.match(render, /startDeferredMemberServices\(\);/);
  assert.match(app, /function startDeferredMemberServices\(\)/);
  assert.match(app, /MEMBER_REFRESH_DELAY_MS = 700/);
});

test('production verifier rejects the old false-login behavior and requires the member cache marker', async () => {
  const verifier = await read('scripts/verify-production-artifact.mjs');
  assert.match(verifier, /sautilink\.member\.cache\.v1:/);
  assert.match(verifier, /still treats a transient profile read as a signed-out session/);
  assert.match(verifier, /Your session opened, but your profile could not be loaded\. Try again\./);
  assert.doesNotMatch(verifier, /production browser bundle missing signed-in bootstrap resilience marker: \$\{marker\}[\s\S]*Home feed loading timed out/);
});
