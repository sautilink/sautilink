import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('professional category retains the popup trigger without a visible info marker', async () => {
  const source = await read('src/professional-profile-category.js');

  assert.doesNotMatch(source, /profile-professional-category-info|info\.textContent\s*=\s*'i'/);
  assert.match(source, /button\.addEventListener\('click', openProfessionalCategoryDialog\)/);
  assert.match(source, /professional-category-dialog-message/);
});

test('Government Official uses public-service metadata instead of creator metadata', async () => {
  const migration = await read('supabase/migrations/20260905212500_refine_government_official_category.sql');

  assert.match(migration, /where slug = 'government-official'/);
  assert.match(migration, /Government & Public Service/);
  assert.match(migration, /elected or appointed public-sector officeholders/);
  assert.doesNotMatch(migration, /Creators & Public Figures/);
});
