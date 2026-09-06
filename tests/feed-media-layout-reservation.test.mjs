import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';

const appPath = new URL('../src/app.js', import.meta.url);

async function transformedAppSource() {
  const source = await readFile(appPath, 'utf8');
  return transformPostMediaSource(appPath.pathname, source);
}

test('Home hydration batches attached media metadata before rendering feed cards', async () => {
  const source = await transformedAppSource();

  assert.match(source, /const mediaQuery = supabase[\s\S]*?from\('social_post_media'\)[\s\S]*?select\('post_id,id,media_kind,content_type,width,height,duration_ms,alt_text,position'\)/);
  assert.match(source, /Promise\.all\(\[postQuery, actorQuery, likeQuery, repostQuery, savedQuery, mediaQuery\]\)/);
  assert.match(source, /const mediaMap = new Map\(\)/);
  assert.match(source, /mediaRows: mediaMap\.get\(event\.post_id\) \|\| \[\]/);
});

test('Home media posts reserve their media slot before protected bytes load', async () => {
  const source = await transformedAppSource();

  assert.match(source, /const homeMediaRows = home && Array\.isArray\(item\.mediaRows\) \? item\.mediaRows : \[\]/);
  assert.match(source, /article\.classList\.add\('has-media'\)/);
  assert.match(source, /if \(caption\) caption\.hidden = false/);
  assert.match(source, /mediaGallery\.dataset\.mediaReserved = 'true'/);
  assert.match(source, /media-count-\$\{homeMediaRows\.length\}/);
  assert.match(source, /--single-media-aspect-ratio/);
  assert.match(source, /reservedSlot\.className = 'sauti-media-tile'/);
});

test('Home reuses prefetched metadata while non-Home cards keep the existing fallback query', async () => {
  const source = await transformedAppSource();

  assert.match(source, /async function hydrateSautiMediaGallery\(postId, gallery, prefetchedRows = null\)/);
  assert.match(source, /Array\.isArray\(prefetchedRows\) \? prefetchedRows : await loadSautiMediaRows\(postId\)/);
  assert.match(source, /hydrateSautiMediaGallery\(post\.id, mediaGallery, homeMediaRows\.length \? homeMediaRows : null\)/);
  assert.match(source, /async function loadSautiMediaRows\(postId\)/);
});
