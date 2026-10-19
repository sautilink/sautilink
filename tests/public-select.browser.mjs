import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(process.argv[3] ? resolve(process.argv[3], '_audit.cjs') : import.meta.url);
const { chromium } = require('playwright');
const here = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../assets/', import.meta.url));
const iconRuntime = process.argv[5] ? resolve(process.argv[5]) : resolve(here, 'public-icons/icons.js');
const countries = Array.from({ length: 24 }, (_, i) => `<option value="C${i + 1}">Country ${String(i + 1).padStart(2, '0')}</option>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/public-select.css"><link rel="stylesheet" href="/fixture.css"><script defer src="/icons.js"></script><script defer src="/public-select.js"></script></head><body data-public-selects data-public-icons>
<form id="form"><label for="name">Name</label><input id="name" name="name" required><label id="topic-label" for="topic">Topic</label><select id="topic" name="topic" required><option value="" disabled selected>Choose a topic</option><option value="general">General</option><option value="partner">Partnership</option><option value="a&amp;b">Special &amp; exact</option><optgroup label="Unavailable" disabled><option value="staff">Staff</option></optgroup><option value="hidden" hidden>Hidden</option></select>
<label id="country-label"><strong>Country</strong><select id="country" name="country">${countries}<option value="CI">Côte d’Ivoire</option><option value="JP">Japan</option><option value="CH">Switzerland</option><option value="TZ">Tanzania</option></select></label>
<select id="disabled" name="disabled" disabled><option value="off">Off</option></select><button type="reset">Reset form</button><button type="submit">Submit</button><input id="after" aria-label="After"></form>
<div data-public-select-skip><select id="skipped"><option>Native skipped</option></select></div><div class="spacer"></div></body></html>`;
const css = `*{box-sizing:border-box}body{font:16px Arial;margin:0;padding:30px 20px}form{max-width:360px}label{display:block;margin:16px 0 7px}input{min-height:44px;width:100%}button{margin-top:8px}.spacer{height:1600px}`;
const server = createServer(async (req, res) => {
  let body, type;
  if (req.url === '/public-select.js' || req.url === '/public-select.css') { body = await readFile(resolve(here, req.url.slice(1))); type = req.url.endsWith('.js') ? 'text/javascript' : 'text/css'; }
  else if (req.url === '/icons.js') { body = await readFile(iconRuntime).catch(() => Buffer.from('/* Optional icon library unavailable; static SVG fallback is exercised. */')); type = 'text/javascript'; }
  else if (req.url === '/fixture.css') { body = css; type = 'text/css'; }
  else { body = html; type = 'text/html'; }
  res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'" });
  res.end(body);
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.argv[4] ? { executablePath: process.argv[4] } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const result = { origin, pass: [], failures: [], browserErrors: [], cspErrors: [] };
page.on('pageerror', (error) => result.browserErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error' && /Content Security Policy/.test(message.text())) result.cspErrors.push(message.text()); });
const trigger = (id) => page.locator(`#${id}`).locator('..').locator('.sl-select-trigger');
const fresh = async () => { await page.goto(origin); await trigger('topic').waitFor(); };
async function check(name, run) {
  try { await fresh(); await run(); result.pass.push(name); }
  catch (error) { result.failures.push({ name, error: error.message }); }
}

await check('external/wrapping labels activate the built-in menu; pointer choice preserves events and FormData', async () => {
  await page.evaluate(() => { window.events = []; for (const name of ['input', 'change']) document.querySelector('#topic').addEventListener(name, (e) => window.events.push([e.type, e.target.value])); });
  await page.locator('#topic-label').click();
  assert.equal(await trigger('topic').getAttribute('aria-expanded'), 'true');
  await page.getByRole('option', { name: 'General', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.events), [['input', 'general'], ['change', 'general']]);
  assert.equal(await page.evaluate(() => new FormData(document.querySelector('#form')).get('topic')), 'general');
  await page.locator('#country-label strong').click();
  assert.equal(await trigger('country').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.sl-select-search').evaluate((e) => e === document.activeElement), true);
});

await check('silent .value/.selectedIndex, reset, disabled/group/hidden options and exact values', async () => {
  await page.evaluate(() => document.querySelector('#topic').value = 'a&b');
  assert.match(await trigger('topic').textContent(), /Special & exact/);
  assert.equal(await page.evaluate(() => new FormData(document.querySelector('#form')).get('topic')), 'a&b');
  await page.evaluate(() => document.querySelector('#topic').selectedIndex = 2);
  assert.match(await trigger('topic').textContent(), /Partnership/);
  await page.evaluate(() => document.querySelector('#form').reset());
  assert.match(await trigger('topic').textContent(), /Choose a topic/);
  assert.equal(await trigger('disabled').isDisabled(), true);
  await trigger('topic').click();
  assert.equal(await page.getByRole('option', { name: 'Staff', exact: true }).getAttribute('aria-disabled'), 'true');
  assert.equal(await page.getByRole('option', { name: 'Hidden', exact: true }).count(), 0);
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#topic').inputValue(), 'a&b');
});

await check('dynamic options/disabled state update an open popup without changing form behavior', async () => {
  await trigger('topic').click();
  await page.evaluate(() => { const select = document.querySelector('#topic'); select.add(new Option('Added option', 'added')); });
  await page.getByRole('option', { name: 'Added option', exact: true }).waitFor();
  await page.evaluate(() => document.querySelector('#topic').options[2].disabled = true);
  await page.waitForFunction(() => document.querySelector('[role="option"][aria-disabled="true"]')?.textContent.includes('Choose') || [...document.querySelectorAll('[role="option"][aria-disabled="true"]')].some((e) => e.textContent.includes('Partnership')));
  await page.getByRole('option', { name: 'Added option', exact: true }).click();
  assert.equal(await page.locator('#topic').inputValue(), 'added');
  await page.evaluate(() => document.querySelector('#topic').disabled = true);
  await page.waitForFunction(() => document.querySelector('#topic').nextElementSibling.disabled);
});

await check('search country labels/codes, empty state, keyboard commit and Escape focus', async () => {
  await trigger('country').click();
  await page.locator('.sl-select-search').fill('tz');
  assert.equal(await page.locator('.sl-select-menu [role="option"]').count(), 2);
  assert.match(await page.locator('.sl-select-menu [role="option"]').first().textContent(), /Tanzania/);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#country').inputValue(), 'TZ');
  await trigger('country').click();
  await page.locator('.sl-select-search').fill('cote');
  assert.equal(await page.locator('.sl-select-menu [role="option"]').count(), 1);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#country').inputValue(), 'CI');
  await trigger('country').click();
  await page.locator('.sl-select-search').fill('unmatched-country');
  assert.equal(await page.locator('.sl-select-menu [role="option"]').count(), 0);
  assert.equal(await page.locator('.sl-select-empty').isVisible(), true);
  await page.keyboard.press('Enter');
  assert.equal(await trigger('country').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await trigger('country').evaluate((e) => e === document.activeElement), true);
});

await check('scroll remains inside popup and selected-item scrolling does not move the page', async () => {
  await page.evaluate(() => document.querySelector('#country').value = 'TZ');
  const before = await page.evaluate(() => scrollY);
  await trigger('country').click();
  assert.equal(await page.evaluate(() => scrollY), before);
  const popup = page.locator('.sl-select-menu');
  const scroll = await popup.evaluate((e) => e.scrollTop);
  assert.ok(scroll > 0);
  await popup.evaluate((e) => { e.scrollTop -= 100; });
  assert.equal(await page.evaluate(() => scrollY), before);
  assert.equal(await trigger('country').getAttribute('aria-expanded'), 'true');
  const bounds = await popup.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844);
});

await check('Tab from popup search advances from the original field position', async () => {
  await trigger('country').click();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('type')), 'reset', await page.evaluate(() => document.activeElement.outerHTML.slice(0, 200)));
});

await check('Shift+Tab from popup search returns to the previous original field', async () => {
  await trigger('country').click();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.previousElementSibling?.id), 'topic', await page.evaluate(() => document.activeElement.outerHTML.slice(0, 200)));
});

