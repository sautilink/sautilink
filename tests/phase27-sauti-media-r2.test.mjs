import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectMp4Bytes } from '../src/sauti-media-api.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const escapeRegExp = (value) => value.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');

function ascii(value) {
  return Uint8Array.from([...value].map((char) => char.charCodeAt(0)));
}

function u32(value) {
  return Uint8Array.from([
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ]);
}

function concat(...parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function box(type, payload) {
  return concat(u32(payload.length + 8), ascii(type), payload);
}

function validMp4({ seconds = 30, width = 1280, height = 720 } = {}) {
  const mvhdData = new Uint8Array(96);
  const mvhdView = new DataView(mvhdData.buffer);
  mvhdView.setUint32(8, 1000, false);
  mvhdView.setUint32(12, seconds * 1000, false);
  const mvhd = box('mvhd', concat(new Uint8Array(4), mvhdData));

  const tkhdData = new Uint8Array(80);
  const tkhdView = new DataView(tkhdData.buffer);
  tkhdView.setUint32(72, width * 65536, false);
  tkhdView.setUint32(76, height * 65536, false);
  const tkhd = box('tkhd', concat(new Uint8Array(4), tkhdData));
  const trak = box('trak', tkhd);

  const ftyp = box('ftyp', concat(ascii('isom'), new Uint8Array(8)));
  const moov = box('moov', concat(mvhd, trak));
  return concat(ftyp, moov);
}

test('Phase 27 MP4 inspector validates duration and dimensions', () => {
  assert.deepEqual(inspectMp4Bytes(validMp4()), {
    contentType: 'video/mp4',
    width: 1280,
    height: 720,
    durationMs: 30000,
  });
  assert.equal(inspectMp4Bytes(validMp4({ seconds: 91 })), null);
  assert.equal(inspectMp4Bytes(new Uint8Array(64)), null);
});

test('Phase 27 defines owner-scoped R2 metadata and explicit RLS grants', async () => {
  const migration = await read('supabase/migrations/20260902013000_enable_phase27_sauti_media.sql');

  for (const term of [
    'social_post_media',
    'enable row level security',
    'social_post_media_select_phase27_anon',
    'social_post_media_select_phase27_authenticated',
    'owner_id = (select auth.uid())',
    'media_count between 0 and 4',
    "'sauti/' || owner_id::text",
    'grant insert',
    'grant update',
  ]) {
    assert.match(migration, new RegExp(escapeRegExp(term), 'i'));
  }
  assert.doesNotMatch(migration, /service_role|disable row level security/i);
});

test('Phase 27 Worker uses bounded begin upload finalize and validated R2 metadata', async () => {
  const source = await read('src/sauti-media-api.js');
  const router = await read('src/asset-router.js');
  const wrangler = await read('wrangler.social-staging.jsonc');

  for (const term of [
    '/api/sauti-media/begin',
    '/api/sauti-media/upload/',
    '/api/sauti-media/finalize/',
    'inspectImageBytes',
    'inspectMp4Bytes',
    "validated: 'true'",
    'MAX_VIDEO_DURATION_MS',
    'UPLOAD_TTL_MS',
    'cleanupExpiredOwnerUploads',
  ]) {
    assert.match(source, new RegExp(escapeRegExp(term)));
  }
  assert.match(router, /handleSautiMediaRequest/);
  assert.match(wrangler, /"binding": "SAUTI_MEDIA"/);
  assert.match(wrangler, /"name": "SAUTI_MEDIA_BEGIN_LIMITER"/);
  assert.doesNotMatch(source, /service_role|R2_ACCESS_KEY|secret_access_key/i);
});

test('Phase 27 composer exposes progress retry alt text media-only sharing and viewer', async () => {
  const html = await read('app/index.html');
  const app = await read('src/app.js');

  for (const term of [
    'sauti-media-file',
    'sauti-media-list',
    'sauti-media-add',
    'sauti-media-viewer',
  ]) assert.match(html, new RegExp(term));

  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 27, `visible app phase regressed below Phase 27: ${phase}`);

  for (const term of [
    'uploadWithProgress',
    'Waiting for connection',
    'Retry',
    'Alternative text',
    'composerMedia.length',
    'hydrateSautiMediaGallery',
    'openSautiMediaViewer',
    'media: composerMedia.map',
    'resumeWaitingComposerMedia',
    'COMPOSER_MEDIA_CACHE',
    'cacheComposerMediaFile',
    'readCachedComposerMediaFile',
    'removeCachedComposerMediaFile',
  ]) assert.match(app, new RegExp(escapeRegExp(term), 'i'));
});

test('Phase 27 Sauti lifecycle validates R2 before attach and cleans objects on delete', async () => {
  const posts = await read('src/sauti-posts-api.js');

  assert.match(posts, /env\.SAUTI_MEDIA\.head\(row\.object_key\)/);
  assert.match(posts, /object\.customMetadata\?\.validated !== 'true'/);
  assert.match(posts, /upload_status: 'attached'/);
  assert.match(posts, /media_count: media\.length/);
  assert.match(posts, /env\.SAUTI_MEDIA\.delete\(key\)/);
  assert.match(posts, /up to four media items/i);
});


test('Phase 27 generated Supabase types include media metadata and post media_count', async () => {
  const types = await read('src/types/database.ts');
  assert.match(types, /social_post_media:/);
  assert.match(types, /media_count: number/);
  assert.match(types, /duration_ms: number \| null/);
  assert.match(types, /upload_status: string/);
});
