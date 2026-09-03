import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Trust and Safety preview is isolated from live services', async () => {
  const html = await read('preview-src/trust-safety/index.html');
  const built = await read('preview/trust-safety/index.html');
  const headers = await read('_headers');

  assert.match(html, /noindex, nofollow/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /supabase\.co|r2\.cloudflarestorage\.com|sb_publishable_|service_role/i);
  assert.doesNotMatch(built, /<script[^>]+https?:\/\//i);
  assert.match(headers, /\/preview\/trust-safety\/\*/);
  assert.match(headers, /Cache-Control: no-store/);
});

test('Trust and Safety preview includes the complete local contract', async () => {
  const preview = await read('preview-src/app-shell/SafetyPreview.jsx');
  const main = await read('preview-src/trust-safety/main.jsx');
  const architecture = await read('docs/architecture/trust-safety-admin-preview.md');

  for (const term of ['Report a Sauti', 'Reports', 'Appeals', 'Admin operations', 'Dismiss', 'Limit visibility', 'Escalate', 'audit entry', 'Seeded simulation']) {
    assert.match(preview, new RegExp(term));
  }
  for (const term of ['authenticated admin roles', 'RLS-protected', 'idempotent', 'immutable audit', 'service-role']) {
    assert.match(architecture, new RegExp(term, 'i'));
  }
  assert.match(main, /Preview 07/);
  assert.match(main, /initialSection="safety"/);
  assert.match(main, /enableSafetyPreview/);
});

test('Trust and Safety actions stay local and do not use network primitives', async () => {
  const preview = await read('preview-src/app-shell/SafetyPreview.jsx');
  assert.match(preview, /setReports/);
  assert.match(preview, /setAppeals/);
  assert.match(preview, /No report was sent to a server/);
  assert.doesNotMatch(preview, /fetch\(|XMLHttpRequest|WebSocket|supabase|service_role/i);
  assert.doesNotMatch(preview, /Math\.random/);
});

test('Trust and Safety preview bundle stays inside its milestone budget', async () => {
  const assetDirectory = new URL('../preview/trust-safety/assets/', import.meta.url);
  const assets = await readdir(assetDirectory);
  const javascript = assets.find((name) => name.match(/^index-.*\.js$/));
  const stylesheet = assets.find((name) => name.endsWith('.css'));
  assert.ok(javascript, 'expected a Trust and Safety JavaScript asset');
  assert.ok(stylesheet, 'expected a Trust and Safety CSS asset');
  assert.ok((await stat(new URL(javascript, assetDirectory))).size < 310_000, 'Trust and Safety JavaScript exceeds 310 kB raw');
  assert.ok((await stat(new URL(stylesheet, assetDirectory))).size < 80_000, 'Trust and Safety CSS exceeds 80 kB raw');
});

test('Trust and Safety styles stay restrained and self-contained', async () => {
  const css = await read('preview-src/trust-safety/SafetyPreview.css');
  assert.match(css, /--surface/);
  assert.match(css, /max-width: 700px/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
  assert.doesNotMatch(css, /https?:\/\//i);
});
