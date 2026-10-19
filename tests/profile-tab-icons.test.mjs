import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformProfileTabIconsSource } from '../scripts/profile-tab-icons-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Profile activity adds familiar icons to every activity tab and Activity privacy', () => {
  const fixture = `const PROFILE_ACTIVITY_LABELS = Object.freeze({ posts: 'Posts' });\nconst PROFILE_ACTIVITY_BADGES = Object.freeze({});\nconst privacy = \`aria-expanded="false">Activity privacy</button>\`;\nconst html = \`<button data-profile-activity-tab="\${tab}" aria-selected="\${tab === 'posts'}">\${PROFILE_ACTIVITY_LABELS[tab]}</button>\`;`;
  const output = transformProfileTabIconsSource('/repo/src/profile-activity.js', fixture);

  for (const tab of ['posts', 'reposts', 'replies', 'likes', 'saves', 'hashtags']) {
    assert.ok(output.includes(`data-profile-activity-tab-icon="${tab}"`), `missing ${tab} tab icon`);
  }
  assert.match(output, /data-profile-activity-privacy-icon="true"/);
  assert.match(output, /PROFILE_ACTIVITY_PRIVACY_ICON}Activity privacy/);
  assert.match(output, /aria-hidden="true"/);
  assert.match(output, /stroke="currentColor"/);
  assert.match(output, /PROFILE_ACTIVITY_TAB_ICONS\[tab\]/);
});

test('real profile shell keeps all six feature tabs and accessible labels when inactive labels collapse', async () => {
  const original = await read('src/profile-activity.js');
  const output = transformProfileTabIconsSource('/repo/src/profile-activity.js', original);
  const constants = output.slice(output.indexOf('const PROFILE_ACTIVITY_TABS'), output.indexOf('let profileActivityState'));
  const templateStart = output.indexOf('shell.innerHTML = `') + 'shell.innerHTML = '.length;
  const templateEnd = output.indexOf('`;\n  profileCard.insertAdjacentElement', templateStart) + 1;
  const html = runInNewContext(`${constants}\n(${output.slice(templateStart, templateEnd)})`);
  const tabs = [...html.matchAll(/<button class="profile-activity-tab"([^>]+)>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(tabs.map(([, attrs]) => attrs.match(/data-profile-activity-tab="([^"]+)"/)[1]), ['posts', 'reposts', 'replies', 'likes', 'saves', 'hashtags']);
  for (const [, attrs, contents] of tabs) {
    const key = attrs.match(/data-profile-activity-tab="([^"]+)"/)[1];
    const label = contents.match(/<span class="profile-activity-tab-label">([^<]+)<\/span>/)[1];
    assert.ok(contents.startsWith('<svg'), `${key} keeps its original SVG first`);
    assert.ok(attrs.includes(`aria-label="${label}"`), `${key} has an accessible name independent of visible label width`);
    assert.ok(attrs.includes(`title="${label}"`), `${key} has a pointer tooltip`);
    assert.ok(attrs.includes(`aria-selected="${key === 'posts'}"`));
    assert.match(attrs, /role="tab"/);
  }
  assert.match(tabs[2][2], />Replies<\/span>/);
  assert.match(html, /id="profile-activity-privacy-toggle"[^>]+aria-expanded="false"/);
  assert.match(html, /id="profile-activity-hashtags"/);
  assert.equal(transformProfileTabIconsSource('/repo/src/profile-activity.js', output), output, 'transform is idempotent');
  const featureStart = '  profileCard.insertAdjacentElement';
  assert.equal(output.slice(output.indexOf(featureStart)), original.slice(original.indexOf(featureStart)), 'all feature functions, requests, privacy rules, click handlers and tab state updates remain byte-identical');
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

test('built app contains all Profile activity control icon markers', async () => {
  const bundle = await read('app/assets/app.js');
  for (const tab of ['posts', 'reposts', 'replies', 'likes', 'saves', 'hashtags']) {
    assert.ok(bundle.includes(`data-profile-activity-tab-icon="${tab}"`), `built bundle missing ${tab} tab icon`);
  }
  assert.ok(bundle.includes('data-profile-activity-privacy-icon="true"'), 'built bundle missing Activity privacy icon');
});
