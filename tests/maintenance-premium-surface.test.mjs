import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  handleMaintenanceRequest,
  TANZANIA_PREMIUM_BACKGROUND_CSS,
} from '../src/maintenance-premium-surface.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('maintenance premium surface uses Tanzania flag colors outside the card with slow motion', async () => {
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--tz-green: #1eb53a/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--tz-blue: #00a3dd/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--tz-yellow: #fcd116/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--tz-black: #000000/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /body::before/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /body::after/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /\.maintenance-shell::before/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /tzPremiumDrift 20s/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /tzPremiumOrbit 31s/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /tzCardAura 14s/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /prefers-reduced-motion: reduce/);

  const url = new URL('https://sautilink.com/maintenance');
  const response = await handleMaintenanceRequest(new Request(url), url);
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') || '', /style-src 'unsafe-inline'/);
  const html = await response.text();
  assert.match(html, /--tz-green: #1eb53a/);
  assert.match(html, /--tz-blue: #00a3dd/);
  assert.match(html, /--tz-yellow: #fcd116/);
  assert.match(html, /--tz-black: #000000/);
  assert.match(html, /class="card" aria-labelledby="maintenance-title"/);
  assert.match(html, /body::before/);
  assert.match(html, /\.maintenance-shell::before/);
});

test('premium wrapper preserves maintenance method handling and ignores non-maintenance routes', async () => {
  const headUrl = new URL('https://sautilink.com/maintenance');
  const head = await handleMaintenanceRequest(new Request(headUrl, { method: 'HEAD' }), headUrl);
  assert.ok(head);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const post = await handleMaintenanceRequest(new Request(headUrl, { method: 'POST' }), headUrl);
  assert.ok(post);
  assert.equal(post.status, 405);

  const homeUrl = new URL('https://sautilink.com/home');
  assert.equal(await handleMaintenanceRequest(new Request(homeUrl), homeUrl), null);
});

test('production Worker routes maintenance through the premium wrapper before other systems', async () => {
  const worker = await read('src/worker-entry.js');
  assert.match(worker, /from '\.\/maintenance-premium-surface\.js'/);
  assert.match(worker, /await handleMaintenanceRequest\(request, url\)/);
  const maintenanceIndex = worker.indexOf('await handleMaintenanceRequest(request, url)');
  const realtimeIndex = worker.indexOf("url.pathname.startsWith('/api/dm-realtime/')");
  const routerIndex = worker.indexOf('return router.fetch(request, env, ctx)');
  assert.ok(maintenanceIndex >= 0 && maintenanceIndex < realtimeIndex);
  assert.ok(maintenanceIndex < routerIndex);
});
