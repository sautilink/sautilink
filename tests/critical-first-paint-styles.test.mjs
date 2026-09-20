import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const criticalStyles = [
  ['social-oauth-auth-styles', 'guest-entry-gate.css'],
  ['auth-entry-polish-styles', 'auth-entry-polish.css'],
  ['username-prefix-fix-styles', 'username-prefix-fix.css'],
  ['sautilink-mobile-nav-style', 'mobile-nav-icon-style.css'],
  ['sautilink-caption-entities-style', 'caption-entities.css'],
  ['sautilink-post-media-carousel-style', 'post-media-carousel.css'],
  ['sautilink-video-player-style', 'sautilink-video-player.css'],
];

test('Auth and Home final presentation styles block the first paint', async () => {
  const html = await read('app/index.html');
  const appStyles = html.indexOf('/app/assets/app.css');
  const appScript = html.indexOf('/app/assets/app.js');

  assert.ok(appStyles >= 0);
  assert.ok(appScript > appStyles);

  for (const [id, filename] of criticalStyles) {
    const link = new RegExp(`<link[^>]+id="${id}"[^>]+href="[^"]*${filename.replaceAll('.', '\\.')}[^"]*"[^>]*>`).exec(html);
    assert.ok(link, `${filename} must be eagerly linked with ${id}`);
    assert.ok(link.index > appStyles, `${filename} must follow the base app stylesheet`);
    assert.ok(link.index < appScript, `${filename} must load before the app module`);
  }
});

test('runtime enhancers reuse content-hashed first-paint Home stylesheets by stable id', async () => {
  const [mobileNav, carousel, video, caption] = await Promise.all([
    read('src/mobile-nav-icon-style.js'),
    read('src/post-media-carousel.js'),
    read('src/sautilink-video-player.js'),
    read('src/caption-entities.js'),
  ]);

  for (const [source, constant, id] of [
    [mobileNav, 'MOBILE_NAV_STYLE_ID', 'sautilink-mobile-nav-style'],
    [carousel, 'POST_MEDIA_CAROUSEL_STYLESHEET_ID', 'sautilink-post-media-carousel-style'],
    [video, 'SAUTILINK_VIDEO_PLAYER_STYLESHEET_ID', 'sautilink-video-player-style'],
    [caption, 'ENTITY_STYLESHEET_ID', 'sautilink-caption-entities-style'],
  ]) {
    assert.match(source, new RegExp(`const ${constant} = '${id}'`));
    assert.match(source, new RegExp(`getElementById\\(${constant}\\)`));
  }
});

test('production builder does not append a duplicate post media stylesheet', async () => {
  const build = await read('scripts/build-production-release.mjs');
  assert.match(build, /if \(!output\.includes\('\/app\/assets\/post-media-carousel\.css'\)\)/);
});
