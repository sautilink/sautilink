import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('professional category details marker is a neutral shield check without changing the popup trigger', async () => {
  const css = await read('app/assets/professional-profile-category.css');
  const source = await read('src/professional-profile-category.js');

  assert.match(css, /\.profile-professional-category-info\s*\{[\s\S]*clip-path:\s*polygon\(/);
  assert.match(css, /\.profile-professional-category-info::after\s*\{[\s\S]*border-right:\s*2px solid var\(--app-panel\)/);
  assert.match(css, /\.profile-professional-category-info\s*\{[\s\S]*color:\s*transparent/);
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
