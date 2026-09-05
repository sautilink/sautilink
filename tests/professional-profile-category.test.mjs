import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('professional category catalog is canonical, optional and database constrained', async () => {
  const migration = await read('supabase/migrations/20260905203000_professional_public_profile_categories.sql');

  assert.match(migration, /create table if not exists public\.profile_categories/);
  assert.match(migration, /alter table public\.profile_categories enable row level security/);
  assert.match(migration, /add column if not exists professional_category_slug text/);
  assert.match(migration, /foreign key \(professional_category_slug\)/);
  assert.match(migration, /references public\.profile_categories\(slug\)/);
  assert.match(migration, /grant select, update \(professional_category_slug\) on public\.social_profiles to authenticated/);
  assert.match(migration, /Content Creator/);
  assert.doesNotMatch(migration, /\|Digital Creator\||'Digital Creator'/);
});

test('professional category UI sits under the username and opens a descriptive popup', async () => {
  const source = await read('src/professional-profile-category.js');

  assert.match(source, /profile-username/);
  assert.match(source, /insertAdjacentElement\('afterend', button\)/);
  assert.match(source, /profile-professional-category/);
  assert.match(source, /aria-haspopup', 'dialog'/);
  assert.match(source, /professional-category-dialog-message/);
  assert.match(source, /category\.description/);
  assert.match(source, /Professional category/);
});

test('profile owner gets 25 popular default category suggestions', async () => {
  const source = await read('src/professional-profile-category.js');
  const block = source.match(/const PROFESSIONAL_CATEGORY_POPULAR_SLUGS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(block, 'expected popular category list');
  const slugs = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);

  assert.equal(slugs.length, 25);
  for (const slug of [
    'public-figure',
    'content-creator',
    'company',
    'artist',
    'government-official',
    'comedian',
    'entrepreneur',
    'media-company',
    'software-company',
    'brand',
  ]) {
    assert.ok(slugs.includes(slug), `expected ${slug} in popular category suggestions`);
  }
  assert.match(source, /PROFESSIONAL_CATEGORY_RESULT_LIMIT = 25/);
  assert.match(source, /Popular categories/);
});

test('category search tolerates small spelling mistakes and returns closest suggestions', async () => {
  const source = await read('src/professional-profile-category.js');

  assert.match(source, /function professionalCategoryEditDistance/);
  assert.match(source, /function professionalCategorySearchScore/);
  assert.match(source, /queryToken\.length \* 0\.3/);
  assert.match(source, /Closest matches/);
  assert.match(source, /Suggested ·/);
  assert.match(source, /No close category found/);
});

test('profile owner gets a polished searchable optional category picker with remove support', async () => {
  const source = await read('src/professional-profile-category.js');
  const css = await read('app/assets/professional-profile-category.css');

  assert.match(source, /Professional category <span>Optional<\/span>/);
  assert.match(source, /placeholder="Search professional categories"/);
  assert.match(source, /professional-category-search-icon/);
  assert.match(source, /professional-category-query-clear/);
  assert.match(source, /saveProfessionalCategory\(null\)/);
  assert.match(source, /professional_category_slug: category\?\.slug \|\| null/);
  assert.match(css, /\.professional-category-search-shell:focus-within/);
  assert.match(css, /box-shadow: 0 0 0 3px/);
  assert.match(css, /\.professional-category-options-label/);
  assert.doesNotMatch(source, /login-panel|signup-panel|verification-info-dialog/);
});

test('professional category styling uses SautiLink theme variables and a centered mobile dialog', async () => {
  const css = await read('app/assets/professional-profile-category.css');

  assert.match(css, /color: var\(--app-accent\)/);
  assert.match(css, /background: var\(--app-panel\)/);
  assert.match(css, /color: var\(--app-text\)/);
  assert.match(css, /color: var\(--app-muted\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /margin: auto/);
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\(/i);
});

test('professional category module is included in regular and production bundles', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const productionBuild = await read('scripts/build-production-release.mjs');

  assert.match(packageJson.scripts['build:app'], /professional-profile-category\.js/);
  assert.match(productionBuild, /professional-profile-category\.js/);
});
