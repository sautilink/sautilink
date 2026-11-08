import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const ORIGIN = 'https://sautilink.com';
const TRANSLATIONS = ['sw', 'fr', 'es', 'nb'];
const EDITED = ['sautinote', 'download', ...TRANSLATIONS, 'no'];

function head(html) {
  const result = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  assert.ok(result, 'document must have a head');
  return result[1];
}
function attribute(tag, name) {
  return tag.match(new RegExp('\\b' + name + '="([^"]*)"', 'i'))?.[1] || '';
}
function tags(content, tag) {
  return [...content.matchAll(new RegExp('<' + tag + '\\b[^>]*>', 'gi'))].map(x => x[0]);
}
function meta(content, key) {
  return tags(content, 'meta').filter(t => attribute(t, 'property') === key || attribute(t, 'name') === key).map(t => attribute(t, 'content'));
}
function canonical(content) {
  return tags(content, 'link').filter(t => attribute(t, 'rel') === 'canonical').map(t => attribute(t, 'href'));
}
function jsonLd(content) {
  const found = content.match(/<script type="application\/ld\+json" data-seo="SEO_PUBLIC_SITE_20261108">([\s\S]*?)<\/script>/);
  assert.ok(found, 'missing validated public-page structured data');
  return JSON.parse(found[1]);
}
test('new public SEO pages have accessible social image metadata and consistent structured data', async () => {
  await stat(new URL('../logo.png', import.meta.url));
  await stat(new URL('../assets/logo.png', import.meta.url));
  for (const slug of ['sautinote', 'download', ...TRANSLATIONS]) {
    const h = head(await read(slug + '.html'));
    const url = ORIGIN + '/' + slug;
    assert.deepEqual(canonical(h), [url], slug + ': canonical');
    assert.deepEqual(meta(h, 'og:url'), [url], slug + ': social canonical');
    assert.match(meta(h, 'robots')[0], /index, follow/);
    assert.equal(meta(h, 'og:image').length, 1, slug + ': one share image');
    assert.deepEqual(meta(h, 'og:image:secure_url'), meta(h, 'og:image'));
    for (const tag of ['og:type', 'og:site_name', 'og:locale', 'og:image:type',
      'og:image:alt', 'twitter:card', 'twitter:title', 'twitter:description',
      'twitter:image', 'twitter:image:alt', 'twitter:site']) {
      assert.equal(meta(h, tag).length, 1, slug + ': expected one ' + tag);
      assert.ok(meta(h, tag)[0], slug + ': empty ' + tag);
    }
    const graph = jsonLd(h)['@graph'];
    assert.ok(Array.isArray(graph) && graph.length >= 4);
    assert.equal(graph.find(x => x['@type'] === 'Organization')['@id'],
      ORIGIN + '/#organization');
    assert.equal(graph.find(x => x['@type'] === 'WebSite')['@id'],
      ORIGIN + '/#website');
    assert.equal(graph.find(x => x['@type'] === 'WebPage').url, url);
    assert.equal(graph.find(x => x['@type'] === 'BreadcrumbList')['@id'],
      url + '#breadcrumb');
    if (slug === 'download') {
      const app = graph.find(x => x['@type'] === 'MobileApplication');
      assert.equal(app.operatingSystem, 'Android');
      assert.equal(app.offers.price, '0');
    }
    if (slug === 'sautinote') {
      assert.equal(graph.find(x => x['@type'] === 'Brand').name, 'SautiNote');
    }
  }
});

test('translated discovery pages reciprocally declare only valid canonical hreflang targets', async () => {
  for (const slug of TRANSLATIONS) {
    const h = head(await read(slug + '.html'));
    const alternatives = tags(h, 'link').filter(t => attribute(t, 'rel') === 'alternate');
    assert.equal(alternatives.length, TRANSLATIONS.length);
    for (const lang of TRANSLATIONS) {
      assert.equal(alternatives.filter(t => attribute(t, 'hreflang') === lang &&
        attribute(t, 'href') === ORIGIN + '/' + lang).length, 1);
    }
  }
  const alias = head(await read('no.html'));
  assert.deepEqual(canonical(alias), [ORIGIN + '/nb']);
  assert.deepEqual(meta(alias, 'og:url'), [ORIGIN + '/nb']);
  assert.equal(tags(alias, 'link').filter(t => attribute(t, 'rel') === 'alternate').length, 0);
});

test('the account-entry root stays noindex and avoids changing the sign-in UX', async () => {
  const html = await read('index.html');
  const h = head(html);
  assert.deepEqual(canonical(h), [ORIGIN + '/']);
  assert.match(meta(h, 'robots')[0], /noindex, follow/);
  assert.deepEqual(meta(h, 'og:url'), [ORIGIN + '/']);
  assert.equal(jsonLd(h)['@graph'].find(x => x['@type'] === 'WebSite').url, ORIGIN + '/');
  assert.match(html, /data-sautilink-entry="account-choice"/);
  assert.match(html, /href="\/login"/);
  assert.match(html, /href="\/signup"/);
});

test('static sitemap enumerates canonical public pages without duplicates or nonindexable aliases', async () => {
  const sitemap = await read('sitemap-static.xml');
  const urls = [...sitemap.matchAll(/<loc>(https:\/\/sautilink\.com\/[^<]+)<\/loc>/g)]
    .map(match => match[1]);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.includes(ORIGIN + '/download'));
  assert.ok(urls.includes(ORIGIN + '/nb'));
  assert.ok(urls.includes(ORIGIN + '/sw'));
  assert.ok(urls.includes(ORIGIN + '/fr'));
  assert.ok(urls.includes(ORIGIN + '/es'));
  assert.ok(!urls.includes(ORIGIN + '/no'));
  assert.ok(!urls.includes(ORIGIN + '/'));
  for (const slug of EDITED.filter(s => s !== 'no')) {
    assert.match(sitemap, new RegExp('https://sautilink\\.com/' + slug + '</loc><lastmod>2026-11-08</lastmod>'));
  }
});
