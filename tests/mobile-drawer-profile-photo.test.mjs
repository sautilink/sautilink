import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile More drawer can use the visible profile photo instead of the fallback letter', async () => {
  const source = await read('src/mobile-drawer-profile-photo.js');

  assert.match(source, /profile-avatar-image/);
  assert.match(source, /rail-avatar/);
  assert.match(source, /member-avatar/);
  assert.match(source, /activeProfilePhotoSource/);
  assert.match(source, /data-mobile-drawer-profile-photo/);
  assert.match(source, /drawerAvatar\.classList\.add\('has-profile-photo'\)/);
  assert.match(source, /profile-avatar-fallback/);
  assert.match(source, /image\.loading = 'eager'/);
  assert.match(source, /image\.addEventListener\('error'/);
  assert.doesNotMatch(source, /supabase|fetch\(|XMLHttpRequest|WebSocket/i);
});

test('mobile drawer profile photo stays synchronized across drawer opens and avatar changes', async () => {
  const source = await read('src/mobile-drawer-profile-photo.js');

  assert.match(source, /new MutationObserver\(scheduleSync\)/);
  assert.match(source, /attributeFilter: \['src', 'hidden'\]/);
  assert.match(source, /attributeFilter: \['class'\]/);
  assert.match(source, /attributeFilter: \['class', 'hidden'\]/);
  assert.match(source, /profilePhotoBridgeBound/);
  assert.match(source, /bodyObserver\.disconnect\(\)/);
});

test('mobile navigation bundle imports the profile photo bridge without changing drawer backend logic', async () => {
  const navStyle = await read('src/mobile-nav-icon-style.js');
  const drawer = await read('src/mobile-more-drawer.js');

  assert.match(navStyle, /import '\.\/mobile-drawer-profile-photo\.js';/);
  assert.match(drawer, /data-mobile-drawer-view="profile"/);
  assert.doesNotMatch(navStyle, /supabase|fetch\(|XMLHttpRequest|WebSocket/i);
});
