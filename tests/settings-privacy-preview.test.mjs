import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Settings preview is isolated from production services', async () => {
  const sourceHtml = await read('preview-src/settings/index.html');
  const builtHtml = await read('preview/settings/index.html');
  const headers = await read('_headers');

  assert.match(sourceHtml, /noindex, nofollow/);
  assert.match(sourceHtml, /connect-src 'none'/);
  assert.match(sourceHtml, /form-action 'none'/);
  assert.match(headers, /\/preview\/settings\/\*/);
  assert.doesNotMatch(`${sourceHtml}\n${builtHtml}`, /supabase\.co|sb_publishable_|service_role/i);
  assert.doesNotMatch(builtHtml, /<script[^>]+https?:\/\//i);
});

test('Settings preview covers the approved account-control contract', async () => {
  const component = await read('preview-src/settings/SettingsPreview.jsx');
  const main = await read('preview-src/settings/main.jsx');

  assert.match(main, /initialSection="settings"/);
  assert.match(main, /Preview 10/);
  for (const term of ['Active sessions', 'External search indexing', 'Who can message you', 'Security alerts', 'Blocked accounts', 'Muted accounts', 'Download your data', 'Delete your account', 'Type DELETE to continue']) {
    assert.match(component, new RegExp(term));
  }
  assert.doesNotMatch(component, /fetch\(|XMLHttpRequest|WebSocket|supabase/i);
  assert.match(component, /No account was changed/);
});

test('Settings preview has accessible responsive controls without decorative gradients', async () => {
  const component = await read('preview-src/settings/SettingsPreview.jsx');
  const css = await read('preview-src/settings/SettingsPreview.css');

  assert.match(component, /aria-label="Settings sections"/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /type="checkbox"/);
  assert.match(css, /input:focus-visible/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
});

test('Settings preview bundle stays inside its phase budget', async () => {
  const assetDirectory = new URL('../preview/settings/assets/', import.meta.url);
  const assets = await readdir(assetDirectory);
  const javascript = assets.find((name) => name.endsWith('.js'));
  const stylesheet = assets.find((name) => name.endsWith('.css'));

  assert.ok(javascript, 'expected a built JavaScript asset');
  assert.ok(stylesheet, 'expected a built CSS asset');
  assert.ok((await stat(new URL(javascript, assetDirectory))).size < 345_000, 'Settings JavaScript bundle exceeds 345 kB raw');
  assert.ok((await stat(new URL(stylesheet, assetDirectory))).size < 82_000, 'Settings CSS bundle exceeds 82 kB raw');
});

test('Settings architecture defines server-side security boundaries', async () => {
  const architecture = await read('docs/architecture/settings-privacy-preview.md');

  assert.match(architecture, /recent\s+authentication/);
  assert.match(architecture, /row-level security/);
  assert.match(architecture, /session revocation/);
  assert.match(architecture, /retention policy/);
  assert.match(architecture, /service-role credential/);
  assert.match(architecture, /rate limits/);
});
