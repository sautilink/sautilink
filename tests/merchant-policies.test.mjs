import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const canonical = 'https://sautilink.com/merchant-policies';
const publicPages = [
  'about.html', 'help.html', 'contact.html', 'verify.html', 'privacy.html',
  'terms.html', 'community-guidelines.html', 'upload-guidelines.html',
  'account-deletion.html', 'sautinote.html', 'merchant-policies.html',
];
const policySections = [
  'eligibility', 'business-verification', 'small-entrepreneurs', 'fees-and-ads',
  'merchant-status', 'listings', 'prohibited', 'customers', 'information',
  'enforcement', 'updates-contact',
];

function openings(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))].map(([value]) => value);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
}

function sectionText(html, id) {
  const section = html.match(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/section>`))?.[1];
  assert.ok(section, `missing policy section ${id}`);
  return section.replace(/<svg\b[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('Merchant Policies is an indexable public document with its own canonical metadata', () => {
  const html = read('merchant-policies.html');
  assert.match(html, /<html\b[^>]*\blang="en"/);
  assert.match(html, /<title>Merchant Policies\s*[—–-]\s*SautiLink<\/title>/);
  assert.equal(openings(html, 'h1').length, 1, 'one primary document heading');
  assert.ok(openings(html, 'meta').some((tag) => attribute(tag, 'name') === 'description' && attribute(tag, 'content')?.length > 40));
  assert.ok(openings(html, 'link').some((tag) => attribute(tag, 'rel') === 'canonical' && attribute(tag, 'href') === canonical));
  assert.ok(openings(html, 'meta').some((tag) => attribute(tag, 'property') === 'og:url' && attribute(tag, 'content') === canonical));
  for (const tag of openings(html, 'meta').filter((tag) => /^(robots|googlebot)$/i.test(attribute(tag, 'name') || ''))) {
    assert.doesNotMatch(attribute(tag, 'content') || '', /noindex/i);
  }
  assert.doesNotMatch(html, /pre-launch|join the waitlist|when accounts launch|has not launched public social accounts/i);
  assert.match(html, /<body\b[^>]*\bdata-public-design\b[^>]*\bdata-public-icons\b/);
  assert.match(html, /<main\b[\s\S]*?<\/main>/);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["'][^"']*\/(?:app|src)\//i);
});

test('Merchant eligibility preserves both business certification and the small-entrepreneur exception', () => {
  const html = read('merchant-policies.html');
  const eligibility = sectionText(html, 'eligibility');
  const business = sectionText(html, 'business-verification');
  const small = sectionText(html, 'small-entrepreneurs');

  assert.match(eligibility, /available only in the SautiLink app/i);
  assert.match(eligibility, /businesses and companies must be verified and certified by SautiLink Corporation before they can sell/i);
  assert.match(eligibility, /unverified.*not permitted to list or sell/i);
  assert.match(eligibility, /Room name or category.*does not grant merchant status/i);

  for (const requirement of [/business or company name/i, /physical business location/i, /contact phone number/i, /Taxpayer Identification Number/i, /TIN/, /VAT/, /BRELA/, /business licence/i]) {
    assert.match(business, requirement);
  }
  assert.match(business, /VAT details are optional/i);
  assert.match(business, /TIN does not replace a required business licence/i);
  assert.match(business, /SautiLink visits the stated business location/i);
  assert.match(business, /special merchant verification checkmark/i);
  assert.match(business, /platform merchant certificate/i);
  assert.match(business, /no guaranteed approval or fixed review time/i);

  assert.match(small, /small or startup entrepreneurs without their own office/i);
  assert.match(small, /normal blue tick verification process/i);
  assert.match(small, /Settings\s*→\s*Account\s*→\s*Verification/);
  assert.match(small, /do not need to present an office for the business-site visit/i);
  assert.match(small, /not represented as a SautiLink-certified company.*standard blue tick/i);
  assert.match(small, /not an exemption from laws, tax obligations, product-safety duties/i);
});

test('Merchant pricing distinguishes free platform services, product prices and advertising', () => {
  const html = read('merchant-policies.html');
  const fees = sectionText(html, 'fees-and-ads');
  assert.match(fees, /All SautiLink services are free\./);
  assert.match(fees, /charges no registration, application, verification, site-visit, certification, merchant-checkmark, Marketplace-access or listing fees, and no sales commission/i);
  assert.match(fees, /Do not pay anyone.*approve, accelerate or maintain your verification/i);
  assert.match(fees, /Marketplace product listings are separate from advertisements/i);
  assert.match(fees, /does not currently offer an advertising service/i);
  assert.match(fees, /not a purchased advertisement, paid placement or paid boost/i);
  assert.match(fees, /do not mean that merchants.*products are free/i);
  assert.doesNotMatch(html, /optional paid features|join the waitlist/i);
});

test('Merchant rules preserve honest listings, consumer obligations, privacy and a review route', () => {
  const html = read('merchant-policies.html');
  const status = sectionText(html, 'merchant-status');
  const listings = sectionText(html, 'listings');
  const prohibited = sectionText(html, 'prohibited');
  const customers = sectionText(html, 'customers');
  const information = sectionText(html, 'information');
  const enforcement = sectionText(html, 'enforcement');

  assert.match(status, /do not replace government registration.*business licence/i);
  assert.match(status, /not a guarantee of every product, transaction, delivery, refund/i);
  assert.match(listings, /price, condition, availability, material defects/i);
  assert.match(listings, /only material you own, have permission to use or otherwise have a lawful basis to share/i);
  assert.match(prohibited, /illegal, stolen, counterfeit, recalled or unsafe products/i);
  assert.match(prohibited, /Verification does not make a prohibited product permissible/i);
  for (const obligation of [/taxes/i, /product safety/i, /cancellation, return, refund and warranty terms/i, /mandatory consumer rights/i]) {
    assert.match(customers, obligation);
  }
  assert.match(customers, /do not make SautiLink the seller.*or a guarantor/i);
  assert.match(information, /TIN, optional VAT details/i);
  assert.match(information, /business-site visit/i);
  assert.match(information, /Do not put identity documents, tax documents or other private verification evidence in public listings/i);
  assert.match(information, /Do not sell customer data/i);
  assert.match(information, /Privacy requests and questions can be sent to support@sautilink\.com/);
  assert.match(html, /href="\/privacy"/);
  assert.match(enforcement, /remove listings, restrict selling access, withdraw a merchant certificate or checkmark/i);
  assert.match(enforcement, /request review of a merchant-verification or certification decision/i);
  assert.match(enforcement, /support@sautilink\.com/);
  assert.match(sectionText(html, 'updates-contact'), /October 20, 2026/);
});

test('Privacy disclosure explains merchant evidence without making private applications public', () => {
  const privacy = read('privacy.html').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(privacy, /merchant verification information/i);
  assert.match(privacy, /business name, physical location, contact phone number, Taxpayer Identification Number \(TIN\), optional VAT information/i);
  assert.match(privacy, /registration and licensing documents/i);
  assert.match(privacy, /findings from a business-site visit/i);
  assert.match(privacy, /Private application evidence is different from business information you choose to publish/i);
  assert.match(read('privacy.html'), /href="\/merchant-policies#information"/);
});

test('Merchant Policies navigation reaches unique document targets without JavaScript', () => {
  const html = read('merchant-policies.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
  const uniqueIds = new Set(ids);
  assert.equal(ids.length, uniqueIds.size, 'document IDs must be unique');

  const anchors = openings(html, 'a');
  const contents = anchors.filter((tag) => /\bdata-toc-link\b/.test(tag));
  assert.ok(contents.length >= 6, 'a policy-length document needs navigable contents');
  assert.equal(new Set(contents.map((tag) => attribute(tag, 'href'))).size, contents.length, 'contents links must lead to distinct sections');
  for (const id of policySections) {
    assert.ok(uniqueIds.has(id), `missing policy section ${id}`);
    assert.equal(contents.filter((tag) => attribute(tag, 'href') === `#${id}`).length, 1, `contents must expose ${id}`);
  }
  for (const tag of anchors) {
    const href = attribute(tag, 'href');
    if (!href?.startsWith('#')) continue;
    assert.ok(href.length > 1, 'fragment links must name a target');
    assert.ok(uniqueIds.has(decodeURIComponent(href.slice(1))), `missing target for ${href}`);
  }
  const skip = anchors.find((tag) => /\bskip-link\b/.test(attribute(tag, 'class') || ''));
  assert.ok(skip, 'keyboard users need a skip link');
  assert.ok(attribute(skip, 'href')?.startsWith('#'), 'skip link must reach the document');
  for (const tag of [...openings(html, 'button'), ...openings(html, 'nav')]) {
    for (const name of ['aria-controls', 'aria-labelledby']) {
      const referencedIds = attribute(tag, name)?.split(/\s+/).filter(Boolean) || [];
      for (const id of referencedIds) assert.ok(uniqueIds.has(id), `${name} points to missing ${id}`);
    }
  }
});

