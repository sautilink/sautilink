import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const downloadPagePath = new URL('../download.html', import.meta.url);
const redirectsPath = new URL('../_redirects', import.meta.url);
const previewPagePath = new URL('../android-app-preview.html', import.meta.url);
const sitemapPath = new URL('../sitemap-static.xml', import.meta.url);

test('Android download page advertises the official Google Play release, not the beta APK', async () => {
  const [downloadPage, redirects, preview, sitemap] = await Promise.all([
    readFile(downloadPagePath, 'utf8'),
    readFile(redirectsPath, 'utf8'),
    readFile(previewPagePath, 'utf8'),
    readFile(sitemapPath, 'utf8'),
  ]);

  const playUrl = 'https://play.google.com/store/apps/details?id=com.sautilink.app';
  assert.match(downloadPage, /<link rel="canonical" href="https:\/\/sautilink\.com\/download">/);
  assert.match(downloadPage, /<meta name="robots" content="index, follow/);
  assert.ok(downloadPage.includes(`href="${playUrl}"`), 'download CTA must link directly to Google Play');
  assert.doesNotMatch(downloadPage, /\b(?:beta|install anyway|play protect|download apk)\b/i);
  assert.match(redirects, /^\/download\/android \/download 301$/m);
  assert.doesNotMatch(redirects, /SautiLink-Android-Beta\.apk/);
  assert.match(preview, /href="\/download">official Android download page<\/a>/);
  assert.match(sitemap, /<loc>https:\/\/sautilink\.com\/download<\/loc><lastmod>2026-11-15<\/lastmod>/);

  const structuredData = downloadPage.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(structuredData, 'official app must have structured data');
  const graph = JSON.parse(structuredData[1])['@graph'];
  const app = graph.find((entry) => entry['@type'] === 'MobileApplication');
  assert.equal(app?.name, 'SautiLink');
  assert.equal(app?.operatingSystem, 'Android');
  assert.equal(app?.applicationCategory, 'SocialNetworkingApplication');
  assert.equal(app?.installUrl, playUrl);
  assert.equal(app?.downloadUrl, playUrl);
  assert.equal(app?.offers?.price, '0');
});
