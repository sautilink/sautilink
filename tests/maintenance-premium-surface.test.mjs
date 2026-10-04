import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  handleMaintenanceRequest,
  MAINTENANCE_BLACK_SPECKLE_CSS,
} from '../src/maintenance-premium-surface.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('maintenance premium surface uses a static black speckled background with no Tanzania color treatment', async () => {
  assert.match(MAINTENANCE_BLACK_SPECKLE_CSS, /#050505/);
  assert.match(MAINTENANCE_BLACK_SPECKLE_CSS, /background-size:\s*43px 43px, 61px 61px, 79px 79px/);
  assert.match(MAINTENANCE_BLACK_SPECKLE_CSS, /repeating-radial-gradient/);
  assert.doesNotMatch(MAINTENANCE_BLACK_SPECKLE_CSS, /#1eb53a|#00a3dd|#fcd116|--tz-green|--tz-blue|--tz-yellow/);
  assert.doesNotMatch(MAINTENANCE_BLACK_SPECKLE_CSS, /animation\s*:/);
  assert.doesNotMatch(MAINTENANCE_BLACK_SPECKLE_CSS, /@keyframes/);

  const url = new URL('https://sautilink.com/maintenance');
  const response = await handleMaintenanceRequest(new Request(url), url);
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') || '', /style-src 'unsafe-inline'/);
  const html = await response.text();
  assert.match(html, /#050505/);
  assert.match(html, /repeating-radial-gradient/);
  assert.match(html, /class="card" aria-labelledby="maintenance-title"/);
  assert.doesNotMatch(html, /--tz-green|--tz-blue|--tz-yellow/);
});

test('maintenance card remains white with medium typography and a smaller logo', async () => {
  assert.match(MAINTENANCE_BLACK_SPECKLE_CSS, /\.card\s*\{[\s\S]*?color-scheme:\s*light;/);
  assert.match(MAINTENANCE_BLACK_SPECKLE_CSS, /background:\s*#ffffff/);
  assert.match(MAINTENANCE_BLACK_SPECKLE_CSS, /\.brand-logo\s*\{[\s\S]*?width:\s*82px/);
  assert.match(MAINTENANCE_BLACK_SPECKLE_CSS, /h1\s*\{[\s\S]*?font-size:\s*clamp\(28px, 5vw, 40px\)/);
  assert.match(MAINTENANCE_BLACK_SPECKLE_CSS, /\.lead\s*\{[\s\S]*?font-size:\s*clamp\(15px, 2\.3vw, 17px\)/);
  assert.match(MAINTENANCE_BLACK_SPECKLE_CSS, /\.brand-logo \{ width: 74px; \}/);

  const url = new URL('https://sautilink.com/maintenance');
  const response = await handleMaintenanceRequest(new Request(url), url);
  const html = await response.text();
  assert.match(html, /width:\s*82px/);
  assert.match(html, /font-size:\s*clamp\(28px, 5vw, 40px\)/);
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
