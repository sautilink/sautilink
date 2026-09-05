import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('profile loading state uses SautiLink branding and a compact progress indicator', async () => {
  const source = await read('src/profile-route-states.js');
  const css = await read('app/assets/profile-route-states.css');

  assert.match(source, /logo-compact\.webp/);
  assert.match(source, /Loading profile…/);
  assert.match(source, /Opening .* on SautiLink/);
  assert.match(css, /profile-route-brand-logo/);
  assert.match(css, /profile-route-brand-spinner/);
});

test('missing profiles get a professional unavailable state with a clear icon and recovery copy', async () => {
  const source = await read('src/profile-route-states.js');

  assert.match(source, /This account isn’t available/);
  assert.match(source, /username may be misspelled/);
  assert.match(source, /profile-route-unavailable-icon/);
  assert.match(source, /Back to Home/);
});

test('profile route state styling is isolated and adaptive across dark and light themes', async () => {
  const css = await read('app/assets/profile-route-states.css');

  assert.match(css, /#profile-route-state/);
  assert.match(css, /var\(--app-panel\)/);
  assert.match(css, /var\(--app-text\)/);
  assert.match(css, /var\(--app-muted\)/);
  assert.match(css, /:root\[data-theme="light"\] #profile-route-state/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.doesNotMatch(css, /#circle-route-state/);
});

test('profile route branding is included in regular and production bundles without touching auth screens', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const productionBuild = await read('scripts/build-production-release.mjs');
  const source = await read('src/profile-route-states.js');

  assert.match(packageJson.scripts['build:app'], /profile-route-states\.js/);
  assert.match(productionBuild, /profile-route-states\.js/);
  assert.doesNotMatch(source, /login-panel|signup-panel|auth-view/);
});
