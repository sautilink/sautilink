import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Rooms is the canonical user-facing community brand', async () => {
  const [rooms, router, packageJson, production] = await Promise.all([
    read('src/rooms-platform.js'),
    read('src/asset-router.js'),
    read('package.json'),
    read('wrangler.production.jsonc'),
  ]);

  assert.match(rooms, /textContent = 'Rooms'/);
  assert.match(rooms, /textContent = 'Create Room'/);
  assert.match(rooms, /Room username/);
  assert.match(rooms, /\/rooms\//);
  assert.match(rooms, /roomIconMarkup/);
  assert.match(rooms, /Sautify\\b\/g, 'Room'/);

  assert.match(router, /rooms\|sautify\|circles/);
  assert.match(router, /CLEAN_ROOM_ROUTE/);
  assert.match(production, /sautilink\.com\/rooms\*/);
  assert.match(production, /www\.sautilink\.com\/rooms\*/);
  assert.match(packageJson, /--inject:\.\/src\/rooms-platform\.js/);
  assert.match(packageJson, /--inject:\.\/src\/rooms-invitations\.js/);

  // Internal persistence names intentionally remain stable to avoid a destructive data migration.
  assert.match(rooms, /social_circles/);
  assert.match(rooms, /social_circle_members/);
});

test('Rooms runtime modules are wired into the actual esbuild bundle', async () => {
  const [builder, bundle] = await Promise.all([
    read('scripts/build-app.mjs'),
    read('app/assets/app.js'),
  ]);

  for (const modulePath of [
    'src/rooms-platform.js',
    'src/rooms-invitations-style.js',
    'src/rooms-invitations.js',
  ]) {
    assert.match(builder, new RegExp(modulePath.replaceAll('.', '\\.')));
  }

  // npm run check builds the app before tests, so these assertions prove the
  // Rooms runtime made it into the artifact that staging/production deploy.
  assert.match(bundle, /Technology & AI/);
  assert.match(bundle, /rooms-invitations\.css/);
  assert.match(bundle, /The Room invitation could not be updated/);
});

test('Room creation exposes discovery, privacy and permission choices', async () => {
  const rooms = await read('src/rooms-platform.js');

  for (const category of ['technology', 'learning', 'marketplace', 'creators', 'fashion', 'friends-community']) {
    assert.match(rooms, new RegExp(`'${category}'`));
  }
  assert.match(rooms, /Public — anyone can discover/);
  assert.match(rooms, /Private — discoverable, but posts are members only/);
  assert.match(rooms, /Admins & moderators only/);
  assert.match(rooms, /Cover photo/);
  assert.match(rooms, /Room usernames use 3–50 lowercase letters/);
});

test('Composer keeps familiar Create Post and Post language', async () => {
  const html = await read('app/index.html');
  const source = await read('src/app.js');
  const preview = await read('preview-src/app-shell/App.jsx');

  assert.match(html, /<span>Create Post<\/span>/);
  assert.match(html, /id="sauti-submit"[^>]*>Post<\/button>/);
  assert.doesNotMatch(html, /Share a Sauti/);
  assert.doesNotMatch(source, /Share a Sauti/);
  assert.doesNotMatch(preview, /Share a Sauti/);
  assert.match(source, /navigator\.onLine \? 'Post' : 'Save draft'/);
});
