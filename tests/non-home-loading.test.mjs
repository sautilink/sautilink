import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

test('first paint keeps the legacy loader on Home and uses skeletons on other routes', async () => {
  const script = await readFile('app/assets/non-home-loading-init.js', 'utf8');
  for (const [pathname, expected] of [
    ['/home', 'home'],
    ['/app', 'home'],
    ['/notifications', 'content'],
    ['/rooms', 'content'],
    ['/settings', 'content'],
    ['/u/member', 'content'],
    ['/messages', 'content'],
  ]) {
    const root = { dataset: {} };
    runInNewContext(script, { window: { location: { pathname } }, document: { documentElement: root } });
    assert.equal(root.dataset.sautiBootLoading, expected, pathname);
  }
});

test('Home feed spinner remains while the non-Home loading states contain content placeholders', async () => {
  const html = await readFile('app/index.html', 'utf8');
  assert.match(html, /id="stream-loading"[\s\S]*?<span class="loading-mark"><\/span>/);
  for (const id of [
    'discover-loading', 'saved-loading', 'appeals-loading', 'moderation-loading',
    'notifications-loading', 'circles-loading', 'circle-stream-loading', 'settings-loading',
  ]) {
    assert.match(html, new RegExp(`id="${id}"[\\s\\S]*?class="sl-skeleton`, 'm'), id);
  }
});
