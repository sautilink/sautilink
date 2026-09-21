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
  assert.match(source, /\/app\/assets\/profile-x-ui\.css\?v=20260918-profile2/);
  assert.match(source, /surface\.dataset\.profilePresentation = 'x-style'/);
  assert.doesNotMatch(source, /document\.createElement\('style'\)/);
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

test('profile presentation guard keeps the approved layout and privacy state after rerenders', async () => {
  const [source, privacyCss] = await Promise.all([
    read('src/profile-x-ui.js'),
    read('app/assets/profile-privacy-visibility.css'),
  ]);

  for (const marker of [
    'function placeProfileStatsBeforeBio()',
    'bio.before(stats);',
    'function hideProfileSettingsShortcut()',
    "document.getElementById('profile-settings-button')",
    'settings.hidden = true;',
    "const nextLabel = privateAccount ? 'Private Account' : '';",
    'visibility.hidden = !privateAccount;',
    "setAttribute('aria-hidden', ariaHidden)",
    'function enforceProfilePresentation()',
    'function installProfilePresentationGuard(surface)',
    'new MutationObserver(scheduleSync)',
    "attributeFilter: ['class', 'hidden']",
    'profile-privacy-visibility.css?v=20260919-profileprivacy2',
  ]) {
    assert.ok(source.includes(marker), `profile presentation guard missing ${marker}`);
  }

  for (const marker of [
    '#profile-settings-button',
    '.profile-visibility[hidden]',
    '.profile-visibility:not(.private)',
    'display: none !important',
  ]) {
    assert.ok(privacyCss.includes(marker), `profile privacy CSS missing ${marker}`);
  }
});

test('regular and production builds include the profile presentation loader', async () => {
  const regular = await read('scripts/build-app.mjs');
  const production = await read('scripts/build-production-release.mjs');
  assert.match(regular, /src\/profile-x-ui\.js/);
  assert.match(production, /profile-x-ui\.js/);
});

test('production app bundle keeps a fresh feature cache key after profile presentation fixes', async () => {
  const production = await read('scripts/build-production-release.mjs');
  assert.match(production, /APP_JS_RELEASE = '20260921-notification-header2'/);
  assert.match(production, /APP_JS_FEATURE_RELEASE = '20260919-mobilesettings1'/);
  assert.match(production, /PWA_RELEASE = '20260916-loadingfix1'/);
});

test('profile stylesheet keeps desktop and mobile X-style hierarchy', async () => {
  const css = await read('app/assets/profile-x-ui.css');
  assert.match(css, /height: 184px/);
  assert.match(css, /width: 124px/);
  assert.match(css, /border-radius: 999px/);
  assert.match(css, /\.profile-surface \.profile-actions \[hidden\] \{\s*display: none !important;\s*\}/s);
  assert.match(css, /profile-social-stats > span:first-child \{ order: 2; \}/);
  assert.match(css, /profile-activity-tab\[aria-selected="true"\]::after/);
  assert.match(css, /@media \(min-width: 681px\)/);
  assert.match(css, /\.profile-surface \.profile-activity-tab \{\s*min-width: 0;\s*flex: 1 1 0;/s);
  assert.match(css, /\.profile-surface \.profile-activity-tab\[hidden\] \{\s*display: none;/s);
  assert.match(css, /\.profile-surface \.profile-activity-privacy-toggle svg,\s*\.profile-surface \.profile-activity-tab svg/s);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /width: 96px/);
  assert.match(css, /@media \(max-width: 420px\)/);
});

test('profile visitor actions use an accessible resilient overflow menu without changing action ids', async () => {
  const [shell, source, css, serviceWorker] = await Promise.all([
    read('app/index.html'),
    read('src/profile-x-ui.js'),
    read('app/assets/profile-settings-ui.css'),
    read('sw.js'),
  ]);

  assert.match(shell, /id="sautilink-profile-x-ui"[^>]+profile-x-ui\.css\?v=20260918-profile2/);
  assert.match(shell, /id="profile-more-menu" hidden/);
  assert.match(shell, /id="profile-more-button"[^>]+aria-expanded="false"[^>]+aria-controls="profile-more-popover"/);
  assert.match(shell, /id="profile-more-popover" role="menu" hidden/);
  assert.doesNotMatch(shell, /<details class="profile-more-menu"|<summary aria-label="More profile actions"/);
  for (const id of ['profile-report-button', 'profile-mute-button', 'profile-block-button']) {
    assert.match(shell, new RegExp(`id="${id}"`));
  }
  assert.match(source, /morePopover\.hidden = true/);
  assert.match(source, /moreButton\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(css, /\.profile-surface \.profile-more-popover\[hidden\]/);
  assert.match(css, /width: min\(236px, calc\(100vw - 24px\)\)/);
  assert.match(serviceWorker, /profile-x-ui\.css\?v=20260918-profile2/);
  assert.match(serviceWorker, /profile-settings-ui\.css\?v=20260918-profile2/);
});
