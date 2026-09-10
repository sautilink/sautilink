import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('WhatsApp-style Messages UI is isolated to the Messages surface', async () => {
  const source = await read('src/messages-whatsapp-ui.js');

  assert.match(source, /document\.getElementById\('messages-surface'\)/);
  assert.match(source, /if \(!messagesSurface\.hidden\)/);
  assert.match(source, /visibilityObserver\.observe\(messagesSurface/);
  assert.match(source, /attributeFilter: \['hidden'\]/);
  assert.match(source, /visibilityObserver\.disconnect\(\)/);
  assert.doesNotMatch(source, /observe\(document\.body/);
  assert.doesNotMatch(source, /observe\(document\.documentElement/);
  assert.doesNotMatch(source, /supabase|service_role|sb_secret_|fetch\(/i);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('Messages UI provides WhatsApp-style two-pane desktop and focused mobile layouts', async () => {
  const css = await read('app/assets/messages-whatsapp.css');

  for (const marker of [
    '.messages-whatsapp-ui',
    '.messages-wa-shell',
    '.messages-wa-sidebar',
    '.messages-wa-stage',
    '.message-inbox-item',
    '.message-thread-header',
    '.dm-message.own',
    '.message-composer',
    '.messages-wa-thread-menu',
    ':has(#message-thread:not([hidden]))',
    '@media (max-width: 680px)',
  ]) assert.ok(css.includes(marker), `missing Messages UI marker: ${marker}`);

  assert.match(css, /grid-template-columns: minmax\(255px, 34%\) minmax\(0, 1fr\)/);
  assert.match(css, /#messages-inbox\[hidden\][\s\S]*display: block !important/);
});

test('Messages presentation preserves the existing privacy and feature boundary', async () => {
  const html = await read('app/index.html');
  const source = await read('src/messages-whatsapp-ui.js');

  assert.match(html, /Private messages are not end-to-end encrypted/);
  assert.match(html, /Text only/);
  assert.doesNotMatch(`${html}\n${source}`, /End-to-end encrypted|Voice call|Video call|Group chat|Disappearing message/);
});

test('normal and production builds include the scoped Messages UI', async () => {
  const normalBuilder = await read('scripts/build-app.mjs');
  const productionBuilder = await read('scripts/build-production-release.mjs');

  assert.match(normalBuilder, /src\/messages-whatsapp-ui\.js/);
  assert.match(productionBuilder, /workerSource, 'messages-whatsapp-ui\.js'/);
});
