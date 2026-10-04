import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  handleMaintenanceRequest,
  MAINTENANCE_ARTWORK_DATA_URL,
} from '../src/maintenance-page.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('maintenance route shows only the availability message with branding and social links', async () => {
  assert.match(MAINTENANCE_ARTWORK_DATA_URL, /^data:image\/webp;base64,UklG/);
  assert.ok(MAINTENANCE_ARTWORK_DATA_URL.length > 45_000, 'attached maintenance artwork should be embedded in the Worker source');

  for (const pathname of ['/maintenance', '/maintenance/']) {
    const url = new URL(`https://sautilink.com${pathname}`);
    const response = handleMaintenanceRequest(new Request(url), url);
    assert.ok(response, `expected ${pathname} to be handled`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'none'/);
    assert.match(response.headers.get('content-security-policy') || '', /font-src 'self'/);
    assert.match(response.headers.get('content-security-policy') || '', /img-src 'self' data:/);

    const html = await response.text();
    assert.match(html, /<h1 id="maintenance-title" data-i18n="title">SautiLink isn't available at the moment\.<\/h1>/);
    assert.match(html, /<p class="lead" data-i18n="lead">\s*Please check back later\./);
    assert.doesNotMatch(html, /Major system upgrade|Estimated maintenance time remaining|What is being improved\?/);
    assert.doesNotMatch(html, /class="countdown-wrap"|id="maintenance-countdown"|data-maintenance-end|setInterval\(/);
    assert.doesNotMatch(html, /class="status-chip"|Maintenance in progress/);
    assert.match(html, /font-family: "Inter"/);
    assert.match(html, /\/assets\/fonts\/inter\/InterVariable\.woff2/);
    assert.match(html, /class="brand-logo" src="\/logo\.png"/);
    assert.match(html, /class="maintenance-artwork" src="data:image\/webp;base64,UklG/);
    for (const href of [
      'https://facebook.com/sautilink',
      'https://twitter.com/@sautilink',
      'https://linkedin.com/company/sautilink',
      'https://instagram.com/sautilink',
      'https://youtube.com/@sautilink',
      'https://t.me/sautilink',
      'https://tiktok.com/@sautilink',
    ]) assert.ok(html.includes(`href="${href}"`), `missing social link ${href}`);

    assert.doesNotMatch(html, /supabase|app\.js|\/api\//i);
    assert.doesNotMatch(html, /location\.(?:href|assign|replace)|window\.location/i);
  }
});

test('maintenance language control defaults to English and switches all maintenance copy to Swahili', async () => {
  const url = new URL('https://sautilink.com/maintenance');
  const response = handleMaintenanceRequest(new Request(url), url);
  const html = await response.text();

  assert.match(html, /<html lang="en"/);
  assert.match(html, /data-language="en" aria-pressed="true">ENG<\/button>/);
  assert.match(html, /data-language="sw" aria-pressed="false">SW<\/button>/);
  assert.match(html, /English is deliberately the default on every page load/);
  assert.match(html, /applyLanguage\('en'\)/);
  assert.doesNotMatch(html, /navigator\.language|navigator\.languages|localStorage|sessionStorage/);

  assert.match(html, /SautiLink haipatikani kwa sasa\./);
  assert.match(html, /Tafadhali rudi tena baadaye\./);
  assert.doesNotMatch(html, /Maboresho makubwa ya mfumo|Muda unaokadiriwa kubaki|Nini kinaboreshwa\?/);
  assert.match(html, /document\.documentElement\.lang = currentLanguage/);
  assert.match(html, /button\.dataset\.language === currentLanguage/);
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

test('production Cloudflare routes send maintenance traffic to the Worker on apex and www', async () => {
  const config = await read('wrangler.production.jsonc');
  assert.match(config, /"pattern": "sautilink\.com\/maintenance\*"/);
  assert.match(config, /"pattern": "www\.sautilink\.com\/maintenance\*"/);
  assert.doesNotMatch(config, /"pattern"\s*:\s*"(?:www\.)?sautilink\.com\/\*"/);
});
