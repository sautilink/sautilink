import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Home offers a persistent dark and light theme without a startup flash', async () => {
  const [html, source, themeInit, css] = await Promise.all([
    read('app/index.html'),
    read('src/app.js'),
    read('app/assets/theme-init.js'),
    read('app/assets/app.css'),
  ]);

  assert.match(html, /theme-init\.js\?v=20260904-account2/);
  assert.ok((html.match(/data-theme-toggle/g) || []).length >= 2);
  assert.match(themeInit, /sautilink\.theme/);
  assert.match(themeInit, /prefers-color-scheme: light/);
  assert.match(source, /const THEME_STORAGE_KEY = 'sautilink\.theme'/);
  assert.match(source, /localStorage\.setItem\(THEME_STORAGE_KEY, theme\)/);
  assert.match(source, /function toggleTheme\(\)/);
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /--app-bg: #000000/);
  assert.match(css, /--app-bg: #f6f7f9/);
  assert.match(css, /\.theme-toggle-moon/);
});

test('Home Sauti cards use a media-first viewer with compact expandable captions', async () => {
  const [source, css] = await Promise.all([
    read('src/app.js'),
    read('app/assets/app.css'),
  ]);

  assert.match(source, /const CAPTION_PREVIEW_LIMIT = 180/);
  assert.match(source, /function createSautiCaption\(authorProfile, value\)/);
  assert.match(source, /toggle\.dataset\.captionToggle = ''/);
  assert.match(source, /button\.textContent = expanded \? 'more' : 'less'/);
  assert.match(source, /card\?\.classList\.add\('has-media'\)/);
  assert.match(source, /gallery\.style\.setProperty\('--single-media-aspect-ratio'/);

  const actionStart = source.indexOf('actions.append(', source.indexOf('function createSautiCard'));
  const actionEnd = source.indexOf(');', actionStart);
  const actionBlock = source.slice(actionStart, actionEnd);
  const order = ['like', 'comments', 'repost', 'share', 'save'].map((action) => actionBlock.indexOf(`'${action}'`));
  assert.ok(order.every((position) => position >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);

  assert.match(css, /--stream-width: 680px/);
  assert.match(css, /\.sauti-card\.has-media \.sauti-card-body\s*\{\s*display: none/);
  assert.match(css, /\.media-count-1 \.sauti-media-tile[\s\S]*aspect-ratio: var\(--single-media-aspect-ratio/);
  assert.match(css, /\.sauti-caption-author[\s\S]*font-weight: 780/);
  assert.match(css, /\.sauti-action\[data-sauti-action="save"\][\s\S]*margin-left: auto/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.sauti-card[\s\S]*border-radius: 0/);
});

test('Home redesign preserves the approved verification badge contract and offline shell', async () => {
  const [css, sw] = await Promise.all([
    read('app/assets/app.css'),
    read('sw.js'),
  ]);

  assert.match(css, /\.sauti-card-head\s*\{\s*--verification-badge-size: clamp\(14px, 1\.25em, 16px\);\s*\}/);
  assert.match(css, /\.sauti-card-head \.verified-name \{ font-size: 12px; \}/);
  assert.match(sw, /sautilink-shell-v42/);
  assert.match(sw, /"\/app\/assets\/theme-init\.js"/);
});

test('Home videos autoplay only in view and pause when the viewer or page is hidden', async () => {
  const source = await read('src/app.js');

  assert.match(source, /const HOME_VIDEO_VISIBILITY_THRESHOLD = 0\.58/);
  assert.match(source, /new IntersectionObserver\([\s\S]*HOME_VIDEO_VISIBILITY_THRESHOLD/);
  assert.match(source, /if \(!gallery\.closest\('#stream-feed'\)\) return/);
  assert.match(source, /video\.defaultMuted = true/);
  assert.match(source, /video\.autoplay = true/);
  assert.match(source, /video\.loop = true/);
  assert.match(source, /document\.visibilityState === 'hidden'/);
  assert.match(source, /if \(video !== activeVideo\) video\.pause\(\)/);
  assert.match(source, /visual\.controls = true;[\s\S]*visual\.autoplay = false/);
});

test('Home supports double tap to like without turning an existing like off', async () => {
  const [source, css] = await Promise.all([
    read('src/app.js'),
    read('app/assets/app.css'),
  ]);

  assert.match(source, /const HOME_DOUBLE_TAP_WINDOW = 320/);
  assert.match(source, /function handleHomeFeedPointerUp\(event\)/);
  assert.match(source, /byId\('stream-feed'\)\.addEventListener\('pointerup', handleHomeFeedPointerUp\)/);
  assert.match(source, /if \(likeButton\.dataset\.active !== 'true'\) void toggleLike\(card, likeButton\)/);
  assert.match(source, /homeMediaOpenTimers\.delete\(media\)/);
  assert.match(source, /openHomeMediaAfterTap\(event, media\)/);
  assert.match(css, /\.sauti-card[\s\S]*touch-action: manipulation/);
  assert.match(css, /\.sauti-double-tap-heart[\s\S]*pointer-events: none/);
  assert.match(css, /@keyframes sauti-heart-pop/);
});
