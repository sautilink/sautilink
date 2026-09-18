import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('profile editor and settings refresh is presentation-only and preserves controls', async () => {
  const [shell, source, css] = await Promise.all([
    read('app/index.html'),
    read('src/app.js'),
    read('app/assets/profile-settings-ui.css'),
  ]);

  assert.match(shell, /profile-settings-ui\.css\?v=20260918-profile2/);
  assert.match(shell, /id="profile-editor" role="dialog" aria-modal="true"/);
  assert.match(css, /\.profile-editor-dialog/);
  assert.match(css, /grid-template-columns: 216px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(source, /document\.body\.classList\.add\('profile-editor-open'\)/);
  assert.match(source, /document\.body\.classList\.remove\('profile-editor-open'\)/);

  for (const id of [
    'profile-name-form',
    'profile-username-form',
    'profile-form',
    'settings-discoverable',
    'settings-external-indexing',
    'settings-read-receipts',
    'settings-activity-status',
    'settings-dm-access',
  ]) assert.match(shell, new RegExp(`id="${id}"`));

  assert.doesNotMatch(css, /supabase|fetch\(|service_role/i);
});

test('profile activity presents comments terminology to members', async () => {
  const source = await read('src/profile-activity.js');
  assert.match(source, /replies: 'Comments'/);
  assert.doesNotMatch(source, /replies: 'Replies'/);
});
