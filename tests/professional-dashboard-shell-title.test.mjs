import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('professional dashboard hides only the duplicate shell title while open and restores it on exit', async () => {
  const source = await read('src/professional-dashboard.js');

  const openStart = source.indexOf('async function openDashboard()');
  const closeStart = source.indexOf('function closeDashboard()');
  const observeStart = source.indexOf('function observeProfile()');
  const navStart = source.indexOf('function installNavigationGuard()');
  const installStart = source.indexOf('export function installProfessionalDashboard');

  assert.ok(openStart >= 0 && closeStart > openStart && observeStart > closeStart && navStart > observeStart && installStart > navStart);

  const openBlock = source.slice(openStart, closeStart);
  const closeBlock = source.slice(closeStart, observeStart);
  const navBlock = source.slice(navStart, installStart);

  assert.match(openBlock, /const title = byId\('view-title'\);/);
  assert.match(openBlock, /if \(title\) title\.hidden = true;/);
  assert.doesNotMatch(openBlock, /title\.textContent\s*=/);

  assert.match(closeBlock, /title\.hidden = false;/);
  assert.match(closeBlock, /title\.textContent = 'Profile';/);

  assert.match(navBlock, /const title = byId\('view-title'\);/);
  assert.match(navBlock, /if \(title\) title\.hidden = false;/);

  // The inner Dashboard title beside the back button intentionally remains.
  assert.match(source, /const title = document\.createElement\('h2'\);[\s\S]*?title\.textContent = 'Dashboard';/);
});
