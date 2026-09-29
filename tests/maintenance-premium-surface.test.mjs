import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  handleMaintenanceRequest,
  TANZANIA_PREMIUM_BACKGROUND_CSS,
} from '../src/maintenance-premium-surface.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('maintenance premium surface keeps Tanzania flag colors outside the card without motion', async () => {
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--tz-green: #1eb53a/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--tz-blue: #00a3dd/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--tz-yellow: #fcd116/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--tz-black: #000000/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /body::before/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /body::after/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /\.maintenance-shell::before/);
  assert.doesNotMatch(TANZANIA_PREMIUM_BACKGROUND_CSS, /animation\s*:/);
  assert.doesNotMatch(TANZANIA_PREMIUM_BACKGROUND_CSS, /@keyframes/);
  assert.doesNotMatch(TANZANIA_PREMIUM_BACKGROUND_CSS, /tzPremiumDrift|tzPremiumOrbit|tzCardAura/);

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

test('maintenance premium card stays on a white light surface by default', async () => {
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /\.card\s*\{[\s\S]*?color-scheme:\s*light;/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--panel:\s*#ffffff/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--surface:\s*#f8fafc/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /--text:\s*#15171a/);
  assert.match(TANZANIA_PREMIUM_BACKGROUND_CSS, /background:\s*#ffffff/);

  const url = new URL('https://sautilink.com/maintenance');
  const response = await handleMaintenanceRequest(new Request(url), url);
  const html = await response.text();
  assert.match(html, /\.card\s*\{[\s\S]*?color-scheme:\s*light;/);
  assert.match(html, /background:\s*#ffffff/);
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
