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

test('Phase 33 readiness probe protects production boundaries, responsive images, and media timing', async () => {
  const script = await read('scripts/check-production-readiness.mjs');

  for (const marker of [
    'https://sautilink.com',
    'https://www.sautilink.com',
    '/api/health',
    '/api/sauti-media/status',
    '/api/sauti-media/${SYNTHETIC_MEDIA_ID}?w=480',
    '/app/',
    '/api/account/export',
    "'production'",
    "'assets'",
    "'media'",
    "'rate_limits'",
    'x-request-id',
    'noindex',
    'settings-surface',
    'data-sautilink-entry="account-choice"',
    'href="/login"',
    'href="/signup"',
    'responsive_images',
    'image_variant_widths',
    'EXPECTED_IMAGE_VARIANT_WIDTHS',
    '480, 960, 1440',
    'SYNTHETIC_MEDIA_ID',
    'server-timing',
    "hasTimingMetric(serverTiming, 'access')",
    "hasTimingMetric(serverTiming, 'total')",
    'MEDIA_NOT_FOUND',
    'mediaServerTiming',
    'durationMs',
    'AUTH_REQUIRED',
    'PRODUCTION_READINESS_PASS',
    'PRODUCTION_READINESS_FAIL',
  ]) assert.ok(script.includes(marker), `readiness probe missing ${marker}`);

  assert.match(script, /mediaTimingProbe\.response\.status === 404/);
  assert.match(script, /!\/\(\?:owner_id\|object_key\|authorization\|bearer\|token\)\/i\.test\(serverTiming\)/);
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
