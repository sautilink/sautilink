import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('desktop sidebar exposes legal, contact and first-party system links', async () => {
  const html = await read('app/index.html');
  const rail = html.match(/<aside class="primary-rail"[\s\S]*?<\/aside>/)?.[0] || '';

  assert.match(rail, /href="\/terms"[\s\S]*?<span>Terms of Service<\/span>/);
  assert.match(rail, /href="\/contact"[\s\S]*?<span>Contact<\/span>/);
  assert.match(rail, /id="primary-rail-systems-title">Other SautiLink Systems<\/p>/);
  assert.match(rail, /href="https:\/\/cloudengine\.sautilink\.com" target="_blank" rel="noopener noreferrer"[\s\S]*?<span>Cloud Engine<\/span>/);
  assert.match(rail, /href="https:\/\/router\.sautilink\.com" target="_blank" rel="noopener noreferrer"[\s\S]*?<span>Router Setup Gateway<\/span>/);

  const termsAt = rail.indexOf('Terms of Service');
  const contactAt = rail.indexOf('>Contact<');
  const systemsAt = rail.indexOf('Other SautiLink Systems');
  const cloudAt = rail.indexOf('>Cloud Engine<');
  const routerAt = rail.indexOf('>Router Setup Gateway<');
  assert.ok(termsAt < contactAt && contactAt < systemsAt && systemsAt < cloudAt && cloudAt < routerAt);
});

test('desktop sidebar keeps long navigation usable without changing mobile navigation', async () => {
  const [html, css] = await Promise.all([
    read('app/index.html'),
    read('app/assets/app.css'),
  ]);

  assert.match(html, /<div class="primary-rail-scroll">/);
  assert.match(css, /\.primary-rail-scroll\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1 1 auto;[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.rail-account\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(css, /@media \(max-width: 1080px\)[\s\S]*\.primary-rail-section-title\s*\{\s*display:\s*none;/);
  assert.equal((html.match(/class="mobile-nav-icon"/g) || []).length, 6);
});
