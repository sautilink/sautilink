import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { handlePublicIndexingRoutes } from '../src/public-indexing-routes.js';

const POST_ID = '123e4567-e89b-42d3-a456-426614174000';
const IMAGE_A = '123e4567-e89b-42d3-a456-426614174101';
const IMAGE_B = '123e4567-e89b-42d3-a456-426614174102';
const VIDEO_ID = '123e4567-e89b-42d3-a456-426614174103';
const OWNER_ID = '123e4567-e89b-42d3-a456-426614174199';
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const shell = '<!doctype html><html><head><meta name="robots" content="noindex, nofollow"><title>SautiLink App</title><meta name="description" content="Sign in or create your SautiLink account."></head><body><main>App shell</main></body></html>';
const env = {
  ASSETS: {
    fetch: async () => new Response(shell, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  },
};

function rpcFetch(row) {
  return async (input) => {
    const url = String(input);
    assert.match(url, /\/rest\/v1\/rpc\//);
    if (!url.includes('public_share_post_v1')) return Response.json([]);
    return Response.json(row ? [row] : []);
  };
}

function basePost(overrides = {}) {
  return {
    post_id: POST_ID,
    body: 'Public SautiLink post body for preview.',
    created_at: '2026-10-06T18:00:00Z',
    updated_at: '2026-10-06T18:30:00Z',
    media_count: 0,
    like_count: 12,
    comment_count: 3,
    repost_count: 2,
    author_username: 'drcharlestz',
    author_display_name: 'Dr. Charles',
    author_avatar_key: 'profiles/example/avatar.jpg',
    author_is_verified: true,
    author_verification_badge_type: 'standard',
    search_indexable: true,
    media: [],
    ...overrides,
  };
}

test('public share migrations separate direct public viewing from search indexing without reopening media-table reads', async () => {
  const [sql, hardening] = await Promise.all([
    read('supabase/migrations/20261006211233_enable_public_post_sharing.sql'),
    read('supabase/migrations/20261006212530_harden_public_post_sharing.sql'),
  ]);

  assert.match(sql, /create or replace function public\.public_share_post_v1\(p_post_id uuid\)/i);
  assert.match(sql, /post\.visibility = 'public'/);
  assert.match(sql, /post\.circle_id is null/);
  assert.match(sql, /post\.post_status = 'published'/);
  assert.match(sql, /post\.deleted_at is null/);
  assert.match(sql, /post\.moderation_state = 'visible'/);
  assert.match(sql, /as search_indexable/);
  assert.match(sql, /author\.allow_external_indexing = true/);
  assert.match(sql, /audience_owner\.allow_external_indexing = true/);
  assert.match(sql, /jsonb_agg/);
  assert.doesNotMatch(sql, /'object_key'/);
  assert.match(sql, /revoke all on function public\.public_share_post_v1\(uuid\) from public/i);
  assert.match(sql, /grant execute on function public\.public_share_post_v1\(uuid\) to anon, authenticated/i);
  assert.match(sql, /drop policy if exists social_post_media_select_phase27_anon/);
  assert.match(sql, /post\.visibility = 'public'[\s\S]*post\.circle_id is null[\s\S]*post\.moderation_state = 'visible'/);

  assert.match(hardening, /'owner_id', media\.owner_id/);
  assert.doesNotMatch(hardening, /'object_key'/);
  assert.match(hardening, /revoke execute on function public\.public_share_post_v1\(uuid\) from authenticated/i);
  assert.match(hardening, /drop policy if exists social_post_media_select_phase27_anon/);
  assert.match(hardening, /revoke select on table public\.social_post_media from anon/i);
});

test('public but search-opted-out video post gets a real share preview while remaining noindex', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rpcFetch(basePost({
    body: 'Kazi ya Karma',
    media_count: 1,
    search_indexable: false,
    media: [{
      id: VIDEO_ID,
      kind: 'video',
      content_type: 'video/mp4',
      width: 640,
      height: 360,
      duration_ms: 135,
      alt_text: '',
      position: 0,
    }],
  }));

  try {
    const response = await handlePublicIndexingRoutes(new Request(`https://sautilink.com/post/${POST_ID}`), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
    const html = await response.text();

    assert.match(html, /Kazi ya Karma/);
    assert.match(html, new RegExp(`og:image" content="https:\\/\\/sautilink\\.com\\/api\\/public-post-media\\/${POST_ID}\\/${VIDEO_ID}\\?poster=1"`));
    assert.match(html, /og:image:type" content="image\/jpeg"/);
    assert.match(html, /twitter:card" content="summary_large_image"/);
    assert.match(html, /VideoObject/);
    assert.match(html, /thumbnailUrl/);
    assert.match(html, /PT1S/);
    assert.doesNotMatch(html, /contentUrl[^<]*\.mp4|https:\/\/sautilink\.com\/api\/sauti-media\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('multi-image post uses first image for social preview and indexes every public image in structured data', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rpcFetch(basePost({
    media_count: 2,
    media: [
      { id: IMAGE_B, owner_id: OWNER_ID, kind: 'image', content_type: 'image/webp', width: 900, height: 700, alt_text: 'Second image', position: 1 },
      { id: IMAGE_A, owner_id: OWNER_ID, kind: 'image', content_type: 'image/jpeg', width: 1200, height: 900, alt_text: 'First image', position: 0 },
    ],
  }));

  try {
    const response = await handlePublicIndexingRoutes(new Request(`https://sautilink.com/post/${POST_ID}`), env);
    assert.match(response.headers.get('X-Robots-Tag') || '', /^index, follow/);
    const html = await response.text();

    assert.match(html, new RegExp(`og:image" content="https:\\/\\/sautilink\\.com\\/api\\/public-post-media\\/${POST_ID}\\/${IMAGE_A}\\?w=1440"`));
    assert.match(html, /og:image:type" content="image\/jpeg"/);
    const firstAt = html.indexOf(IMAGE_A);
    const secondAt = html.indexOf(IMAGE_B);
    assert.ok(firstAt >= 0 && secondAt >= 0);
    assert.match(html, /ImageObject/);
    assert.match(html, /First image/);
    assert.match(html, /Second image/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('text-only post uses a versioned 1200x630 SautiLink social card', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rpcFetch(basePost({ media: [], media_count: 0 }));

  try {
    const response = await handlePublicIndexingRoutes(new Request(`https://sautilink.com/post/${POST_ID}`), env);
    const html = await response.text();

    assert.match(html, new RegExp(`og:image" content="https:\\/\\/sautilink\\.com\\/api\\/public-post-card\\/${POST_ID}\\.png\\?v=`));
    assert.match(html, /og:image:type" content="image\/png"/);
    assert.match(html, /og:image:width" content="1200"/);
    assert.match(html, /og:image:height" content="630"/);
    assert.match(html, /twitter:card" content="summary_large_image"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guest JSON exposes only public post data, counts and safe preview URLs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rpcFetch(basePost({
    search_indexable: false,
    media_count: 2,
    media: [
      { id: IMAGE_A, owner_id: OWNER_ID, kind: 'image', content_type: 'image/jpeg', width: 1200, height: 900, alt_text: 'One', position: 0 },
      { id: VIDEO_ID, owner_id: OWNER_ID, kind: 'video', content_type: 'video/mp4', width: 640, height: 360, duration_ms: 12000, alt_text: 'Clip', position: 1 },
    ],
  }));

  try {
    const response = await handlePublicIndexingRoutes(new Request(`https://sautilink.com/api/public-post/${POST_ID}`), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
    const json = await response.json();

    assert.equal(json.data.post.counts.likes, 12);
    assert.equal(json.data.post.counts.comments, 3);
    assert.equal(json.data.post.counts.reposts, 2);
    assert.equal(json.data.post.search_indexable, false);
    assert.equal(json.data.post.media.length, 2);
    assert.match(json.data.post.media[0].preview_url, /\/api\/public-post-media\//);
    assert.match(json.data.post.media[1].preview_url, /poster=1/);
    assert.doesNotMatch(JSON.stringify(json), /owner_id|object_key|sauti\//i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});



test('public image preview is read from the deterministic private R2 key without an anonymous media-table query', async () => {
  const originalFetch = globalThis.fetch;
  let requestedKey = '';
  globalThis.fetch = rpcFetch(basePost({
    media_count: 1,
    media: [{
      id: IMAGE_A,
      owner_id: OWNER_ID,
      kind: 'image',
      content_type: 'image/jpeg',
      width: 1200,
      height: 900,
      alt_text: 'Public image',
      position: 0,
    }],
  }));

  const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const mediaEnv = {
    ...env,
    SAUTI_MEDIA: {
      async get(key) {
        requestedKey = key;
        return {
          body: imageBytes,
          size: imageBytes.byteLength,
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/jpeg'); },
        };
      },
      async head() { return null; },
    },
  };

  try {
    const response = await handlePublicIndexingRoutes(
      new Request(`https://sautilink.com/api/public-post-media/${POST_ID}/${IMAGE_A}?w=1440`),
      mediaEnv,
    );
    assert.equal(response.status, 200);
    assert.equal(requestedKey, `sauti/${OWNER_ID}/${IMAGE_A}.jpg`);
    assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), imageBytes);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public video poster falls back to a branded post card instead of a broken image', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rpcFetch(basePost({
    media_count: 1,
    media: [{
      id: VIDEO_ID,
      owner_id: OWNER_ID,
      kind: 'video',
      content_type: 'video/mp4',
      width: 1080,
      height: 1350,
      duration_ms: 38510,
      alt_text: '',
      position: 0,
    }],
  }));

  const fallbackEnv = {
    ...env,
    SAUTI_MEDIA: {
      async head() { return null; },
      async get() { return null; },
    },
    ASSETS: {
      async fetch() {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          headers: { 'Content-Type': 'image/png' },
        });
      },
    },
  };

  try {
    const response = await handlePublicIndexingRoutes(
      new Request(`https://sautilink.com/api/public-post-media/${POST_ID}/${VIDEO_ID}?poster=1`),
      fallbackEnv,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Sauti-Public-Preview'), 'video-fallback-card');
    assert.equal(response.headers.get('Content-Type'), 'image/png');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('text-card source uses Cloudflare Images text drawing and PNG output', async () => {
  const source = await read('src/public-indexing-api.js');

  assert.match(source, /width="1200" height="630"/);
  assert.match(source, /env\.IMAGES\.text\('SautiLink'/);
  assert.match(source, /canvas\.draw\(env\.IMAGES\.text/);
  assert.match(source, /output\(\{ format: 'image\/png' \}\)/);
  assert.match(source, /public-post-card/);
  assert.match(source, /servePublicSautiMediaPreview/);
  assert.doesNotMatch(source, /handleSautiMediaRequest\(new Request\(previewUrl/);
});
