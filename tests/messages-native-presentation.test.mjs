import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const source = await read('src/messages-whatsapp-ui.js');
const html = await read('app/index.html');
const fn = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n}`))?.[0];

test('hidden Messages is prepared before the first navigation without waiting for a visibility observer', () => {
  for (const hidden of [true, false]) {
    let calls = 0;
    runInNewContext(`${fn('startMessagesWhatsAppUiWhenVisible')}\nstartMessagesWhatsAppUiWhenVisible();`, {
      messagesSurface: { hidden }, buildMessagesWhatsAppShell() { calls++; },
    });
    assert.equal(calls, 1);
  }
});

test('all Messages and Rooms presentation is render blocking and final layers follow member styles', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  for (const name of ['messages-whatsapp', 'messages-composer', 'messages-header-polish', 'messages-appearance', 'messages-media', 'messages-reply', 'messages-native', 'rooms', 'rooms-facebook', 'rooms-mobile-preview', 'rooms-invitations', 'rooms-native']) {
    assert.match(head, new RegExp(`<link[^>]+rel="stylesheet"[^>]+href="/app/assets/${name}\\.css\\?v=`));
  }
  assert.ok(head.indexOf('messages-native.css') > head.indexOf('member-ios-surfaces.css'));
  assert.ok(head.indexOf('rooms-native.css') > head.indexOf('member-ios-surfaces.css'));
  let appended = 0;
  runInNewContext(`${fn('ensureMessagesWhatsAppStyles')}\nensureMessagesWhatsAppStyles();`, {
    document: { querySelector() { return {}; }, head: { append() { appended++; } } },
  });
  assert.equal(appended, 0, 'eager links must not be replaced by later duplicate CSS');
});

test('new chat and Room bundles use fresh scoped URL cache keys in both builds', async () => {
  const production = await read('scripts/build-production-release.mjs');
  assert.match(html, /messages=20261020-native1&amp;rooms=20261020-native1/);
  assert.match(production, /messages=20261020-native1&rooms=20261020-native1/);
});

test('visible chat uses actual viewport and navigation bounds, including keyboard-sized viewports', () => {
  const cases = [
    { height: 844, top: 0, surface: 0, navTop: 770, navHeight: 65, expected: 770 },
    { height: 400, top: 0, surface: 0, navTop: 770, navHeight: 65, expected: 400 },
    { height: 400, top: 30, surface: 0, navTop: 770, navHeight: 65, expected: 400 },
    { height: 900, top: 0, surface: 20, navTop: 0, navHeight: 0, expected: 880 },
  ];
  for (const value of cases) {
    const properties = {};
    runInNewContext(`let messagesViewportFrame = 1; ${fn('updateMessagesViewport')}\nupdateMessagesViewport();`, {
      window: { innerHeight: 900, visualViewport: { height: value.height, offsetTop: value.top } },
      messagesSurface: { hidden: false, getBoundingClientRect: () => ({ top: value.surface }), style: { setProperty(k, v) { properties[k] = v; } } },
      document: { querySelector: () => ({ getBoundingClientRect: () => ({ top: value.navTop, height: value.navHeight, width: 390 }) }) },
      resizeMessagesComposer() {},
    });
    assert.equal(properties['--messages-shell-height'], `${value.expected}px`);
  }
});

test('attachment state is idempotent and cannot enable Send during an in-flight request', async () => {
  const media = await read('src/messages-media-ui.js');
  const sync = media.match(/function syncAttachmentSendState\([^]*?\n}/)?.[0];
  let disabled = false;
  let writes = 0;
  let busy = true;
  const context = {
    messagesMediaBody: { disabled: false, value: '' },
    messagesMediaSend: { get disabled() { return disabled; }, set disabled(v) { disabled = v; writes++; }, getAttribute: () => busy ? 'true' : null },
    pendingMessageAttachment: { status: 'ready', id: 'fixture' },
  };
  const update = runInNewContext(`${sync}\nsyncAttachmentSendState`, context);
  for (let i = 0; i < 20; i++) update();
  assert.equal(disabled, true);
  assert.equal(writes, 1, 'unchanged boolean attributes cannot schedule a mutation loop');
  busy = false;
  update();
  assert.equal(disabled, false);
  assert.equal(writes, 2);
});

test('keyboard-height composer keeps overflow scrollable within the actual CSS limit', () => {
  const style = {};
  const body = { style, scrollHeight: 120, get clientHeight() { return Number.parseFloat(style.height) || 44; } };
  runInNewContext(`${fn('resizeMessagesComposer')}\nresizeMessagesComposer();`, {
    messagesSurface: { hidden: false }, document: { getElementById: () => body },
    getComputedStyle: () => ({ maxHeight: '84px' }),
  });
  assert.equal(style.height, '84px');
  assert.equal(style.overflowY, 'auto');
});
