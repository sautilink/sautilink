import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformProfileTabIconsSource } from '../scripts/profile-tab-icons-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Profile activity adds familiar icons only to Posts, Reposts and Replies', () => {
  const fixture = `const PROFILE_ACTIVITY_LABELS = Object.freeze({ posts: 'Posts' });\nconst PROFILE_ACTIVITY_BADGES = Object.freeze({});\nconst html = \`\${PROFILE_ACTIVITY_LABELS[tab]}</button>\`;`;
  const output = transformProfileTabIconsSource('/repo/src/profile-activity.js', fixture);

  for (const tab of ['posts', 'reposts', 'replies']) {
    assert.ok(output.includes(`data-profile-activity-tab-icon="${tab}"`), `missing ${tab} tab icon`);
  }
  assert.doesNotMatch(output, /data-profile-activity-tab-icon="(?:likes|saves|hashtags)"/);
  assert.match(output, /aria-hidden="true"/);
  assert.match(output, /stroke="currentColor"/);
  assert.match(output, /PROFILE_ACTIVITY_TAB_ICONS\[tab\]/);
});

test('Profile tab icon transform stays isolated to profile activity source', () => {
  const source = 'const untouched = true;';
  assert.equal(transformProfileTabIconsSource('/repo/src/app.js', source), source);
});

test('normal and production builds both apply the Profile tab icon transform', async () => {
  const normalBuild = await read('scripts/build-app.mjs');
  const productionBuild = await read('scripts/build-production-release.mjs');

  assert.match(normalBuild, /transformProfileTabIconsSource/);
  assert.match(normalBuild, /profile-activity\\\.js\$/);
  assert.match(productionBuild, /transformProfileTabIconsSource/);
});

test('built app contains the three Profile tab icon markers', async () => {
  const bundle = await read('app/assets/app.js');
  for (const tab of ['posts', 'reposts', 'replies']) {
    assert.ok(bundle.includes(`data-profile-activity-tab-icon="${tab}"`), `built bundle missing ${tab} tab icon`);
  }
});
