import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('preview-src/font-lab/index.html');
const css = read('preview-src/font-lab/font-lab.css');
const js = read('preview-src/font-lab/font-lab.js');
const stage = read('scripts/stage-preview-site.mjs');

test('font lab is a staging-only screen with source isolation', () => {
  assert.match(stage, /\['preview-src\/font-lab', 'preview\/font-lab'\]/);
  assert.ok(stage.includes('href="/preview/font-lab/"'), 'missing staging homepage shortcut');
  const htmlPath = new URL('../dist-preview-site/preview/font-lab/index.html', import.meta.url);
  const cssPath = new URL('../dist-preview-site/preview/font-lab/font-lab.css', import.meta.url);
  const jsPath = new URL('../dist-preview-site/preview/font-lab/font-lab.js', import.meta.url);
  for (const path of [htmlPath,cssPath,jsPath]) assert.equal(existsSync(path), true, 'missing staged preview file');
  assert.equal(readFileSync(htmlPath, 'utf8'), html);
  assert.equal(readFileSync(cssPath, 'utf8'), css);
  assert.equal(readFileSync(jsPath, 'utf8'), js);
  assert.equal(existsSync(new URL('../dist-production-site/preview/font-lab/index.html', import.meta.url)), false,
    'private font lab must never be bundled into production release');
});

test('font lab cannot index, sign in or send account data', () => {
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
  const headers = read('dist-preview-site/_headers');
  assert.match(headers, /\/preview\/font-lab\/\*/);
  assert.match(headers, /style-src 'self' https:\/\/fonts\.googleapis\.com/);
  assert.match(headers, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /form-action 'none'/);
  assert.match(headers, /script-src 'self'/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(html, /href="\/assets\/brand\/system.css"/);
  assert.match(html, /href="\/assets\/fonts\/inter\/InterVariable.woff2"/);
  assert.doesNotMatch(js, /fetch\(|localStorage|sessionStorage|document\.cookie|supabase|Authorization|eval\(/);
  assert.doesNotMatch(html, /<form\b/i);
  for (const screen of ['home','profile','messages','login','settings']) {
    assert.match(html, new RegExp('data-screen="' + screen + '"'));
    assert.match(html, new RegExp('data-screen-tab="' + screen + '"'));
  }
});

test('font controls are functional and comparison uses real font families', () => {
  for (const key of ['inter','flex','compare']) assert.match(html, new RegExp('data-font="' + key + '"'));
  for (const key of ['light','dark']) assert.match(html, new RegExp('data-theme="' + key + '"'));
  for (const key of ['desktop','mobile']) assert.match(html, new RegExp('data-device="' + key + '"'));
  assert.match(js, /grid\.replaceChildren\(\.\.\.surfaces\)/);
  assert.match(js, /aria-pressed/);
  assert.match(js, /document\.fonts\.load/);
  assert.match(css, /Google\+Sans\+Flex:wght@100\.\.900/);
  assert.match(css, /--font-primary: "Google Sans Flex"/);
  assert.match(css, /--font-primary: "Inter"/);
  assert.match(css, /font-family: var\(--font-primary\) !important/);
  const canonicalBrand = read('assets/brand/system.css');
  assert.match(canonicalBrand, /Inter is the only UI\/brand font family/);
});
