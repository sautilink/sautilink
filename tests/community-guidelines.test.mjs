import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Community Guidelines preserve expression while enforcing strict political and regional safety boundaries', async () => {
  const page = await read('community-guidelines.html');

  assert.match(page, /<title>Community Guidelines — SautiLink<\/title>/);
  assert.match(page, /canonical" href="https:\/\/sautilink\.com\/community-guidelines"/);
  assert.match(page, /Your voice is welcome\. Harm is not\./);
  assert.match(page, /Opinion is not a violation/);
  assert.match(page, /We moderate conduct and risk, not political loyalty/);
  assert.match(page, /Political and regional discussion receives stricter safety review/);
  assert.match(page, /supporting or opposing a candidate, party, policy, government decision or political movement/);
  assert.match(page, /credible threats, instructions or encouragement to attack political opponents/);
  assert.match(page, /false dates, locations, eligibility instructions or fabricated government notices/);
  assert.match(page, /coordinated fake-account activity/);
  assert.match(page, /calling for exclusion, expulsion, collective punishment, segregation, dehumanization or violence/);
});

test('Community Guidelines cover current SautiLink product safety areas and official destinations', async () => {
  const page = await read('community-guidelines.html');

  for (const anchor of [
    'violence',
    'hate-harassment',
    'identity',
    'integrity',
    'privacy',
    'children-sexual',
    'self-harm',
    'cyber-illegal',
    'ip',
    'features',
    'uploads',
    'moderation',
    'report-appeal',
  ]) {
    assert.match(page, new RegExp(`id="${anchor}"`));
  }

  for (const href of [
    '/verify',
    '/settings',
    '/appeals',
    '/help#reporting',
    '/upload-guidelines',
    '/privacy',
    '/terms',
    '/account-deletion',
    '/rooms',
    '/messages',
  ]) {
    assert.match(page, new RegExp(`href="${href.replace(/[.*+?^$()|[\\]{}]/g, '\\\\$&')}"`));
  }

  assert.match(page, /How do I get verified on SautiLink\?/);
  assert.match(page, /How do I report content on SautiLink\?/);
  assert.match(page, /How do I appeal a moderation decision\?/);
  assert.doesNotMatch(page, /Supabase|Cloudflare|Google|Facebook|Microsoft|TikTok/i);
});

test('Help Centre exposes stable anchors for reporting, verification and appeals', async () => {
  const help = await read('help.html');

  assert.match(help, /id="reporting"/);
  assert.match(help, /id="verification"/);
  assert.match(help, /id="appeals"/);
  assert.match(help, /href="\/verify"/);
  assert.match(help, /href="\/settings"/);
  assert.match(help, /href="\/appeals"/);
});

test('Terms and app navigation expose the Community Guidelines', async () => {
  const [terms, app, drawer, sitemap] = await Promise.all([
    read('terms.html'),
    read('app/index.html'),
    read('src/mobile-more-drawer.js'),
    read('sitemap-static.xml'),
  ]);

  assert.match(terms, /href="\/community-guidelines"/);
  assert.match(app, /href="\/community-guidelines"/);
  assert.match(drawer, /href="\/community-guidelines"/);
  assert.match(sitemap, /https:\/\/sautilink\.com\/community-guidelines/);
  assert.match(sitemap, /https:\/\/sautilink\.com\/verify/);
});
