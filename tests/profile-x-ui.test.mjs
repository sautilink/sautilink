import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('profile X-style layer is isolated to the profile surface and CSP-safe', async () => {
  const [source, css] = await Promise.all([
    read('src/profile-x-ui.js'),
    read('app/assets/profile-x-ui.css'),
  ]);

  assert.match(source, /document\.getElementById\('profile-surface'\)/);
  assert.match(source, /document\.createElement\('link'\)/);
  assert.match(source, /link\.rel = 'stylesheet'/);
  assert.match(source, /\/app\/assets\/profile-x-ui\.css\?v=20260910-tabs2/);
  assert.match(source, /surface\.dataset\.profilePresentation = 'x-style'/);
  assert.doesNotMatch(source, /document\.createElement\('style'\)/);
  assert.doesNotMatch(source, /MutationObserver/);
  assert.doesNotMatch(source, /supabase|fetch\(|localStorage|sessionStorage/i);

  for (const selector of [
    '.profile-surface .profile-card',
    '.profile-surface .profile-banner',
    '.profile-surface .profile-avatar-shell',
    '.profile-surface .profile-social-stats',
    '.profile-surface .profile-activity-tabs',
    '.profile-surface .profile-activity-card',
  ]) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('profile presentation preserves existing data/action contracts', async () => {
  const shell = await read('app/index.html');
  const source = await read('src/profile-x-ui.js');
  for (const id of [
    'profile-display-name',
    'profile-username',
    'profile-avatar',
    'profile-avatar-image',
    'profile-header-image',
    'profile-followers-count',
    'profile-following-count',
    'profile-edit-button',
    'profile-follow-button',
  ]) {
    assert.match(shell, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(source, /innerHTML\s*=|remove\(|replaceChildren\(/);
});

test('regular and production builds include the profile presentation loader', async () => {
  const regular = await read('scripts/build-app.mjs');
  const production = await read('scripts/build-production-release.mjs');
  assert.match(regular, /src\/profile-x-ui\.js/);
  assert.match(production, /profile-x-ui\.js/);
});

test('profile stylesheet keeps desktop and mobile X-style hierarchy', async () => {
  const css = await read('app/assets/profile-x-ui.css');
  assert.match(css, /height: 200px/);
  assert.match(css, /width: 142px/);
  assert.match(css, /border-radius: 999px/);
  assert.match(css, /profile-social-stats > span:first-child \{ order: 2; \}/);
  assert.match(css, /profile-activity-tab\[aria-selected="true"\]::after/);
  assert.match(css, /@media \(min-width: 681px\)/);
  assert.match(css, /\.profile-surface \.profile-activity-tab \{\s*min-width: 0;\s*flex: 1 1 0;/s);
  assert.match(css, /\.profile-surface \.profile-activity-tab\[hidden\] \{\s*display: none;/s);
  assert.match(css, /\.profile-surface \.profile-activity-privacy-toggle svg,\s*\.profile-surface \.profile-activity-tab svg/s);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /width: 104px/);
  assert.match(css, /@media \(max-width: 420px\)/);
});
