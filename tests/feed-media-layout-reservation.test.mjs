import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';

const appPath = new URL('../src/app.js', import.meta.url);
const profileActivityPath = new URL('../src/profile-activity.js', import.meta.url);

async function transformedAppSource(filePath = appPath.pathname) {
  const source = await readFile(appPath, 'utf8');
  return transformPostMediaSource(filePath, source);
}

function functionSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing ${endMarker}`);
  return source.slice(start, end);
}

test('post surfaces batch attached media metadata before cards render', async () => {
  const source = await transformedAppSource();

  assert.match(source, /async function loadSautiMediaRowsMap\(postIds\)/);
  assert.match(source, /\.from\('social_post_media'\)[\s\S]*?\.select\('post_id,id,media_kind,content_type,width,height,duration_ms,alt_text,position'\)/);
  assert.match(source, /loadSautiMediaRowsMap\(postIds\)/);

  const home = functionSlice(source, 'async function hydrateStreamEvents(events)', 'async function hydrateDirectPosts(posts)');
  assert.match(home, /loadSautiMediaRowsMap\(postIds\)/);
  assert.match(home, /mediaRows: mediaMap\?\.get\(event\.post_id\) \?\? \(mediaMap \? \[\] : null\)/);

  const direct = functionSlice(source, 'async function hydrateDirectPosts(posts)', 'async function loadStream(');
  assert.match(direct, /loadSautiMediaRowsMap\(postIds\)/);
  assert.match(direct, /mediaRows: mediaMap\?\.get\(post\.id\) \?\? \(mediaMap \? \[\] : null\)/);
});

test('prefetched hydration does not abort while a card is still detached from document', async () => {
  const source = await transformedAppSource();
  const hydrate = functionSlice(
    source,
    'async function hydrateSautiMediaGallery(postId, gallery, prefetchedRows = null)',
    'function openSautiMediaViewer',
  );

  assert.match(hydrate, /Array\.isArray\(prefetchedRows\) \? prefetchedRows : await loadSautiMediaRows\(postId\)/);
  assert.match(hydrate, /if \(!gallery\.parentNode\) return/);
  assert.doesNotMatch(hydrate, /if \(!gallery\.isConnected\) return/);
});

test('all media tiles reserve geometry before protected bytes begin loading', async () => {
  const source = await transformedAppSource();
  const hydrate = functionSlice(
    source,
    'async function hydrateSautiMediaGallery(postId, gallery, prefetchedRows = null)',
    'function openSautiMediaViewer',
  );

  const appendIndex = hydrate.indexOf('gallery.append(button);');
  const fetchIndex = hydrate.indexOf('const url = await fetchSautiMediaBlobUrl(media.id);');
  assert.ok(appendIndex >= 0, 'media tile must be appended');
  assert.ok(fetchIndex >= 0, 'protected media fetch must exist');
  assert.ok(appendIndex < fetchIndex, 'media tile must exist before protected bytes are fetched');
  assert.match(hydrate, /await Promise\.all\(mediaEntries\.map\(async/);
  assert.match(hydrate, /button\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(hydrate, /button\.setAttribute\('aria-busy', 'false'\)/);
});

test('shared post card reservation applies beyond Home and preserves exact single-media ratio', async () => {
  const source = await transformedAppSource();
  const card = functionSlice(source, 'function createSautiCard(item, { home = false } = {})', 'function renderStreamRows');

  assert.match(card, /const prefetchedMediaRows = Array\.isArray\(item\.mediaRows\) \? item\.mediaRows : null/);
  assert.doesNotMatch(card, /home && Array\.isArray\(item\.mediaRows\)/);
  assert.match(card, /article\.classList\.add\('has-media'\)/);
  assert.match(card, /if \(caption\) caption\.hidden = false/);
  assert.match(card, /mediaGallery\.dataset\.mediaReserved = 'true'/);
  assert.match(card, /const ratio = width > 0 && height > 0 \? `\$\{width\} \/ \$\{height\}` : '4 \/ 5'/);
  assert.match(card, /hydrateSautiMediaGallery\(post\.id, mediaGallery, prefetchedMediaRows\)/);
});

test('Windows-style production paths still receive the media reservation transform', async () => {
  const source = await transformedAppSource('C:\\repo\\src\\app.js');
  assert.match(source, /async function loadSautiMediaRowsMap\(postIds\)/);
});

test('profile activity can display the fifth media item supported by production posts', async () => {
  const source = await readFile(profileActivityPath, 'utf8');
  const transformed = transformPostMediaSource(profileActivityPath.pathname, source);
  assert.match(transformed, /mediaRows\.slice\(0, 5\)/);
});
