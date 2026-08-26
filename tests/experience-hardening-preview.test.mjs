import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 12 preview is isolated from live services', async () => {
  const html = await read('preview-src/experience/index.html');
  const built = await read('preview/experience/index.html');
  const headers = await read('_headers');

  assert.match(html, /noindex, nofollow/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /supabase\.co|r2\.cloudflarestorage\.com|sb_publishable_|service_role/i);
  assert.doesNotMatch(built, /<script[^>]+https?:\/\//i);
  assert.match(headers, /\/preview\/experience\/\*/);
  assert.match(headers, /Cache-Control: no-store/);
});

test('Phase 12 includes functional product experience controls', async () => {
  const preview = await read('preview-src/app-shell/ExperiencePreview.jsx');
  const main = await read('preview-src/experience/main.jsx');

  for (const term of ['Search & Discover', 'Search result type', 'Mark all read', 'Privacy & safety', 'Accessibility', 'Data controls', 'test.sautilink.com']) {
    assert.match(preview, new RegExp(term.replace(/[&.]/g, '\\$&')));
  }
  for (const state of ['ready', 'loading', 'offline', 'error']) assert.match(preview, new RegExp(state));
  assert.match(main, /Preview 08/);
  assert.match(main, /enableExperiencePreview/);
  assert.match(main, /initialSection="discover"/);
});

test('Phase 12 interactions remain local and bounded', async () => {
  const preview = await read('preview-src/app-shell/ExperiencePreview.jsx');

  assert.match(preview, /slice\(0, 80\)/);
  assert.match(preview, /new Set/);
  assert.match(preview, /role="switch"/);
  assert.doesNotMatch(preview, /fetch\(|XMLHttpRequest|WebSocket|supabase|service_role/i);
  assert.doesNotMatch(preview, /Math\.random/);
  assert.doesNotMatch(preview, /Direct message|Messages/i);
});

test('Phase 12 architecture defines production hardening gates', async () => {
  const architecture = await read('docs/architecture/product-experience-hardening-preview.md');

  for (const term of ['cursor pagination', 'idempotent', 'RLS', 'rate limits', 're-authentication', 'test.sautilink.com', 'rollback', 'No production table']) {
    assert.match(architecture, new RegExp(term, 'i'));
  }
});

test('Phase 12 styles stay restrained and responsive', async () => {
  const css = await read('preview-src/experience/ExperiencePreview.css');

  assert.match(css, /max-width: 700px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
  assert.doesNotMatch(css, /https?:\/\//i);
});

test('Phase 12 preview bundle stays within the milestone budget', async () => {
  const assetDirectory = new URL('../preview/experience/assets/', import.meta.url);
  const assets = await readdir(assetDirectory);
  const javascript = assets.find((name) => name.endsWith('.js'));
  const stylesheet = assets.find((name) => name.endsWith('.css'));

  assert.ok(javascript, 'expected a Phase 12 JavaScript asset');
  assert.ok(stylesheet, 'expected a Phase 12 CSS asset');
  assert.ok((await stat(new URL(javascript, assetDirectory))).size < 390_000, 'Phase 12 JavaScript exceeds 390 kB raw');
  assert.ok((await stat(new URL(stylesheet, assetDirectory))).size < 95_000, 'Phase 12 CSS exceeds 95 kB raw');
});
