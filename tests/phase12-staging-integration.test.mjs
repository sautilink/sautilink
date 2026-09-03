import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('social app uses the canonical production Supabase account backend', async () => {
  const app = await read('src/app.js');
  const html = await read('app/index.html');
  const bundle = await read('app/assets/app.js');

  assert.match(app, /https:\/\/rggpyiterdbbugluejcs\.supabase\.co/);
  assert.match(app, /sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca/);
  assert.doesNotMatch(app, /bbrydwzlhweuqxpgbahu/);
  assert.doesNotMatch(app, /service_role|sb_secret_/i);
  assert.match(html, /https:\/\/rggpyiterdbbugluejcs\.supabase\.co/);
  assert.doesNotMatch(html, /bbrydwzlhweuqxpgbahu|service_role|sb_secret_/i);
  assert.ok(bundle.includes('https://rggpyiterdbbugluejcs.supabase.co'));
  assert.doesNotMatch(bundle, /bbrydwzlhweuqxpgbahu|sb_secret_[A-Za-z0-9_-]{20,}/i);
  assert.ok(!bundle.includes('\u0000') && !bundle.includes('\uFFFD'), 'built app bundle must be valid UTF-8 JavaScript without binary corruption');
  assert.match(bundle, /^(?:var|let|const|import)\s/, 'built app bundle must start with JavaScript');
});

test('Phase 12 keeps Auth email callbacks inside the session-aware app route', async () => {
  const app = await read('src/app.js');
  const html = await read('app/index.html');
  const router = await read('src/asset-router.js');

  assert.match(app, /APP_HOME_URL = 'https:\/\/sautilink\.com\/home'/);
  assert.match(app, /function authRedirectUrl\(action\)/);
  assert.doesNotMatch(app, /signUp\([\s\S]{0,500}emailRedirectTo:\s*authRedirectUrl\('signup'\)/);
  assert.match(app, /redirectTo: authRedirectUrl\('recovery'\)/);
  assert.match(app, /resolveTokenHashReturn/);
  assert.match(app, /verifyOtp\(\{[\s\S]*email:\s*pendingSignup\.email,[\s\S]*token:\s*code,[\s\S]*type:\s*'email'/);
  assert.match(router, /AUTH_CONFIRM_ROUTE/);
  assert.match(router, /CLEAN_AUTH_ROUTE/);
  assert.match(app, /A new \$\{EMAIL_OTP_LENGTH\}-digit verification code has been sent/);
  assert.match(app, /PENDING_SIGNUP_STORAGE_KEY/);
  const verifyPanel = html.match(/<section id="verify-panel"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(verifyPanel, /8-digit verification code/i);
  assert.doesNotMatch(verifyPanel, /confirmation link/i);
  assert.doesNotMatch(app, /service_role|sb_secret_/i);
});

test('Phase 12 retains generated staging database types', async () => {
  const types = await read('src/types/database.ts');

  for (const table of [
    'social_profiles',
    'social_posts',
    'social_follows',
    'social_circles',
    'social_notifications',
    'dm_conversations',
    'dm_messages',
    'social_reports',
  ]) {
    assert.match(types, new RegExp(`\\b${table}: \\{`));
  }
});

test('Phase 12 remote contract is synthetic and rollback-only', async () => {
  const sql = await read('supabase/tests/phase12_staging_rls.sql');

  assert.match(sql, /begin;/);
  assert.match(sql, /rollback;/);
  assert.match(sql, /example\.invalid/);
  assert.match(sql, /RLS_NOT_FORCED/);
  assert.match(sql, /CROSS_USER_POST_UPDATE_ALLOWED/);
  assert.match(sql, /BLOCKED_DM_INSERT_ALLOWED/);
  assert.doesNotMatch(sql, /rggpyiterdbbugluejcs|@sautilink\.com/);
});


test('Phase 12 waitlist function permits only known SautiLink web origins', async () => {
  const fn = await read('supabase/functions/sautilink-waitlist/index.ts');

  assert.ok(fn.includes('"https://test.sautilink.com"'));
  assert.match(fn, /ORIGIN_NOT_ALLOWED/);
  assert.match(fn, /request\.method === "OPTIONS"/);
  assert.match(fn, /MAX_BODY_BYTES = 4096/);
  assert.match(fn, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(fn, /sb_secret_|service_role\s*[:=]\s*["'][A-Za-z0-9._-]+/i);
});


test('Phase 12 stages the integrated app for the test Worker', async () => {
  const stage = await read('scripts/stage-preview-site.mjs');
  const wrangler = await read('wrangler.social-staging.jsonc');

  assert.match(stage, /\['app', 'app'\]/);
  assert.match(stage, /writeFile\(resolve\(stageRoot, '_headers'\), stagingHeaders\)/);
  assert.match(stage, /https:\/\/rggpyiterdbbugluejcs\.supabase\.co/);
  assert.match(stage, /wss:\/\/rggpyiterdbbugluejcs\.supabase\.co/);
  assert.match(stage, /Content-Security-Policy:.*frame-ancestors 'none'/);
  assert.match(stage, /Cross-Origin-Opener-Policy: same-origin/);
  assert.match(stage, /Permissions-Policy: camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\)/);
  assert.match(stage, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(stage, /Strict-Transport-Security: max-age=31536000; includeSubDomains/);
  assert.match(stage, /X-Content-Type-Options: nosniff/);
  assert.match(stage, /X-Frame-Options: DENY/);
  assert.doesNotMatch(stage, /bbrydwzlhweuqxpgbahu/);
  assert.match(stage, /\['assets\/brand\/logo-compact\.webp', 'assets\/brand\/logo-compact\.webp'\]/);
  assert.match(wrangler, /"test"\s*:\s*\{/);
  assert.match(wrangler, /"directory"\s*:\s*"\.\/dist-preview-site"/);
  assert.match(wrangler, /"pattern"\s*:\s*"test\.sautilink\.com"/);
});
