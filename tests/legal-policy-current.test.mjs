import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Privacy Policy describes the live SautiLink product rather than pre-launch plans', async () => {
  const privacy = await read('privacy.html');

  assert.match(privacy, /Effective<\/strong> October 20, 2026/);
  assert.match(privacy, /Account deletion is available now/);
  assert.match(privacy, /Direct messages are private from the public/);
  assert.match(privacy, /Private Rooms/);
  assert.match(privacy, /supported connected-account sign-in method/);
  assert.match(privacy, /Ivy Network PLC/);
  assert.match(privacy, /https:\/\/www\.ivynetwork\.co\.uk\//);
  assert.match(privacy, /Our Android app uses Google Play Integrity/);
  assert.match(privacy, /Results expire after 30 days/);
  assert.doesNotMatch(privacy, /pre-launch/i);
  assert.doesNotMatch(privacy, /when accounts launch/i);
  assert.doesNotMatch(privacy, /future SautiLink accounts/i);
});

test('Terms cover current Rooms, identity, moderation and platform safety', async () => {
  const [terms, privacy] = await Promise.all([read('terms.html'), read('privacy.html')]);

  assert.match(terms, /Effective<\/strong> October 20, 2026/);
  assert.match(terms, /SautiLink calls its group-style community spaces <strong>Rooms<\/strong>/);
  assert.match(terms, /verification badge or other identity signal/i);
  assert.match(terms, /Moderation, visibility actions and appeals/);
  assert.match(terms, /Unauthorized scraping or interference/);
  assert.match(terms, /United Republic of Tanzania/);
  assert.match(terms, /Ivy Network PLC/);
  assert.match(terms, /All SautiLink services are free\./);
  assert.match(terms, /does not charge platform service fees/i);
  assert.match(terms, /does not charge sales commissions/i);
  assert.match(terms, /Marketplace product listings are separate from advertisements/i);
  assert.match(terms, /does not currently offer an advertising service/i);
  assert.doesNotMatch(terms, /optional paid features/i);
  assert.match(terms, /href="\/merchant-policies"/);
  assert.match(terms, /href="\/upload-guidelines"/);
  assert.doesNotMatch(terms, /pre-launch/i);
  assert.doesNotMatch(terms, /when those features launch/i);
  // Privacy now discloses Play Integrity processing; Terms remain vendor-neutral.
  assert.doesNotMatch(privacy, /Supabase|Cloudflare|Facebook|Microsoft|TikTok/i);
  assert.doesNotMatch(terms, /Supabase|Cloudflare|Google|Facebook|Microsoft|TikTok/i);
});

test('Privacy and Terms use the scoped document-first legal layout', async () => {
  const [privacy, terms, css] = await Promise.all([
    read('privacy.html'),
    read('terms.html'),
    read('assets/legal-policy.css'),
  ]);

  for (const page of [privacy, terms]) {
    assert.match(page, /class="legal-page legal-policy-page"/);
    assert.match(page, /\/assets\/legal-policy\.css\?v=20260909-1/);
    assert.match(page, /\/assets\/legal\.js/);
  }

  assert.match(css, /body\.legal-policy-page \.legal-section/);
  assert.match(css, /body\.legal-policy-page \.legal-toc/);
  assert.match(css, /@media \(max-width: 840px\)/);
});
