import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('professional category details marker uses the original circular info icon without changing the popup trigger', async () => {
  const css = await read('app/assets/professional-profile-category.css');
  const source = await read('src/professional-profile-category.js');

  assert.match(css, /\.profile-professional-category-info\s*\{[\s\S]*display:\s*inline-grid/);
  assert.match(css, /\.profile-professional-category-info\s*\{[\s\S]*width:\s*16px;[\s\S]*height:\s*16px/);
  assert.match(css, /\.profile-professional-category-info\s*\{[\s\S]*border:\s*1px solid currentColor/);
  assert.match(css, /\.profile-professional-category-info\s*\{[\s\S]*border-radius:\s*50%/);
  assert.match(css, /\.profile-professional-category-info\s*\{[\s\S]*font-size:\s*10px/);
  assert.match(source, /info\.textContent\s*=\s*'i'/);
  assert.match(source, /button\.addEventListener\('click', openProfessionalCategoryDialog\)/);
  assert.match(source, /professional-category-dialog-message/);
  assert.doesNotMatch(css, /Refined category details mark|clip-path:\s*polygon\(|-webkit-mask:\s*url\("data:image\/svg\+xml/);
});

test('Government Official uses public-service metadata instead of creator metadata', async () => {
  const migration = await read('supabase/migrations/20260905212500_refine_government_official_category.sql');

  assert.match(migration, /where slug = 'government-official'/);
  assert.match(migration, /Government & Public Service/);
  assert.match(migration, /elected or appointed public-sector officeholders/);
  assert.doesNotMatch(migration, /Creators & Public Figures/);
});
