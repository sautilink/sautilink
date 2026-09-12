import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Messages composer uses a SautiLink-branded paper-plane send control', async () => {
  const ui = await read('src/messages-whatsapp-ui.js');
  const css = await read('app/assets/messages-composer.css');

  assert.match(ui, /messages-composer\.css\?v=20260912-composer1/);
  assert.match(ui, /messagesSendIcon = 'paper-plane'/);
  assert.match(ui, /messagesBrand = 'sautilink'/);
  assert.match(ui, /M22 2 15 22 11 13 2 9 22 2Z/);
  assert.match(css, /--message-brand: var\(--brand-primary, #2563eb\)/);
  assert.match(css, /background: var\(--message-brand\)/);
  assert.match(css, /#message-send::before\s*\{\s*content: none;/);
  assert.doesNotMatch(css, /--wa-green-strong/);
});

test('Messages composer override remains scoped to the Messages surface', async () => {
  const css = await read('app/assets/messages-composer.css');
  const selectors = css
    .split('{')
    .slice(0, -1)
    .map((part) => part.split('}').pop().trim())
    .filter((selector) => selector && !selector.startsWith('@'));

  for (const selector of selectors) {
    assert.ok(
      selector.includes('.messages-whatsapp-ui') || selector.includes('from') || selector.includes('to'),
      `unscoped Messages composer selector: ${selector}`,
    );
  }
});
