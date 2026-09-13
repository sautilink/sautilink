import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Android native mode loads only its dedicated performance stylesheet', async () => {
  const themeInit = await read('app/assets/theme-init.js');
  const nativeCss = await read('app/assets/app-native-android.css');

  assert.match(themeInit, /Capacitor\?\.getPlatform\?\.\(\)/);
  assert.match(themeInit, /platform === 'android'/);
  assert.match(themeInit, /native-android/);
  assert.match(themeInit, /app-native-android\.css\?v=20260913-perf1/);

  assert.match(nativeCss, /touch-action:\s*manipulation/);
  assert.match(nativeCss, /content-visibility:\s*auto/);
  assert.match(nativeCss, /contain-intrinsic-size:\s*auto 620px/);
  assert.match(nativeCss, /backdrop-filter:\s*none/);
});

test('social shell uses warm-cache navigation with background refresh', async () => {
  const worker = await read('sw.js');

  assert.match(worker, /sautilink-shell-v51/);
  assert.match(worker, /SOCIAL_ROUTE/);
  assert.match(worker, /staleWhileRevalidate/);
  assert.match(worker, /event\.respondWith\(staleWhileRevalidate\(event, "\/app\/", "\/app\/"\)\)/);
  assert.match(worker, /app-native-android\.css\?v=20260913-perf1/);
  assert.match(worker, /app\.css\?v=20260909-home-loading/);
  assert.match(worker, /app\.js\?v=20260909-authsession4/);
});
