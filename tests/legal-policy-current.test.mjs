import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Privacy Policy describes the live SautiLink product rather than pre-launch plans', async () => {
  const privacy = await read('privacy.html');

  assert.match(privacy, /Effective<\/strong> September 9, 2026/);
  assert.match(privacy, /Account deletion is available now/);
  assert.match(privacy, /Direct messages are private from the public/);
  assert.match(privacy, /Private Rooms/);
  assert.match(privacy, /Google, Facebook or Microsoft sign-in/);
  assert.match(privacy, /Supabase/);
  assert.match(privacy, /Cloudflare/);
  assert.match(privacy, /Ivy Network PLC/);
  assert.match(privacy, /https:\/\/www\.ivynetwork\.co\.uk\//);
  assert.doesNotMatch(privacy, /pre-launch/i);
  assert.doesNotMatch(privacy, /when accounts launch/i);
  assert.doesNotMatch(privacy, /future SautiLink accounts/i);
});

test('Terms cover current Rooms, identity, moderation and platform safety', async () => {
  const terms = await read('terms.html');

  assert.match(terms, /Effective<\/strong> September 9, 2026/);
  assert.match(terms, /SautiLink calls its group-style community spaces <strong>Rooms<\/strong>/);
  assert.match(terms, /verification badge or other identity signal/i);
  assert.match(terms, /Moderation, visibility actions and appeals/);
  assert.match(terms, /Unauthorized scraping or interference/);
  assert.match(terms, /United Republic of Tanzania/);
  assert.match(terms, /Ivy Network PLC/);
  assert.match(terms, /optional paid features/i);
  assert.doesNotMatch(terms, /pre-launch/i);
  assert.doesNotMatch(terms, /when those features launch/i);
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