await check('invalid earlier text field keeps normal first-invalid focus priority', async () => {
  await page.evaluate(() => document.querySelector('#form').reportValidity());
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'name');
});

await check('IME composing Enter does not commit a search result', async () => {
  await trigger('country').click();
  await page.locator('.sl-select-search').fill('Japan');
  await page.locator('.sl-select-search').evaluate((e) => e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
  assert.equal(await page.locator('#country').inputValue(), 'C1');
  assert.equal(await trigger('country').getAttribute('aria-expanded'), 'true');
});

await check('explicit refresh reflects batched native option.selected mutation', async () => {
  await page.evaluate(() => { document.querySelector('#topic').options[2].selected = true; window.SautiPublicSelects.refresh(); });
  await page.waitForTimeout(30);
  assert.match(await trigger('topic').textContent(), /Partnership/);
});

await check('dynamic label text updates the combobox accessible name', async () => {
  await page.locator('#topic-label').evaluate((e) => e.textContent = 'Reason for contact');
  await page.waitForTimeout(30);
  assert.match(await trigger('topic').getAttribute('aria-label'), /^Reason for contact:/);
});

const noJs = await browser.newContext({ javaScriptEnabled: false });
const native = await noJs.newPage();
await native.goto(origin);
assert.equal(await native.locator('select:visible').count(), 4);
assert.equal(await native.locator('[data-sl-native-select]').count(), 0);
result.pass.push('No-JS native-select fallback remains visible');
await noJs.close();
await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
if (process.env.PUBLIC_SELECT_AUDIT_REPORT) await writeFile(resolve(process.env.PUBLIC_SELECT_AUDIT_REPORT), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (result.failures.length || result.browserErrors.length || result.cspErrors.length) process.exitCode = 1;
