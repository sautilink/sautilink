import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appHtml = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const profileUiSource = await readFile(new URL('../src/profile-x-ui.js', import.meta.url), 'utf8');

test('profile presents Followers before Following without changing count bindings', () => {
  const followersIndex = appHtml.indexOf('id="profile-followers-count"');
  const followingIndex = appHtml.indexOf('id="profile-following-count"');

  assert.notEqual(followersIndex, -1);
  assert.notEqual(followingIndex, -1);
  assert.ok(followersIndex < followingIndex, 'Followers must appear before Following in profile markup');

  assert.match(
    profileUiSource,
    /profile-social-stats > span:first-child \{ order: 1; \}/,
  );
  assert.match(
    profileUiSource,
    /profile-social-stats > span:nth-child\(2\) \{ order: 2; \}/,
  );
});
