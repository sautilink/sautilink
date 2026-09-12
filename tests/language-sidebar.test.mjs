import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sidebarSource = await readFile(new URL('../src/language-sidebar.js', import.meta.url), 'utf8');
const buildSource = await readFile(new URL('../scripts/build-app.mjs', import.meta.url), 'utf8');
const serviceWorkerSource = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

test('language preference is exposed as a first-class sidebar entry', () => {
  assert.match(sidebarSource, /data-language-preference-nav/);
  assert.match(sidebarSource, /\.app-nav/);
  assert.match(sidebarSource, /data-member-view=\\"settings\\"/);
  assert.match(sidebarSource, /insertAdjacentElement\('afterend', button\)/);
});

test('language sidebar opens the existing Settings language panel without changing app routing', () => {
  assert.match(sidebarSource, /settingsNav\.click\(\)/);
  assert.match(sidebarSource, /data-settings-section=\\"language\\"/);
  assert.match(sidebarSource, /languageTab\.click\(\)/);
  assert.doesNotMatch(sidebarSource, /supabase/i);
  assert.doesNotMatch(sidebarSource, /\bfetch\s*\(/);
});

test('language sidebar stays in sync with the selected interface language', () => {
  assert.match(sidebarSource, /sautilink:languagechange/);
  assert.match(sidebarSource, /translateSystemText\('Language'/);
  assert.match(sidebarSource, /translateSystemText\('Language preference'/);
});

test('production app bundle includes the language sidebar entry', () => {
  assert.match(buildSource, /src\/language-sidebar\.js/);
});

test('service worker refreshes the app shell for the language sidebar release', () => {
  assert.match(serviceWorkerSource, /sautilink-shell-v51/);
  assert.match(serviceWorkerSource, /20260912-language-sidebar1/);
  assert.match(serviceWorkerSource, /fetch\(event\.request, \{ cache: "reload" \}\)/);
});
