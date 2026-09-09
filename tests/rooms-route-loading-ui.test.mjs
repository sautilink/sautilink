import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Room deep-route feedback uses the normal loading state instead of the legacy route card', async () => {
  const source = await read('src/rooms-facebook-ui.js');

  assert.match(source, /routeState\.style\.display = 'none'/);
  assert.match(source, /routeState\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(source, /loadingCopy\.textContent = routeActive \? 'Loading Room…' : 'Loading Rooms…'/);
  assert.match(source, /Room unavailable/);
  assert.match(source, /This Room does not exist, is private, or is unavailable to your account\./);
  assert.match(source, /Room could not be opened/);
  assert.match(source, /data.*roomRouteAction|dataset\.roomRouteAction/);
});

test('legacy Room route card remains hidden while route loading and errors reuse stream-state UI', async () => {
  const source = await read('src/rooms-facebook-ui.js');

  assert.match(source, /loading\.hidden = false/);
  assert.match(source, /error\.hidden = false/);
  assert.match(source, /retry\.textContent = 'Back to Rooms'/);
  assert.match(source, /retry\.textContent = 'Try again'/);
  assert.match(source, /routeHome\?\.click\(\)/);
});
