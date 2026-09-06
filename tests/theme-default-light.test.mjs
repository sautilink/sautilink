import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const themeInitPath = new URL('../app/assets/theme-init.js', import.meta.url);

async function runThemeInit({ stored = null, storageError = false } = {}) {
  const source = await readFile(themeInitPath, 'utf8');
  const root = { dataset: {}, style: {} };
  const meta = { content: '', setAttribute(name, value) { if (name === 'content') this.content = value; } };

  const context = {
    localStorage: {
      getItem() {
        if (storageError) throw new Error('storage unavailable');
        return stored;
      },
    },
    window: {
      matchMedia() {
        throw new Error('system colour preference must not replace SautiLink default');
      },
    },
    document: {
      documentElement: root,
      querySelector(selector) {
        return selector === 'meta[name="theme-color"]' ? meta : null;
      },
    },
  };

  vm.runInNewContext(source, context);
  return { root, meta };
}

test('new visitors default to the light theme', async () => {
  const { root, meta } = await runThemeInit();
  assert.equal(root.dataset.theme, 'light');
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(meta.content, '#ffffff');
});

test('an explicit saved theme choice is preserved', async () => {
  const dark = await runThemeInit({ stored: 'dark' });
  assert.equal(dark.root.dataset.theme, 'dark');
  assert.equal(dark.meta.content, '#0b0c0f');

  const light = await runThemeInit({ stored: 'light' });
  assert.equal(light.root.dataset.theme, 'light');
});

test('light remains the fallback when browser storage is unavailable', async () => {
  const { root } = await runThemeInit({ storageError: true });
  assert.equal(root.dataset.theme, 'light');
});
