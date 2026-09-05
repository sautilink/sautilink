import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('edit profile media upload actions use icons without changing their controls', async () => {
  const source = await read('src/profile-media-upload-icons.js');

  assert.match(source, /profile-avatar-upload-button/);
  assert.match(source, /profile-header-upload-button/);
  assert.match(source, /Upload profile photo/);
  assert.match(source, /Upload header image/);
  assert.match(source, /data-profile-media-upload-icon/);
  assert.match(source, /M12 15V4/);
  assert.match(source, /button\.replaceChildren\(profileMediaUploadIcon\(\)\)/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /button\.dataset\.defaultLabel = currentText/);
  assert.match(source, /aria-label/);
  assert.match(source, /aria-busy/);
  assert.doesNotMatch(source, /profile-professional-category|verification|Sautify|login|signup/i);
});

test('profile media upload icon module is included in regular and production app bundles', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const productionBuild = await read('scripts/build-production-release.mjs');

  assert.match(packageJson.scripts['build:app'], /profile-media-upload-icons\.js/);
  assert.match(productionBuild, /profile-media-upload-icons\.js/);
});
