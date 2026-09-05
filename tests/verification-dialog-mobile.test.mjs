import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('verification details are centered on mobile without changing desktop placement', async () => {
  const css = await read('app/assets/verified-identity-controls.css');
  const loader = await read('src/verified-identity-controls.js');

  assert.match(loader, /\/app\/assets\/verified-identity-controls\.css/);
  assert.match(css, /@media \(max-width: 680px\) \{[\s\S]*?\.verification-info-dialog \{[\s\S]*?margin:\s*auto;/);
  assert.match(css, /width:\s*min\(430px, calc\(100% - 28px\)\)/);
  assert.match(css, /max-height:\s*calc\(100dvh - 28px\)/);
  assert.match(css, /border-radius:\s*18px/);
});

test('verification details keep strong contrast in light mode', async () => {
  const css = await read('app/assets/verified-identity-controls.css');

  assert.match(css, /:root\[data-theme="light"\] \.verification-info-dialog \.verification-info-message \{[\s\S]*?color:\s*var\(--app-text\)/);
  assert.match(css, /:root\[data-theme="light"\] \.verification-info-dialog \.verification-team-wordmark \{[\s\S]*?background:\s*var\(--app-panel-soft\)[\s\S]*?color:\s*var\(--app-text\)/);
  assert.match(css, /:root\[data-theme="light"\] \.verification-info-dialog #verification-info-close:hover \{[\s\S]*?background:\s*var\(--app-elevated\)[\s\S]*?color:\s*var\(--app-text\)/);
});
