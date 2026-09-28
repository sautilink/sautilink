import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { APP_LINK_HOSTS } from '../src/android-app-links.js';
import { PWA_ID, WWW_PWA_ID, pwaOriginAssociationResponse } from '../src/pwa-origin-association.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('PWA origin associations match its manifest identity and are limited to requested hosts', async () => {
  const manifest = JSON.parse(read('manifest.json'));
  const routes = JSON.parse(read('wrangler.production.jsonc')).routes.map(({ pattern }) => pattern);
  const declared = manifest.scope_extensions.map(({ type, origin }) => {
    assert.equal(type, 'origin');
    return new URL(origin).hostname;
  });
  assert.equal(new URL(manifest.id, PWA_ID).href, PWA_ID);
  assert.equal(manifest.scope, '/');
  assert.equal(new Set(declared).size, 9);
  assert.deepEqual(new Set(declared), APP_LINK_HOSTS);
  assert.ok(routes.includes('sautilink.com/manifest.json*'));
  assert.ok(routes.includes('www.sautilink.com/manifest.json*'));
  for (const host of ['sautilink.com', 'www.sautilink.com']) {
    assert.ok(routes.includes(`${host}/sw.js*`));
    assert.ok(routes.includes(`${host}/assets/pwa.js*`));
  }

  for (const host of APP_LINK_HOSTS) {
    assert.ok(routes.includes(`${host}/.well-known/web-app-origin-association*`), host);
    const url = `https://${host}/.well-known/web-app-origin-association`;
    const response = pwaOriginAssociationResponse(new Request(url), new URL(url));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { [PWA_ID]: { scope: '/' }, [WWW_PWA_ID]: { scope: '/' } });
    const head = pwaOriginAssociationResponse(new Request(url, { method: 'HEAD' }), new URL(url));
    assert.equal(await head.text(), '');
  }

  const unknown = 'https://other.example/.well-known/web-app-origin-association';
  assert.equal(pwaOriginAssociationResponse(new Request(unknown), new URL(unknown)), null);
});
