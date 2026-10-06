import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Upload Guidelines publish the live SautiLink limits in one provider-neutral page', async () => {
  const page = await read('upload-guidelines.html');

  assert.match(page, /Effective<\/strong> October 6, 2026/);
  assert.match(page, /100 MB per file/);
  assert.match(page, /60 seconds or shorter/);
  assert.match(page, /no longer than <strong>2 minutes<\/strong>/);
  assert.match(page, /8 MB per image/);
  assert.match(page, /up to <strong>5 media items<\/strong>/);
  assert.match(page, /Profile photos are limited to <strong>5 MB<\/strong>/);
  assert.match(page, /Profile header images are limited to <strong>8 MB<\/strong>/);
  assert.match(page, /no larger than <strong>10 MB<\/strong>.*600 × 200/s);
  assert.match(page, /Message attachments are limited to <strong>5 MB per file<\/strong>/);
  assert.match(page, /Voice notes are limited to <strong>5 MB<\/strong> and <strong>5 minutes<\/strong>/);
  assert.match(page, /1,000 characters per attachment/);
  assert.match(page, /Ivy Network PLC/);
  assert.doesNotMatch(page, /Supabase|Cloudflare|Google|Facebook|Microsoft|TikTok|third-party/i);
  assert.match(page, /href="\/terms"/);
  assert.match(page, /href="\/privacy"/);
});

test('Terms, Help, app sidebar and mobile drawer link to Upload Guidelines', async () => {
  const [terms, help, app, drawer] = await Promise.all([
    read('terms.html'),
    read('help.html'),
    read('app/index.html'),
    read('src/mobile-more-drawer.js'),
  ]);

  for (const source of [terms, help, app, drawer]) {
    assert.match(source, /\/upload-guidelines/);
  }
});
