import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('profile X-style layer is isolated to the profile surface', async () => {
  const source = await read('src/profile-x-ui.js');
  assert.match(source, /document\.getElementById\('profile-surface'\)/);
  assert.match(source, /\.profile-surface \.profile-card/);
  assert.match(source, /\.profile-surface \.profile-banner/);
  assert.match(source, /\.profile-surface \.profile-avatar-shell/);
  assert.match(source, /\.profile-surface \.profile-social-stats/);
  assert.match(source, /\.profile-surface \.profile-activity-tabs/);
  assert.match(source, /\.profile-surface \.profile-activity-card/);
  assert.match(source, /data\.profilePresentation = 'x-style'/);
  assert.doesNotMatch(source, /MutationObserver/);
  assert.doesNotMatch(source, /supabase|fetch\(|localStorage|sessionStorage/i);
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
  assert.doesNotMatch(source, /innerHTML\s*=|remove\(|replaceChildren\(|appendChild\([^s]/);
});

test('regular and production builds include the profile presentation layer', async () => {
  const regular = await read('scripts/build-app.mjs');
  const production = await read('scripts/build-production-release.mjs');
  assert.match(regular, /src\/profile-x-ui\.js/);
  assert.match(production, /profile-x-ui\.js/);
});

test('profile presentation keeps desktop and mobile X-style hierarchy', async () => {
  const source = await read('src/profile-x-ui.js');
  assert.match(source, /height: 200px/);
  assert.match(source, /width: 142px/);
  assert.match(source, /border-radius: 999px/);
  assert.match(source, /profile-social-stats > span:first-child \{ order: 2; \}/);
  assert.match(source, /profile-activity-tab\[aria-selected="true"\]::after/);
  assert.match(source, /@media \(max-width: 680px\)/);
  assert.match(source, /width: 104px/);
  assert.match(source, /@media \(max-width: 420px\)/);
});
