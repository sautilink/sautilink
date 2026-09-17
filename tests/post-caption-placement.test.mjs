import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { placeMediaCaptionAboveGallery } from '../src/post-caption-placement.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('media captions remain above galleries without translation controls', () => {
  const moves = [];
  const caption = { nextElementSibling: null };
  const gallery = {
    closest() { return null; },
    before(node) { moves.push(node); },
  };
  const article = {
    querySelector(selector) {
      return selector === '.sauti-media-gallery' ? gallery : null;
    },
  };

  placeMediaCaptionAboveGallery(article, caption);
  assert.deepEqual(moves, [caption]);
});

test('carousel captions stay outside the media shell', () => {
  const moves = [];
  const caption = { nextElementSibling: null };
  const shell = { before(node) { moves.push(node); } };
  const gallery = { closest() { return shell; } };
  const article = {
    querySelector(selector) {
      return selector === '.sauti-media-gallery' ? gallery : null;
    },
  };

  placeMediaCaptionAboveGallery(article, caption);
  assert.deepEqual(moves, [caption]);
});

test('post translation is permanently absent from runtime, API, builds, and bindings', async () => {
  const [router, build, productionBuild, productionConfig, stagingConfig, pkg] = await Promise.all([
    read('src/asset-router.js'),
    read('scripts/build-app.mjs'),
    read('scripts/build-production-release.mjs'),
    read('wrangler.production.jsonc'),
    read('wrangler.social-staging.jsonc'),
    read('package.json'),
  ]);
  const runtime = [router, build, productionBuild, productionConfig, stagingConfig, pkg].join('\n');

  assert.doesNotMatch(runtime, /post-translations|post-translation|POST_TRANSLATION|Translate this post/);
  assert.match(build, /post-caption-placement\.js/);
  assert.match(productionBuild, /post-caption-placement\.js/);
});
