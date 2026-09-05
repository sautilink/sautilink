import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('post composer and server enforce a five-media-item limit in built sources', async () => {
  const appSource = await read('src/app.js');
  const postApiSource = await read('src/sauti-posts-api.js');
  const app = transformPostMediaSource('/repo/src/app.js', appSource);
  const api = transformPostMediaSource('/repo/src/sauti-posts-api.js', postApiSource);

  assert.match(app, /`\$\{composerMedia\.length\} \/ 5`/);
  assert.match(app, /Math\.max\(0, 5 - composerMedia\.length\)/);
  assert.match(app, /composerMedia\.length >= 5/);
  assert.match(app, /composerMedia\.length > 5/);
  assert.match(app, /composerMedia\.length < 5/);
  assert.match(app, /data\.slice\(0, 5\)/);
  assert.match(app, /up to five media items/);
  assert.doesNotMatch(app, /up to four media items/);

  assert.match(api, /requestedMedia\.length > 5/);
  assert.match(api, /up to five media items/);
  assert.doesNotMatch(api, /requestedMedia\.length > 4/);
});

test('multi-media post view uses a swipeable carousel without changing single-media behavior', async () => {
  const source = await read('src/post-media-carousel.js');
  const css = await read('app/assets/post-media-carousel.css');

  assert.match(source, /total < 2/);
  assert.match(source, /aria-roledescription', 'carousel'/);
  assert.match(source, /scrollCarouselTo/);
  assert.match(source, /Previous media/);
  assert.match(source, /Next media/);
  assert.match(source, /Go to media/);
  assert.match(source, /MutationObserver/);

  assert.match(css, /scroll-snap-type:\s*x mandatory/);
  assert.match(css, /flex:\s*0 0 100%/);
  assert.match(css, /scroll-snap-align:\s*start/);
  assert.match(css, /\.sauti-media-carousel-dots/);
  assert.match(css, /@media \(max-width:\s*760px\)/);
});

test('regular and production builds include the carousel module and media-limit transform', async () => {
  const packageJson = await read('package.json');
  const regularBuild = await read('scripts/build-app.mjs');
  const productionBuild = await read('scripts/build-production-release.mjs');

  assert.match(packageJson, /"build:app": "node scripts\/build-app\.mjs"/);
  assert.match(regularBuild, /transformPostMediaSource/);
  assert.match(regularBuild, /post-media-carousel\.js/);
  assert.match(productionBuild, /transformPostMediaSource/);
  assert.match(productionBuild, /post-media-carousel\.js/);
});