test('Merchant Policies uses available public icons with decorative accessibility semantics', () => {
  const html = read('merchant-policies.html');
  const catalog = new Set(JSON.parse(read('assets/public-icons/manifest.json')).names);
  const icons = openings(html, 'svg').filter((tag) => attribute(tag, 'data-public-icon'));
  assert.ok(icons.length > 0, 'public page icons must be present');
  for (const tag of icons) {
    const name = attribute(tag, 'data-public-icon');
    assert.ok(catalog.has(name), `icon ${name} is absent from the installed public icon catalog`);
    assert.equal(attribute(tag, 'aria-hidden'), 'true', `${name} should not duplicate adjacent text`);
    assert.equal(attribute(tag, 'focusable'), 'false', `${name} must not add a keyboard stop`);
  }
});

test('Merchant Policies resources are self-hosted and available in the static asset tree', () => {
  const html = read('merchant-policies.html');
  const resources = [
    ...openings(html, 'script').map((tag) => attribute(tag, 'src')),
    ...openings(html, 'img').map((tag) => attribute(tag, 'src')),
    ...openings(html, 'link')
      .filter((tag) => /^(stylesheet|preload|icon|shortcut icon|apple-touch-icon)$/i.test(attribute(tag, 'rel') || ''))
      .map((tag) => attribute(tag, 'href')),
  ].filter(Boolean);
  assert.ok(resources.includes('/assets/brand/system.css'), 'canonical brand system must be loaded');
  assert.ok(resources.some((url) => url.startsWith('/assets/public-pages-icons.css')));
  assert.ok(resources.some((url) => url.startsWith('/assets/legal.js')));
  for (const resource of resources) {
    assert.match(resource, /^\/(?!\/)/, `resource must be self-hosted: ${resource}`);
    const path = decodeURIComponent(resource.split(/[?#]/)[0]).slice(1);
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `missing static resource ${resource}`);
  }
});

test('Public legal directories and the static sitemap expose Merchant Policies', () => {
  for (const path of publicPages) {
    const html = read(path);
    const directory = html.match(/<nav\b[^>]*aria-labelledby="footer-legal-title"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(directory, `${path} needs the shared public Legal directory`);
    const links = [...directory.matchAll(/<a\b[^>]*href="\/merchant-policies"[^>]*>[\s\S]*?<\/a>/g)];
    assert.equal(links.length, 1, `${path} must expose one Merchant Policies directory link`);
    assert.match(links[0][0], /data-public-icon="file-0-1"/);
    assert.match(links[0][0], />Merchant Policies<\/a>/);
  }
  const staticSitemap = read('sitemap-static.xml');
  const entries = [...staticSitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)]
    .filter(([, entry]) => entry.includes(`<loc>${canonical}</loc>`));
  assert.equal(entries.length, 1, 'canonical merchant policy URL must appear once');
  assert.match(entries[0][1], /<lastmod>2026-10-20<\/lastmod>/);
  assert.match(read('sitemap.xml'), /<loc>https:\/\/sautilink\.com\/sitemap-static\.xml<\/loc>/);
});
