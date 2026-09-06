import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Home feed author name and avatar reuse the working username profile route', async () => {
  const source = await read('src/home-feed-author-profile-links.js');

  assert.match(source, /const HOME_FEED_SELECTOR = '#stream-feed'/);
  assert.match(source, /\.sauti-card-identity a\[href\^="\/u\/"\]/);
  assert.match(source, /const HOME_AUTHOR_AVATAR_SELECTOR = '\.sauti-card-avatar'/);
  assert.match(source, /const HOME_AUTHOR_NAME_SELECTOR = '\.sauti-card-identity \.verified-name'/);
  assert.match(source, /usernameLink\.click\(\)/);
  assert.match(source, /target\.setAttribute\('role', 'link'\)/);
  assert.match(source, /target\.setAttribute\('tabindex', '0'\)/);
  assert.match(source, /event\.key !== 'Enter'/);
});

test('Profile-link enhancement stays scoped to dynamically rendered Home cards', async () => {
  const source = await read('src/home-feed-author-profile-links.js');

  assert.match(source, /document\.querySelector\(HOME_FEED_SELECTOR\)/);
  assert.match(source, /new MutationObserver/);
  assert.match(source, /mutation\.addedNodes\.forEach\(bindCardsWithin\)/);
  assert.doesNotMatch(source, /circle-stream-feed|saved-feed|discover/);
});

test('Feed author link behavior is bundled in normal and production builds', async () => {
  const [packageJson, appBuild, productionBuild] = await Promise.all([
    read('package.json'),
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
  ]);

  assert.match(packageJson, /home-feed-author-profile-links\.js/);
  assert.match(appBuild, /src\/home-feed-author-profile-links\.js/);
  assert.match(productionBuild, /home-feed-author-profile-links\.js/);
});
