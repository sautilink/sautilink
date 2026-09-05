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

test('profile owner gets a searchable optional category picker with remove support', async () => {
  const source = await read('src/professional-profile-category.js');

  assert.match(source, /Professional category <span>Optional<\/span>/);
  assert.match(source, /placeholder="Search categories"/);
  assert.match(source, /slice\(0, 14\)/);
  assert.match(source, /saveProfessionalCategory\(null\)/);
  assert.match(source, /professional_category_slug: category\?\.slug \|\| null/);
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
