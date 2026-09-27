import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ANDROID_ASSET_LINKS, APP_LINK_HOSTS, androidAssetLinksResponse } from '../src/android-app-links.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every supported Android host serves the same signing certificate without a redirect', async () => {
  const primary = JSON.parse(read('.well-known/assetlinks.json'));
  const routes = JSON.parse(read('wrangler.production.jsonc')).routes.map((route) => route.pattern);
  assert.deepEqual(ANDROID_ASSET_LINKS, primary);
  assert.equal(APP_LINK_HOSTS.size, 9);

  for (const host of APP_LINK_HOSTS) {
    assert.ok(routes.includes(`${host}/.well-known/assetlinks.json*`), `${host} is missing its Worker route`);
    const url = `https://${host}/.well-known/assetlinks.json`;
    const response = androidAssetLinksResponse(new Request(url), new URL(url));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), primary);
    const head = androidAssetLinksResponse(new Request(url, { method: 'HEAD' }), new URL(url));
    assert.equal(await head.text(), '');
  }
  assert.equal(androidAssetLinksResponse(
    new Request('https://untrusted.example/.well-known/assetlinks.json'),
    new URL('https://untrusted.example/.well-known/assetlinks.json'),
  ), null);
});
