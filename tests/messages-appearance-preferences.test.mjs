import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/messages-whatsapp-ui.js', import.meta.url), 'utf8');
const preferencesSource = source.slice(0, source.indexOf('function ensureMessagesWhatsAppStyles()'));

test('Messages appearance stays with the current account and rejects invalid saved values', () => {
  const values = new Map();
  const surface = { dataset: {}, style: { setProperty() {} } };
  let account = 'alice';
  const context = {
    document: { getElementById: () => surface },
    window: {
      __sautilinkMessagesUserId: () => account,
      localStorage: {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
      },
    },
  };
  runInNewContext(`${preferencesSource}
    globalThis.preferences = {
      load: loadMessagesAppearance,
      set(value) { messagesAppearance = normalizeMessagesAppearance(value); saveMessagesAppearance(); },
      forceReload() { messagesAppearanceAccount = ''; loadMessagesAppearance(); },
    };`, context);

  context.preferences.load();
  context.preferences.set({ wallpaper: 'sky', bubble: 'rounded', color: '#aabbcc' });
  assert.equal(surface.dataset.messagesWallpaper, 'sky');
  assert.equal(surface.dataset.messagesBubbles, 'rounded');

  account = 'bob';
  context.preferences.load();
  assert.equal(surface.dataset.messagesWallpaper, 'classic');
  assert.equal(surface.dataset.messagesBubbles, 'classic');
  context.preferences.set({ wallpaper: 'dots', bubble: 'square', color: '#112233' });

  account = 'alice';
  context.preferences.load();
  assert.equal(surface.dataset.messagesWallpaper, 'sky');
  assert.equal(surface.dataset.messagesBubbles, 'rounded');

  values.set('sautilink.messages.appearance.v1.alice', JSON.stringify({
    wallpaper: 'url(javascript:alert(1))', bubble: 'unknown', color: 'red; background: blue',
  }));
  context.preferences.forceReload();
  assert.equal(surface.dataset.messagesWallpaper, 'classic');
  assert.equal(surface.dataset.messagesBubbles, 'classic');
});
