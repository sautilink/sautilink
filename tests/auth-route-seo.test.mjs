import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import assetRouter from '../src/asset-router.js';
import { applyAuthRouteSeo } from '../src/auth-route-seo.js';

const ROOT = 'https://sautilink.com';
const appShell = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');

function head(html) {
  return html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
}

function tags(headContent, tagName) {
  return [...headContent.matchAll(new RegExp('<' + tagName + '\\b[^>]*>', 'gi'))].map(x => x[0]);
}

function attribute(tag, key) {
  return tag.match(new RegExp('\\b' + key + '=["\\x27]([^"\\x27]*)["\\x27]', 'i'))?.[1] || '';
}

function metadata(headContent, key) {
  return tags(headContent, 'meta')
    .filter(t => attribute(t, 'name') === key || attribute(t, 'property') === key)
    .map(t => attribute(t, 'content'));
}

async function route(pathname, origin = ROOT, method = 'GET') {
  return assetRouter.fetch(
    new Request(origin + pathname, { method, headers: { 'X-Request-ID': 'auth-seo-test-1234' } }),
    {
      ASSETS: {
        async fetch() {
          return new Response(method === 'HEAD' ? null : appShell, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Content-Length': '12345',
              ETag: 'generic-app-shell',
            },
          });
        },
      },
    },
  );
}

for (const mode of ['login', 'signup']) {
  test('auth SEO response for /' + mode + ' is unique and nonindexable across route variants', async () => {
    const canonical = ROOT + '/' + mode;
    for (const origin of [ROOT, 'https://www.sautilink.com']) {
      for (const suffix of ['', '/', '?next=%2Fhome']) {
        const response = await route('/' + mode + suffix, origin);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, follow');
        assert.equal(response.headers.get('ETag'), null);
        assert.equal(response.headers.get('Content-Length'), null);
        const html = await response.text();
        const h = head(html);
        const canonicalTags = tags(h, 'link')
          .filter(t => attribute(t, 'rel') === 'canonical');
        assert.equal(canonicalTags.length, 1);
        assert.equal(attribute(canonicalTags[0], 'href'), canonical);
        assert.deepEqual(metadata(h, 'robots'), ['noindex, follow']);
        assert.equal(metadata(h, 'description').length, 1);
        assert.equal(metadata(h, 'og:url')[0], canonical);
        assert.equal(metadata(h, 'og:title').length, 1);
        assert.equal(metadata(h, 'og:description').length, 1);
        for (const key of ['og:type', 'og:site_name', 'og:locale', 'og:image',
          'og:image:secure_url', 'og:image:type', 'og:image:alt', 'twitter:card',
          'twitter:title', 'twitter:description', 'twitter:image',
          'twitter:image:alt', 'twitter:site']) {
          assert.equal(metadata(h, key).length, 1, 'missing or duplicate ' + key);
        }
        assert.equal(metadata(h, 'og:image')[0], ROOT + '/logo.png');
        assert.equal(metadata(h, 'twitter:image')[0], ROOT + '/logo.png');
        assert.equal(metadata(h, 'og:locale')[0], 'en_US');
        const data = h.match(/<script type="application\/ld\+json" data-seo="SEO_AUTH_ROUTES_20261108">([\s\S]*?)<\/script>/);
        assert.ok(data, 'missing authentication page JSON-LD');
        const graph = JSON.parse(data[1])['@graph'];
        assert.equal(graph.find(x => x['@type'] === 'Organization')['@id'], ROOT + '/#organization');
        assert.equal(graph.find(x => x['@type'] === 'WebSite')['@id'], ROOT + '/#website');
        assert.equal(graph.find(x => x['@type'] === 'WebPage').url, canonical);
        assert.ok(!/^\s*<meta name="robots" content="index/i.test(h), 'auth route should not be indexable');
        assert.match(html, new RegExp('data-sautilink-auth-entry="' + mode + '"'));
        assert.match(html, /id="login-form"/);
        assert.match(html, /id="signup-form"/);
      }
    }
  });

  test('/' + mode + ' HEAD never receives generic app indexing headers', async () => {
    const response = await route('/' + mode, ROOT, 'HEAD');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, follow');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('ETag'), null);
    assert.equal(await response.text(), '');
  });
}

test('login and signup have distinct titles and do not alter visible app HTML', () => {
  const login = applyAuthRouteSeo(appShell, 'login');
  const signup = applyAuthRouteSeo(appShell, 'signup');
  assert.match(login, /<title>Log in to SautiLink \| SautiLink<\/title>/);
  assert.match(signup, /<title>Create your SautiLink account \| SautiLink<\/title>/);
  assert.notEqual(metadata(head(login), 'description')[0], metadata(head(signup), 'description')[0]);
  const originalBody = appShell.slice(appShell.search(/<\/head>/i) + 7);
  assert.equal(login.slice(login.search(/<\/head>/i) + 7), originalBody);
  assert.equal(signup.slice(signup.search(/<\/head>/i) + 7), originalBody);
  assert.equal(applyAuthRouteSeo(appShell, 'other'), appShell);
});

test('staging auth routes remain noindex nofollow at HTTP layer', async () => {
  const response = await route('/login', 'https://test.sautilink.com');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  assert.equal(metadata(head(await response.text()), 'robots')[0], 'noindex, follow');
});

test('login and signup stay outside static sitemap and public indexing scope', () => {
  const sitemap = readFileSync(new URL('../sitemap-static.xml', import.meta.url), 'utf8');
  assert.ok(!sitemap.includes('<loc>' + ROOT + '/login</loc>'));
  assert.ok(!sitemap.includes('<loc>' + ROOT + '/signup</loc>'));
  const html = applyAuthRouteSeo(appShell, 'login');
  assert.ok(!html.includes('SearchAction'));
});
