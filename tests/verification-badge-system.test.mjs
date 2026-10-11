import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  html,
  css,
  app,
  vectorSource,
  migration,
  hardening,
  badgeTypes,
] = await Promise.all([
  readFile(new URL('../app/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app/assets/app.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/verification-inline-svg.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260903044000_enable_verification_management.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260903044500_harden_verification_management.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260903104500_enable_verification_badge_types.sql', import.meta.url), 'utf8'),
]);

test('original SautiLink badge vector is generated inline without image URLs', () => {
  assert.match(vectorSource, /const BADGE_PATH =/);
  assert.match(vectorSource, /M988 426 L963 433/);
  assert.match(vectorSource, /createElementNS\(SVG_NS, name\)/);
  assert.match(vectorSource, /replaceChildren\(createInlineVerificationSvg\(badgeType\)\)/);
  assert.match(vectorSource, /#28a9e3/);
  assert.match(vectorSource, /#ffffff/);
  assert.match(vectorSource, /#fa1f56/);
  assert.match(vectorSource, /#fb873f/);
  assert.match(app, /mountInlineVerificationSvg\(image, normalizedType\)/);
  assert.match(app, /mountInlineVerificationSvg\(byId\('verification-info-badge-image'\), badgeType\)/);
  assert.doesNotMatch(app, /\/app\/assets\/verification\/verified-(?:team|user-primary|user-secondary)\.(?:svg|png)/);
  assert.match(css, /\.verification-badge svg\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/);
  assert.match(html, /data-verification-badge-image/);
  assert.match(html, /<span id="verification-info-badge-image"/);
});

test('inline badge vectors contain no remote assets or executable SVG markup', () => {
  assert.doesNotMatch(vectorSource, /<script|<foreignObject|\.src\s*=|fetch\(/i);
  assert.match(vectorSource, /'aria-hidden': 'true'/);
  assert.match(vectorSource, /focusable: 'false'/);
});

test('verification badge size stays balanced with the local display-name typography', () => {
  assert.match(css, /\.profile-name-line\s*\{[\s\S]*--verification-badge-size:\s*clamp\(21px, \.9em, 23px\)[\s\S]*gap:\s*\.22em[\s\S]*font-size:\s*25px/);
  assert.match(css, /\.sauti-card-head\s*\{\s*--verification-badge-size:\s*clamp\(14px, 1\.25em, 16px\)/);
  assert.match(css, /\.sauti-comment-head\s*\{\s*--verification-badge-size:\s*clamp\(10px, 1\.22em, 12px\)/);
  assert.match(css, /\.sauti-quote-head\s*\{\s*--verification-badge-size:\s*clamp\(11px, 1\.2em, 13px\)/);
  assert.match(css, /\.discover-profile-heading\s*\{\s*--verification-badge-size:\s*clamp\(12px, 1\.25em, 15px\)/);
  assert.match(css, /\.notification-copy\s*\{\s*--verification-badge-size:\s*clamp\(13px, 1\.2em, 15px\)/);
  assert.match(css, /\.message-inbox-top\s*\{\s*--verification-badge-size:\s*clamp\(12px, 1\.2em, 14px\)/);
  assert.match(css, /\.message-thread-person\s*\{\s*--verification-badge-size:\s*clamp\(12px, 1\.2em, 14px\)/);
  assert.match(css, /\.circle-request-person,[\s\S]*\.circle-member-person\s*\{\s*--verification-badge-size:\s*12px/);
  assert.match(css, /\.sauti-caption-author\s*\{\s*--verification-badge-size:\s*clamp\(14px, \.95em, 15px\)/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.profile-name-line\s*\{\s*font-size:\s*22px/);
  assert.match(css, /\.profile-heading h2\s*\{[^}]*font-size:\s*1em/);
  assert.doesNotMatch(css, /\.profile-verified-badge\s*\{\s*font-size:\s*\d+px/);
});

test('verification badge spacing and artwork follow the active theme', () => {
  assert.match(css, /\.verified-name\s*\{[\s\S]*gap:\s*\.25em/);
  assert.match(css, /\.inline-verified-name\s*\{[\s\S]*gap:\s*\.25em/);
  assert.match(css, /\.verified-name > strong\s*\{[\s\S]*color:\s*inherit !important/);
  assert.match(vectorSource, /theme !== 'light'/);
  assert.match(app, /function applyTheme[\s\S]*syncVerificationBadgeAssets\(\)/);
});

test('light theme keeps identity and content text readable across social surfaces', () => {
  assert.match(css, /:root\[data-theme="light"\] \.profile-heading h2,[\s\S]*\.notification-copy \.verified-name,[\s\S]*\.message-inbox-top \.verified-name,[\s\S]*\.circle-request-person strong,[\s\S]*color:\s*var\(--app-text\)/);
  assert.match(css, /:root\[data-theme="light"\] \.profile-card,[\s\S]*\.circle-detail-card,[\s\S]*\.settings-card,[\s\S]*background:\s*var\(--app-panel\)/);
  assert.match(css, /:root\[data-theme="light"\] \.profile-social-stats,[\s\S]*\.notification-copy p,[\s\S]*\.message-inbox-preview,[\s\S]*color:\s*var\(--app-muted\)/);
});

test('profile verification badge opens owner-aware and viewer-aware information', () => {
  assert.match(html, /id="profile-verified-badge"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /id="verification-info-dialog"/);
  assert.match(html, /id="verification-team-wordmark"[^>]*>SautiLink Team</);
  assert.match(app, /function openVerificationInfoDialog/);
  assert.match(app, /This profile was verified as belonging to \$\{displayName\}\./);
  assert.match(app, /a member of the SautiLink Team/);
  assert.match(app, /Verification may be removed at any time if you violate SautiLink rules or policies/);
  assert.match(app, /This profile is verified as a SautiLink Team profile/);
});

test('verified state and badge type are hydrated on core social name surfaces', () => {
  assert.match(app, /function createVerificationBadge/);
  assert.match(app, /function verifiedNameNode/);
  assert.match(app, /social_posts_author_id_fkey\(username, display_name, avatar_key, updated_at, is_discoverable, is_verified, verification_badge_type\)/);
  assert.match(app, /social_post_comments_author_id_fkey\(username, display_name, avatar_key, updated_at, is_discoverable, is_verified, verification_badge_type\)/);
  assert.match(app, /bio, avatar_key, updated_at, is_verified, verification_badge_type, followers_count/);
  assert.match(app, /verifiedNameNode\(displayName, Boolean\(author\.is_verified\), author\.verification_badge_type\)/);
  assert.match(app, /quotedAuthor\.verification_badge_type/);
  assert.match(app, /verifiedNameNode\(displayName, Boolean\(profile\.is_verified\), profile\.verification_badge_type\)/);
});


test('official verification badges stay consistent in notifications and messages', () => {
  assert.match(app, /select\('id, username, display_name, avatar_key, updated_at, is_verified, verification_badge_type'\)\.in\('id', actorIds\)/);
  assert.match(app, /verifiedNameNode\(actorText, Boolean\(actor\.is_verified\), actor\.verification_badge_type\)/);
  assert.match(app, /select\('id, username, display_name, avatar_key, updated_at, is_verified, verification_badge_type'\)[\s\S]{0,120}\.in\('id', peerIds\)/);
  assert.match(app, /Boolean\(peer\?\.is_verified\)[\s\S]{0,100}peer\?\.verification_badge_type/);
  assert.match(app, /threadName\.append\(createVerificationBadge/);
  assert.match(css, /\.notification-copy \.verified-name\s*\{[^}]*font-size:\s*12px/);
  assert.match(css, /\.message-inbox-top \.verified-name\s*\{\s*font-size:\s*11px/);
  assert.match(css, /#message-thread-name\.verified\s*\{[^}]*display:\s*inline-flex/);
});

test('verified identity propagates across reposts, navigation, settings and Sautify', () => {
  assert.match(app, /function inlineVerifiedNameNode/);
  assert.match(app, /function setInlineVerifiedName/);
  assert.match(app, /createSautiCaption\(post\.body\)/);
  assert.match(app, /item\.actor\.is_verified[\s\S]{0,120}item\.actor\.verification_badge_type/);
  assert.match(app, /setInlineVerifiedName\(byId\('rail-name'\), displayName, currentMember\)/);
  assert.match(app, /select\('id,username,display_name,avatar_key,updated_at,is_verified,verification_badge_type'\)/);
  assert.match(app, /select\('id, username, display_name, is_verified, verification_badge_type'\)[\s\S]{0,80}\.in\('id', ids\)/);
  assert.match(app, /function loadCircleOwnerProfile[\s\S]{0,260}is_verified, verification_badge_type/);
  assert.match(app, /setInlineVerifiedName\([\s\S]{0,120}profile\?\.display_name[\s\S]{0,120}profile/);
});

test('team badge assignment is server-controlled and audited', () => {
  assert.match(migration, /private\.social_verification_events/);
  assert.match(hardening, /security invoker/);
  assert.match(badgeTypes, /verification_badge_type text not null default 'standard'/);
  assert.match(badgeTypes, /'standard'::text, 'team'::text/);
  assert.match(badgeTypes, /revoke update \(verification_badge_type\).*from anon, authenticated/s);
  assert.match(badgeTypes, /private\.set_social_verification_privileged_v2/);
  assert.match(badgeTypes, /private\.phase29_staff_role\(\)/);
  assert.match(badgeTypes, /staff_role <> 'senior_reviewer'/);
  assert.match(badgeTypes, /previous_badge_type/);
  assert.match(badgeTypes, /new_badge_type/);
  assert.match(badgeTypes, /create or replace function public\.set_social_verification_badge/);
  assert.match(badgeTypes, /security invoker/);
  assert.match(badgeTypes, /revoke all on function public\.set_social_verification_badge/);
});
