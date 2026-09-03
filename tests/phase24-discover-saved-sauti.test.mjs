import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 24 activates Discover and private Saved surfaces without decorative redesign', async () => {
  const html = await read('app/index.html');
  const css = await read('app/assets/app.css');

  for (const marker of [
    'data-member-view="discover"',
    'data-member-view="saved"',
    'id="discover-surface"',
    'id="discover-query"',
    'id="discover-profile-list"',
    'id="discover-sauti-feed"',
    'id="saved-surface"',
    'id="saved-sauti-feed"',
  ]) {
    assert.ok(html.includes(marker), `missing Phase 24 UI marker: ${marker}`);
  }

  assert.doesNotMatch(html, /data-preview-nav="saved"/);
  const phase = Number(html.match(/name="sautilink-release-generation" content="([0-9]+)"/)?.[1] || 0);
  assert.ok(phase >= 24, `app milestone regressed below Phase 24: ${phase}`);
  const cssVersion = Number(html.match(/app\.css\?v=([0-9]+)/)?.[1] || 0);
  const jsVersion = Number(html.match(/app\.js\?v=([0-9]+)/)?.[1] || 0);
  assert.ok(cssVersion >= 24, `app CSS version regressed below Phase 24: ${cssVersion}`);
  assert.equal(jsVersion, cssVersion);
  assert.match(css, /\.discover-surface/);
  assert.match(css, /\.saved-surface/);
  assert.match(css, /\.discover-profile-row/);
  assert.doesNotMatch(css, /mobile-nav button:nth-child\(4\) svg[^}]*background:\s*#2563eb/s);
});

test('Phase 24 Saved Sauti database contract is private and least-privilege', async () => {
  const sql = await read('supabase/migrations/20260901182000_enable_phase24_saved_sauti.sql');

  assert.match(sql, /create table if not exists public\.social_saved_posts/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on table public\.social_saved_posts from public, anon, authenticated/i);
  assert.match(sql, /grant select, delete on table public\.social_saved_posts to authenticated/i);
  assert.match(sql, /grant insert \(user_id, post_id\)/i);
  assert.match(sql, /social_saved_posts_select_own_phase24/i);
  assert.match(sql, /social_saved_posts_insert_own_phase24/i);
  assert.match(sql, /social_saved_posts_delete_own_phase24/i);
  assert.match(sql, /auth\.uid\(\).*user_id/is);
  assert.match(sql, /exists \([\s\S]*public\.social_posts post/i);
});

test('Phase 24 Sauti cards expose icon-first Comment, Repost, Like, Save and Share actions', async () => {
  const source = await read('src/app.js');
  const css = await read('app/assets/app.css');

  for (const action of ['comments', 'repost', 'like', 'save', 'share']) {
    assert.ok(source.includes(`interactionButton('${action}'`), `missing core Sauti action: ${action}`);
  }

  assert.match(source, /function sautiActionIcon/);
  assert.match(source, /function toggleSave/);
  assert.match(source, /function shareSautiLink/);
  assert.match(source, /navigator\.share/);
  assert.match(source, /navigator\.clipboard/);
  assert.match(source, /sautiShareUrl/);
  assert.match(css, /\.sauti-action svg/);
  assert.match(css, /data-sauti-action="save"/);
});

test('Phase 24 Discover and Saved use live RLS-backed data and shareable Sauti targets', async () => {
  const source = await read('src/app.js');
  const router = await read('src/asset-router.js');

  for (const marker of [
    'loadDiscover',
    'loadSavedSauti',
    'hydrateDirectPosts',
    "from('social_saved_posts')",
    "from('social_profiles')",
    "from('social_posts')",
    'readSharedSautiTarget',
    'loadSharedSautiTarget',
  ]) {
    assert.ok(source.includes(marker), `source missing Phase 24 marker: ${marker}`);
  }

  assert.match(router, /DISCOVER_ROUTE/);
  assert.match(router, /SAVED_ROUTE/);
  assert.match(source, /function conversationPath\(postId\)/);
  assert.match(source, /new URL\(conversationPath\(postId\), window\.location\.origin\)/);
  assert.doesNotMatch(source, /service_role|sb_secret_|SUPABASE_SECRET/i);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('Phase 24 records durable operating rules and open-source donor intake', async () => {
  const checkpoint = await read('docs/architecture/project-operating-checkpoint.md');

  assert.match(checkpoint, /durable (?:source-of-truth )?handoff/i);
  assert.match(checkpoint, /merge (?:the PR |automatically )?without asking (?:for another approval|again)/i);
  assert.match(checkpoint, /reuse before reinventing/i);
  assert.match(checkpoint, /Bluesky/);
  assert.match(checkpoint, /Mastodon/);
  assert.match(checkpoint, /Lemmy/);
  assert.match(checkpoint, /Comment[\s\S]*Repost[\s\S]*Like[\s\S]*Save[\s\S]*Share/);
});

test('Phase 24 rotates the service worker cache beyond Phase 23', async () => {
  const sw = await read('sw.js');
  const version = Number(sw.match(/sautilink-shell-v([0-9]+)/)?.[1] || 0);
  assert.ok(version >= 14, `service worker cache regressed below Phase 24: ${version}`);
});
