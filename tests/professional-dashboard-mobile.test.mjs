import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('professional dashboard stays inside the mobile viewport without desktop-width chart overflow', async () => {
  const css = await read('app/assets/professional-dashboard.css');

  assert.match(css, /\.professional-dashboard-surface\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*100%[\s\S]*?min-width:\s*0/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.professional-dashboard-chart\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.professional-dashboard-chart svg\s*\{[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%/);
  assert.doesNotMatch(css, /@media \(max-width: 680px\)[\s\S]*?\.professional-dashboard-chart svg\s*\{[^}]*min-width:\s*620px/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.professional-top-post > div:first-child\s*\{[\s\S]*?width:\s*100%/);
});
