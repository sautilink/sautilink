import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleMaintenanceRequest, MAINTENANCE_END_ISO } from '../src/maintenance-page.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('maintenance route is standalone, private to search engines and dependency-free', async () => {
  assert.equal(MAINTENANCE_END_ISO, '');

  for (const pathname of ['/maintenance', '/maintenance/']) {
    const url = new URL(`https://sautilink.com${pathname}`);
    const response = handleMaintenanceRequest(new Request(url), url);
    assert.ok(response, `expected ${pathname} to be handled`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'none'/);

    const html = await response.text();
    assert.match(html, /Major system upgrade/);
    assert.match(html, /servers, security, platform infrastructure, performance, reliability/i);
    assert.match(html, /id="hours">--<\/span>/);
    assert.match(html, /id="minutes">--<\/span>/);
    assert.match(html, /id="seconds">--<\/span>/);
    assert.match(html, /Date\.parse\(rawEnd\)/);
    assert.match(html, /setInterval\(render, 1000\)/);
    assert.doesNotMatch(html, /supabase|app\.js|\/api\//i);
    assert.doesNotMatch(html, /location\.(?:href|assign|replace)|window\.location/i);
  }
});

test('maintenance endpoint rejects non-navigation methods and does not catch other paths', () => {
  const maintenanceUrl = new URL('https://sautilink.com/maintenance');
  const post = handleMaintenanceRequest(new Request(maintenanceUrl, { method: 'POST' }), maintenanceUrl);
  assert.equal(post?.status, 405);
  assert.equal(post?.headers.get('allow'), 'GET, HEAD');

  const homeUrl = new URL('https://sautilink.com/home');
  assert.equal(handleMaintenanceRequest(new Request(homeUrl), homeUrl), null);
});

test('Worker checks the maintenance route before Messages, indexing and the app router', async () => {
  const worker = await read('src/worker-entry.js');
  assert.match(worker, /handleMaintenanceRequest/);
  const maintenanceIndex = worker.indexOf('handleMaintenanceRequest(request, url)');
  const realtimeIndex = worker.indexOf("url.pathname.startsWith('/api/dm-realtime/')");
  const indexingIndex = worker.indexOf('handlePublicIndexingRoutes(request, env)');
  const routerIndex = worker.indexOf('return router.fetch(request, env, ctx)');
  assert.ok(maintenanceIndex >= 0 && maintenanceIndex < realtimeIndex);
  assert.ok(maintenanceIndex < indexingIndex);
  assert.ok(maintenanceIndex < routerIndex);
});
