import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pages = [
  'privacy', 'terms', 'community-guidelines', 'merchant-policies',
  'account-deletion', 'upload-guidelines', 'help', 'contact', 'about', 'verify',
];
const meta = (head, key) => {
  const tags = [...head.matchAll(/<meta\s+[^>]+>/gi)].map(match => match[0]);
  const matches = tags.filter(tag => tag.includes(`name="${key}"`) || tag.includes(`property="${key}"`));
  assert.equal(matches.length, 1, `Expected one ${key} tag`);
  const value = matches[0].match(/content="([^"]*)"/);
  assert.ok(value && value[1], `Empty ${key}`);
  return value[1];
};
const schema = head => {
  const match = head.match(/<script type="application\/ld\+json" data-seo="SEO_METADATA_20261108">([\s\S]*?)<\/script>/);
  assert.ok(match, 'SEO JSON-LD not found');
  return JSON.parse(match[1])['@graph'];
};

test('public legal and support pages expose consistent, crawlable SEO metadata', () => {
  for (const slug of pages) {
    const file = resolve(root, `${slug}.html`);
    const html = readFileSync(file, 'utf8');
    const head = html.split('</head>')[0];
    const canonical = `https://sautilink.com/${slug}`;
    assert.equal([...head.matchAll(/<title>/g)].length, 1, slug);
    assert.equal([...head.matchAll(/rel="canonical"/g)].length, 1, slug);
    assert.ok(head.includes(`rel="canonical" href="${canonical}"`), slug);
    assert.ok(meta(head, 'description'));
    assert.match(meta(head, 'robots'), /^index,\s*follow/);
    assert.equal(meta(head, 'og:url'), canonical);
    assert.equal(meta(head, 'og:type'), 'website');
    assert.equal(meta(head, 'og:locale'), 'en_US');
    assert.equal(meta(head, 'og:site_name'), 'SautiLink');
    assert.ok(meta(head, 'og:title'));
    assert.ok(meta(head, 'og:description'));
    assert.equal(meta(head, 'twitter:card'), 'summary_large_image');
    assert.ok(meta(head, 'twitter:title'));
    assert.ok(meta(head, 'twitter:description'));
    assert.equal(meta(head, 'twitter:site'), '@sautilink');
    const ogImage = meta(head, 'og:image');
    assert.equal(meta(head, 'og:image:secure_url'), ogImage);
    assert.equal(meta(head, 'og:image:type'), 'image/png');
    assert.ok(meta(head, 'og:image:alt'));
    assert.equal(meta(head, 'twitter:image'), ogImage);
    assert.ok(meta(head, 'twitter:image:alt'));
    const imageUrl = new URL(ogImage);
    assert.equal(imageUrl.hostname, 'sautilink.com');
    assert.ok(existsSync(resolve(root, imageUrl.pathname.slice(1))), `Missing share image for ${slug}`);
    const graph = schema(head);
    const webpage = graph.find(node => node['@type'] === 'WebPage');
    const breadcrumbs = graph.find(node => node['@type'] === 'BreadcrumbList');
    const org = graph.find(node => node['@type'] === 'Organization');
    const site = graph.find(node => node['@type'] === 'WebSite');
    assert.equal(webpage.url, canonical);
    assert.equal(webpage.inLanguage, 'en');
    assert.equal(webpage.publisher['@id'], org['@id']);
    assert.equal(webpage.isPartOf['@id'], site['@id']);
    assert.equal(webpage.breadcrumb['@id'], breadcrumbs['@id']);
    assert.equal(breadcrumbs.itemListElement[0].item, 'https://sautilink.com/');
    assert.equal(breadcrumbs.itemListElement[1].item, canonical);
    assert.match(html, /<body\b/);
  }
});
