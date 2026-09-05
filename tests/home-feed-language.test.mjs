import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('member-facing timeline language uses Home and Feed instead of Stream', async () => {
  const html = await read('app/index.html');
  const source = await read('src/app.js');

  assert.match(html, /data-member-view="stream"[\s\S]*?<span>Home<\/span>/);
  assert.match(html, /id="view-title">Home<\/h1>/);
  assert.match(html, /Welcome to SautiLink, <span id="member-first-name">member<\/span>\./);
  assert.match(html, /aria-label="Home feed"/);
  assert.match(html, /<h3>Sautify posts<\/h3>/);

  assert.doesNotMatch(html, />[^<]*\bStream\b[^<]*</);
  assert.doesNotMatch(html, /(?:aria-label|title|placeholder)="[^"]*\bStream\b[^"]*"/);
  assert.doesNotMatch(source, /['"`][^'"`\n]*\bStream\b[^'"`\n]*['"`]/);
});

test('preview-facing timeline language follows the same Home and Feed vocabulary', async () => {
  const sources = [
    await read('preview-src/app-shell/App.jsx'),
    await read('preview-src/app-shell/ConversationPreview.jsx'),
    await read('preview-src/identity/IdentityGate.jsx'),
    await read('preview-src/settings/SettingsPreview.jsx'),
    await read('preview-src/share-stream/main.jsx'),
    await read('scripts/stage-preview-site.mjs'),
  ].join('\n');

  assert.match(sources, /label: 'Home'/);
  assert.match(sources, /Home feed/);
  assert.match(sources, /Sautify posts/);
  assert.doesNotMatch(sources, /['"`][^'"`\n]*\bStream\b[^'"`\n]*['"`]/);
});
