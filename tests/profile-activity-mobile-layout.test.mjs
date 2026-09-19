import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('visitor profile presentation collapses owner-only activity rows', async () => {
  const source = await read('src/profile-x-ui.js');

  assert.match(source, /function syncProfileActivityPresentation\(\)/);
  assert.match(source, /profile-edit-button/);
  assert.match(source, /profile-owner-dashboard-actions/);
  assert.match(source, /profile-activity-tools/);
  assert.match(source, /profile-activity-privacy/);
  assert.match(source, /if \(ownerActions && !owner && !ownerActions\.hidden\) ownerActions\.hidden = true/);
  assert.match(source, /if \(tools && !owner && !tools\.hidden\) tools\.hidden = true/);
  assert.match(source, /if \(privacy && !owner && !privacy\.hidden\) privacy\.hidden = true/);
  assert.match(source, /syncProfileActivityPresentation\(\)/);
});

test('mobile profile activity stays attached to the profile and does not float the tab bar', async () => {
  const [source, css] = await Promise.all([
    read('src/profile-x-ui.js'),
    read('app/assets/profile-activity-mobile-fix.css'),
  ]);

  assert.match(source, /profile-activity-mobile-fix\.css\?v=20260919-profileactivity1/);
  assert.match(css, /\.profile-surface \.profile-activity-shell \{\s*margin-top: 0 !important;/s);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.profile-surface \.profile-activity-tabs \{\s*position: relative !important;\s*top: auto !important;/s);
  assert.match(css, /\.profile-surface \.profile-owner-dashboard-actions\[hidden\]/);
  assert.match(css, /\.profile-surface \.profile-activity-tools\[hidden\]/);
  assert.match(css, /display: none !important/);
});

test('profile post cards keep their identity row visible before the post body on mobile', async () => {
  const css = await read('app/assets/profile-activity-mobile-fix.css');
  const source = await read('src/profile-activity.js');

  assert.match(source, /main\.append\(head\)/);
  assert.match(source, /head\.append\(authorName, handle, dot, time\)/);
  assert.match(css, /\.profile-surface \.profile-activity-card-head \{/);
  assert.match(css, /display: flex !important/);
  assert.match(css, /visibility: visible !important/);
  assert.match(css, /opacity: 1 !important/);
  assert.match(css, /\.profile-surface \.profile-activity-author-name/);
  assert.match(css, /\.profile-surface \.profile-activity-handle/);
});
