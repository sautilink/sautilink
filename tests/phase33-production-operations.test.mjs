import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 33 installs a low-cost recurring production readiness workflow', async () => {
  const workflow = await read('.github/workflows/phase33-production-operations.yml');

  assert.match(workflow, /name: Phase 33 Production Operations/);
  assert.ok(workflow.includes('cron: "17 */6 * * *"'));
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /sautilink-production-readiness-monitor/);
  assert.match(workflow, /node scripts\/check-production-readiness\.mjs/);
  assert.doesNotMatch(workflow, /secrets\.|CLOUDFLARE_API_TOKEN|SUPABASE_SERVICE_ROLE/);
});

test('Phase 33 readiness probe protects the production environment and root-site boundary', async () => {
  const script = await read('scripts/check-production-readiness.mjs');

  for (const marker of [
    'https://sautilink.com',
    'https://www.sautilink.com',
    '/api/health',
    '/app/',
    '/api/account/export',
    "'production'",
    "'assets'",
    "'media'",
    "'rate_limits'",
    'x-request-id',
    'noindex',
    'settings-surface',
    'data-sautilink-entry="login-redirect"',
    'url=/login',
    'AUTH_REQUIRED',
    'PRODUCTION_READINESS_PASS',
    'PRODUCTION_READINESS_FAIL',
  ]) assert.ok(script.includes(marker), `readiness probe missing ${marker}`);
});

test('Phase 33 operations documentation preserves the launch architecture', async () => {
  const phase = await read('docs/architecture/phase33-post-mvp-production-operations.md');
  const runbook = await read('docs/operations/production-runbook.md');

  assert.match(phase, /Post-MVP Production Operations & Reliability/);
  assert.match(phase, /No Supabase schema migration/);
  assert.match(phase, /No product UI redesign/);
  assert.match(phase, /every six hours/i);

  for (const marker of [
    'sautilink-social-production',
    'sautilink-media-production',
    'rggpyiterdbbugluejcs',
    'bbrydwzlhweuqxpgbahu',
    'Do not point production at staging',
    'account-entry root',
  ]) assert.ok(runbook.includes(marker), `runbook missing ${marker}`);
});
