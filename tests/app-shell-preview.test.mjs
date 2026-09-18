import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(projectRoot, path), 'utf8');

async function walk(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else files.push(relative(root, path).replaceAll('\\', '/'));
  }
  return files.sort();
}

test('preview is isolated, noindex and cannot connect to production services', async () => {
  const [wrangler, headers, packageJson] = await Promise.all([
    read('wrangler.preview.toml'),
    read('preview/_headers'),
    read('preview/package.json'),
  ]);

  assert.match(wrangler, /name = "sautilink-ui-preview"/);
  assert.match(wrangler, /compatibility_date = "2026-08-24"/);
  assert.match(wrangler, /directory = "\.preview-dist"/);
  assert.match(wrangler, /not_found_handling = "single-page-application"/);
  assert.match(headers, /X-Robots-Tag: noindex, nofollow, noarchive, nosnippet/);
  assert.match(headers, /default-src 'none'/);
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /form-action 'none'/);
  assert.match(packageJson, /"private": true/);
});

test('preview carries the approved SautiLink product language and surfaces', async () => {
  const sourceFiles = [
    'preview/src/App.jsx',
    'preview/src/data.js',
    'preview/src/views/AppShell.jsx',
    'preview/src/views/Identity.jsx',
    'preview/src/views/Profiles.jsx',
    'preview/src/views/ShareStream.jsx',
    'preview/src/views/Media.jsx',
    'preview/src/views/Conversations.jsx',
    'preview/src/views/TrustSafety.jsx',
  ];
  const sources = (await Promise.all(sourceFiles.map(read))).join('\n');
  for (const expected of ['SautiLink', 'Share a Post', 'Sautify', 'For you', 'Following', 'Profile', 'Messages', 'Short videos']) {
    assert.match(sources, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.doesNotMatch(sources, /Share a Sauti|\bCircles\b/i);
});

test('preview uses restrained design tokens with no decorative gradients', async () => {
  const styles = await read('preview/src/styles.css');
  assert.match(styles, /--background:\s*#080a0d/);
  assert.match(styles, /--accent:\s*#f04452/);
  assert.match(styles, /--border:\s*#272b31/);
  assert.doesNotMatch(styles, /linear-gradient|radial-gradient|conic-gradient/i);
});

test('preview dependencies are pinned and build output stays inside its budget', async () => {
  const packageJson = JSON.parse(await read('preview/package.json'));
  for (const value of Object.values({ ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) })) {
    assert.match(value, /^\d+\.\d+\.\d+$/);
  }

  const budget = JSON.parse(await read('preview/performance-budget.json'));
  assert.equal(budget.budgets.javascript_kb, 500);
  assert.equal(budget.budgets.css_kb, 120);
});

test('seeded preview contains no live account identifiers or external media', async () => {
  const [data, source] = await Promise.all([read('preview/src/data.js'), read('preview/src/App.jsx')]);
  assert.doesNotMatch(`${data}\n${source}`, /drcharlestz|thabitmariam17|@drcharles|@thabit/i);
  assert.doesNotMatch(`${data}\n${source}`, /https?:\/\//i);
});

test('Cloudflare preview stage contains only allowlisted public assets', async () => {
  const stage = resolve(projectRoot, '.preview-dist');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [resolve(projectRoot, 'scripts/stage-preview.mjs')], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const files = await walk(stage);
  assert.ok(files.includes('_headers'));
  assert.ok(files.includes('_redirects'));
  assert.ok(files.includes('sw.js'));
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('app/index.html'));
  assert.ok(files.includes('app/assets/app.css'));
  assert.ok(files.includes('app/assets/app.js'));
  assert.ok(files.includes('logo.png'));
  assert.ok(files.includes('assets/brand/system.css'));
  assert.ok(files.includes('assets/development.css'));
  assert.ok(files.includes('preview/mvp/mvp.css'));
  assert.ok(files.includes('assets/brand/logo-compact.webp'));
  assert.ok(files.some((file) => /^preview\/app-shell\/assets\/index-.*\.js$/.test(file)));
  assert.ok(files.some((file) => /^preview\/app-shell\/assets\/index-.*\.css$/.test(file)));

  const exactAllowed = new Set([
    '_headers',
    '_redirects',
    'sw.js',
    'index.html',
    'app/index.html',
    'app/assets/app.css',
    'app/assets/app.js',
    'app/assets/auth-flow-hardening.css',
    'app/assets/caption-entities.css',
    'app/assets/composer-formats.css',
    'app/assets/conversation-replies-ui.css',
    'app/assets/guest-entry-gate.css',
    'app/assets/messages-composer.css',
    'app/assets/messages-header-polish.css',
    'app/assets/messages-media.css',
    'app/assets/messages-whatsapp.css',
    'app/assets/mobile-nav-icon-style.css',
    'app/assets/mobile-more-drawer.css',
    'app/assets/post-edit.css',
    'app/assets/post-media-carousel.css',
    'app/assets/short-videos-feed.css',
    'app/assets/sautilink-video-player.css',
    'app/assets/professional-profile-category.css',
    'app/assets/professional-dashboard.css',
    'app/assets/profile-activity.css',
    'app/assets/profile-route-states.css',
    'app/assets/profile-social-stats-order.css',
    'app/assets/profile-settings-ui.css',
    'app/assets/profile-x-ui.css',
    'app/assets/rooms.css',
    'app/assets/rooms-facebook.css',
    'app/assets/rooms-mobile-preview.css',
    'app/assets/rooms-invitations.css',
    'app/assets/room-post-images.css',
    'app/assets/settings-light-theme-hotfix.css',
    'app/assets/verified-identity-controls.css',
    'app/assets/theme-init.js',
    'app/assets/verification/verified-team.png',
    'app/assets/verification/verified-user-primary.png',
    'app/assets/verification/verified-user-secondary.png',
    'logo.png',
    'assets/favicon.png',
    'assets/brand/system.css',
    'assets/development.css',
    'assets/brand/logo-compact.webp',
  ]);
  const allowedPrefixes = [
    'assets/fonts/inter/',
    'preview/app-shell/',
    'preview/identity/',
    'preview/profiles/',
    'preview/share-stream/',
    'preview/media/',
    'preview/conversations/',
    'preview/trust-safety/',
    'preview/mvp/',
    'preview/messages/',
    'preview/settings/',
    'preview/backend-foundation/',
  ];
  const unexpected = files.find((file) => !exactAllowed.has(file) && !allowedPrefixes.some((prefix) => file.startsWith(prefix)));
  assert.equal(unexpected, undefined, `unexpected staged file: ${unexpected}`);
});
