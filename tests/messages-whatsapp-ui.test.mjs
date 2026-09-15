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

test('reference refresh keeps SautiLink branding and the existing paper-plane send action', async () => {
  const [source, css, productionBuilder] = await Promise.all([
    read('src/messages-whatsapp-ui.js'),
    read('app/assets/messages-composer.css'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(source, /toolbarTitle\.textContent = 'Messages'/);
  assert.match(source, /messages-wa-brand-logo/);
  assert.match(source, /logo-compact\.webp/);
  assert.match(source, /data\.messagesSendIcon|dataset\.messagesSendIcon/);
  assert.match(source, /M22 2 15 22 11 13 2 9 22 2Z/);
  assert.match(source, /messages-composer\.css\?v=20260914-messagesui1/);
  assert.match(source, /messages-header-polish\.css\?v=20260915-messagesui4/);

  assert.match(css, /--message-brand: var\(--brand-primary, #2563eb\)/);
  assert.match(css, /grid-template-columns: minmax\(290px, 360px\) minmax\(0, 1fr\)/);
  assert.match(css, /\.dm-message\.own[\s\S]*background: var\(--message-own\)/);
  assert.match(css, /#message-send[\s\S]*background: var\(--message-brand\)/);
  assert.match(css, /\.messages-wa-brand-logo/);
  assert.match(css, /@media \(max-width: 680px\)/);

  assert.match(productionBuilder, /APP_JS_FEATURE_RELEASE = '20260915-messagesui4'/);
});

test('Messages header removes global chrome and keeps the branded title centered', async () => {
  const css = await read('app/assets/messages-header-polish.css');

  assert.match(css, /body:has\(#messages-surface:not\(\[hidden\]\)\) \.stream-header\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /\.messages-whatsapp-ui \.messages-toolbar\s*\{[^}]*position:\s*relative;/s);
  assert.match(css, /\.messages-whatsapp-ui \.messages-wa-title-row\s*\{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*transform:\s*translate\(-50%, -50%\);/s);
  assert.match(css, /\.messages-whatsapp-ui \.messages-wa-toolbar-actions\s*\{[^}]*margin-left:\s*auto;/s);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*body:has\(#messages-surface:not\(\[hidden\]\)\) \.mobile-header\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /\.messages-whatsapp-ui\s*\{[^}]*min-height:\s*calc\(100dvh - 60px\);/s);
  assert.match(css, /\.messages-whatsapp-ui \.messages-wa-shell\s*\{[^}]*min-height:\s*calc\(100dvh - 60px\);[^}]*height:\s*calc\(100dvh - 60px\);/s);
});

test('Messages inbox uses iOS-style return navigation without changing core message routing', async () => {
  const [source, css] = await Promise.all([
    read('src/messages-whatsapp-ui.js'),
    read('app/assets/messages-header-polish.css'),
  ]);

  assert.match(source, /let messagesReturnView = 'stream'/);
  assert.match(source, /captureMessagesNavigationOrigin/);
  assert.match(source, /\.app-nav \[data-member-view=/);
  assert.match(source, /\.mobile-nav \[data-member-view=/);
  assert.match(source, /className = 'messages-wa-app-back'/);
  assert.match(source, /Back to previous section/);
  assert.match(css, /\.messages-whatsapp-ui \.messages-wa-app-back\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.messages-whatsapp-ui \.messages-wa-app-back\s*\{[^}]*display:\s*inline-flex;/s);
});

test('thread back control surfaces unread message count in the existing back action', async () => {
  const [source, css] = await Promise.all([
    read('src/messages-whatsapp-ui.js'),
    read('app/assets/messages-header-polish.css'),
  ]);

  assert.match(source, /querySelectorAll\('\[data-message-badge\]'\)/);
  assert.match(source, /message-thread-back-count/);
  assert.match(source, /Back to chats, \$\{count\} unread message/);
  assert.match(source, /configureThreadBackButton\(document\.getElementById\('message-thread-back'\)\)/);
  assert.match(css, /\.messages-whatsapp-ui \.message-thread-back-count\s*\{/);
});

test('manual username new-message form is hidden while search and profile messaging remain intact', async () => {
  const [source, css] = await Promise.all([
    read('src/messages-whatsapp-ui.js'),
    read('app/assets/messages-header-polish.css'),
  ]);

  assert.match(source, /newForm\.hidden = true/);
  assert.match(source, /searchInput\.placeholder = 'Search or start new chat'/);
  assert.match(css, /\.messages-whatsapp-ui \.message-new-form\s*\{[^}]*display:\s*none !important;/s);
});

test('Messages inbox shows a quiet end-of-list state after existing conversations', async () => {
  const [source, css] = await Promise.all([
    read('src/messages-whatsapp-ui.js'),
    read('app/assets/messages-header-polish.css'),
  ]);

  assert.match(source, /className = 'messages-wa-list-end'/);
  assert.match(source, /No more chats/);
  assert.match(source, /You're all caught up\./);
  assert.match(source, /list\.querySelector\('\.message-inbox-item'\)/);
  assert.match(css, /\.messages-whatsapp-ui \.messages-wa-list-end\s*\{/);
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
