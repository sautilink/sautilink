import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('DM access defaults to Everyone without permanently overriding member choice', async () => {
  const migration = await read('supabase/migrations/20260917033000_default_dm_access_everyone.sql');

  assert.match(migration, /alter column dm_access set default 'everyone'/i);
  assert.match(migration, /update public\.social_profiles\s+set dm_access = 'everyone'/i);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?trigger/i);
  assert.doesNotMatch(migration, /before\s+update|after\s+update/i);
});

test('production loads a dedicated light-theme contrast fix after the main app styles', async () => {
  const [builder, css] = await Promise.all([
    read('scripts/build-production-release.mjs'),
    read('app/assets/settings-light-theme-hotfix.css'),
  ]);

  assert.match(builder, /SETTINGS_LIGHT_THEME_CSS_RELEASE = '20260917-settings1'/);
  assert.match(builder, /settings-light-theme-hotfix\.css/);
  assert.match(css, /:root\[data-theme="light"\]\s*\{[\s\S]*--app-good:\s*#166534;/);
  assert.match(css, /:root\[data-theme="light"\] \.form-message\.success/);
  assert.match(css, /background:\s*#edf9f1;/);
  assert.match(css, /color:\s*#166534;/);
  assert.match(css, /--app-bad:\s*#b4233b;/);
});
