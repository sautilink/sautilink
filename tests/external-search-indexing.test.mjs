import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { handlePublicIndexingRoutes } from '../src/public-indexing-routes.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const shell = '<!doctype html><html><head><meta name="robots" content="noindex, nofollow"><title>SautiLink App</title><meta name="description" content="Sign in"></head><body><main>App shell</main></body></html>';
const env = {
  ASSETS: {
    fetch: async () => new Response(shell, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  },
};

function rpcFetch(resolver) {
  return async (input, init = {}) => {
    const url = String(input);
    assert.match(url, /\/rest\/v1\/rpc\//);
    return new Response(JSON.stringify(resolver(url, init) ?? []), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

test('database migration keeps base posts private while exposing narrow indexing RPCs', async () => {
  const sql = await read('supabase/migrations/20260912194500_enable_external_search_indexing.sql');
  assert.match(sql, /security definer/gi);
  assert.match(sql, /profile\.is_discoverable = true/);
  assert.match(sql, /profile\.allow_external_indexing = true/);
  assert.match(sql, /post\.visibility = 'public'/);
  assert.match(sql, /post\.post_status = 'published'/);
  assert.match(sql, /post\.deleted_at is null/);
  assert.match(sql, /post\.moderation_state = 'visible'/);
  assert.match(sql, /audience_owner\.allow_external_indexing = true/);
  assert.match(sql, /deletion\.status = 'pending'/);
  assert.doesNotMatch(sql, /grant\s+select\s+on\s+table\s+public\.social_posts\s+to\s+anon/i);
  assert.match(sql, /grant execute on function public\.external_index_post_v1\(uuid\) to anon, authenticated/);
});

test('opted-in verified profile receives canonical index metadata and structured verification signal', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rpcFetch((url) => {
    if (!url.includes('external_index_profile_v1')) return [];
    return [{
      username: 'drcharlestz',
      display_name: 'Dr. Charles',
      bio: 'Public profile biography.',
      website_url: 'https://example.com/',
      location: 'Tanzania',
      avatar_key: 'profiles/example/avatar.png',
      updated_at: '2026-09-12T19:00:00Z',
      followers_count: 42,
      is_verified: true,
      verification_badge_type: 'standard',
    }];
  });

  try {
    const response = await handlePublicIndexingRoutes(new Request('https://sautilink.com/u/drcharlestz'), env);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('X-Robots-Tag') || '', /^index, follow/);
    const html = await response.text();
    assert.match(html, /Official Verified Profile on SautiLink/);
    assert.match(html, /rel="canonical" href="https:\/\/sautilink\.com\/u\/drcharlestz"/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /SautiLink verification/);
    assert.match(html, /Public profile biography/);
    assert.match(html, /api\/profile-media\/drcharlestz\/avatar/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('profile that is not returned by privacy RPC remains noindex without leaking metadata', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rpcFetch(() => []);

  try {
    const response = await handlePublicIndexingRoutes(new Request('https://sautilink.com/u/privateperson'), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
    const html = await response.text();
    assert.doesNotMatch(html, /canonical/);
    assert.doesNotMatch(html, /application\/ld\+json/);
    assert.doesNotMatch(html, /Official Verified Profile/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public opted-in post receives crawlable metadata while app legacy permalink stays noindex', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rpcFetch((url) => {
    if (!url.includes('external_index_post_v1')) return [];
    return [{
      post_id: '123e4567-e89b-42d3-a456-426614174000',
      body: 'This is a public SautiLink post for search indexing.',
      created_at: '2026-09-12T18:00:00Z',
      updated_at: '2026-09-12T18:30:00Z',
      media_count: 0,
      like_count: 5,
      comment_count: 2,
      repost_count: 1,
      author_username: 'drcharlestz',
      author_display_name: 'Dr. Charles',
      author_avatar_key: null,
      author_is_verified: true,
      author_verification_badge_type: 'standard',
    }];
  });

  try {
    const publicResponse = await handlePublicIndexingRoutes(
      new Request('https://sautilink.com/post/123e4567-e89b-42d3-a456-426614174000'),
      env,
    );
    assert.match(publicResponse.headers.get('X-Robots-Tag') || '', /^index, follow/);
    const html = await publicResponse.text();
    assert.match(html, /This is a public SautiLink post for search indexing/);
    assert.match(html, /SocialMediaPosting/);
    assert.match(html, /https:\/\/sautilink\.com\/post\/123e4567-e89b-42d3-a456-426614174000/);

    const legacyResponse = await handlePublicIndexingRoutes(
      new Request('https://sautilink.com/app/sauti/123e4567-e89b-42d3-a456-426614174000'),
      env,
    );
    assert.equal(legacyResponse.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('social sitemap uses existing API Worker route and keeps verified records ordered by the database projection', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rpcFetch((url) => {
    if (url.includes('external_index_sitemap_counts_v1')) return [{ profile_count: 1, post_count: 1 }];
    if (url.includes('external_index_profiles_page_v1')) {
      return [{ username: 'drcharlestz', updated_at: '2026-09-12T19:00:00Z', is_verified: true }];
    }
    if (url.includes('external_index_posts_page_v1')) {
      return [{ post_id: '123e4567-e89b-42d3-a456-426614174000', updated_at: '2026-09-12T18:30:00Z', author_is_verified: true }];
    }
    return [];
  });

  try {
    const index = await handlePublicIndexingRoutes(new Request('https://sautilink.com/api/public-index/sitemap.xml'), env);
    const indexXml = await index.text();
    assert.match(indexXml, /api\/public-index\/profiles\.xml\?page=1/);
    assert.match(indexXml, /api\/public-index\/posts\.xml\?page=1/);
    assert.doesNotMatch(indexXml, /sitemap-social-profiles/);

    const profiles = await handlePublicIndexingRoutes(new Request('https://sautilink.com/api/public-index/profiles.xml?page=1'), env);
    assert.match(await profiles.text(), /https:\/\/sautilink\.com\/u\/drcharlestz/);

    const posts = await handlePublicIndexingRoutes(new Request('https://sautilink.com/api/public-index/posts.xml?page=1'), env);
    assert.match(await posts.text(), /https:\/\/sautilink\.com\/post\/123e4567-e89b-42d3-a456-426614174000/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('staging remains globally noindex and public sitemap discovery is wired from the root files', async () => {
  const response = await handlePublicIndexingRoutes(new Request('https://test.sautilink.com/u/drcharlestz'), env);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');

  const robots = await read('robots.txt');
  const sitemap = await read('sitemap.xml');
  const staticSitemap = await read('sitemap-static.xml');
  const workerEntry = await read('src/worker-entry.js');

  assert.match(robots, /Allow: \/api\/public-index\//);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/sautilink\.com\/sitemap\.xml/);
  assert.match(sitemap, /<sitemapindex/);
  assert.match(sitemap, /https:\/\/sautilink\.com\/api\/public-index\/sitemap\.xml/);
  assert.match(staticSitemap, /https:\/\/sautilink\.com\/privacy/);
  assert.match(workerEntry, /handlePublicIndexingRoutes/);
});
