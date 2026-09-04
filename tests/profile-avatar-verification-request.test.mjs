import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonical profile photos hydrate notifications, messages and social identity surfaces', async () => {
  const source = await read('src/app.js');

  assert.match(source, /function profileAvatarUrl\(profile\)/);
  assert.match(source, /function renderProfileAvatar\(node, profile, fallbackName = ''\)/);
  assert.match(source, /url\.searchParams\.set\('v', avatarKey\)/);
  assert.match(source, /notification-avatar'[\s\S]{0,180}renderProfileAvatar\(avatar, actor/);
  assert.match(source, /message-inbox-avatar'[\s\S]{0,180}renderProfileAvatar\(avatar, peer/);
  assert.match(source, /renderProfileAvatar\(byId\('message-thread-avatar'\), peer/);
  assert.match(source, /sauti-comment-avatar'[\s\S]{0,180}renderProfileAvatar\(avatar, author/);
  assert.match(source, /discover-profile-avatar'[\s\S]{0,180}renderProfileAvatar\(avatar, profile/);
  assert.match(source, /select\('id, username, display_name, avatar_key, updated_at, is_verified, verification_badge_type'\)/);
  assert.match(source, /social_posts_author_id_fkey\(username, display_name, avatar_key, updated_at/);
  assert.match(source, /social_post_comments_author_id_fkey\(username, display_name, avatar_key, updated_at/);
  assert.match(source, /if \(slot === 'avatar'\) await refreshCurrentMemberAvatar\(\)/);
});

test('avatar fallback never prevents a lazy profile image from loading', async () => {
  const [source, css] = await Promise.all([
    read('src/app.js'),
    read('app/assets/app.css'),
  ]);
  const renderer = source.match(/function renderProfileAvatar\(node, profile, fallbackName = ''\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(renderer, /node\.classList\.add\('profile-avatar-host'\)/);
  assert.match(renderer, /image\.loading = 'lazy'/);
  assert.doesNotMatch(renderer, /image\.hidden = true/);
  assert.match(renderer, /fallback\.hidden = true/);
  assert.match(css, /\.profile-avatar-photo\s*\{[^}]*position:\s*absolute[^}]*opacity:\s*0/s);
  assert.match(css, /\.has-profile-photo \.profile-avatar-photo\s*\{[^}]*opacity:\s*1/s);
});

test('Account settings expose verified status and an accessible verification request dialog', async () => {
  const [html, source, css] = await Promise.all([
    read('app/index.html'),
    read('src/app.js'),
    read('app/assets/app.css'),
  ]);

  for (const id of [
    'settings-verification-status',
    'settings-verification-request',
    'verification-request-dialog',
    'verification-legal-name',
    'verification-famous-name',
    'verification-email',
    'verification-username',
    'verification-category',
    'verification-country',
    'verification-facebook',
    'verification-instagram',
    'verification-tiktok',
    'verification-youtube',
    'verification-articles',
    'verification-reason',
    'verification-consent',
    'verification-request-send',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(html, /returns feedback within 72 hours/i);
  assert.match(html, /Do not send or upload your ID/i);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /id="verification-consent"[^>]*required/);
  assert.match(html, /id="verification-request-send"[^>]*disabled/);
  const requestDialog = html.match(/<dialog class="verification-request-dialog"[\s\S]*?<\/dialog>/)?.[0] || '';
  assert.doesNotMatch(requestDialog, /type="file"/);

  assert.match(source, /status\.textContent = verified \? 'Verified' : 'Unverified'/);
  assert.match(source, /mailto:team@sautilink\.com\?subject=\$\{subject\}&body=\$\{body\}/);
  assert.match(source, /encodeURIComponent\('Verification Badge Request'\)/);
  assert.match(source, /https:\/\/facebook\.com\//);
  assert.match(source, /https:\/\/instagram\.com\//);
  assert.match(source, /https:\/\/tiktok\.com\/@/);
  assert.match(source, /https:\/\/youtube\.com\/@/);
  assert.match(css, /\.verification-request-dialog::backdrop[^}]*backdrop-filter:\s*blur\(7px\)/s);
  assert.match(css, /\.verification-request-form \.form-submit:disabled[^}]*background:\s*#59616c/);
});
