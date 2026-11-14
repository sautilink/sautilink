import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const previewUrl = new URL('../android-app-preview.html', import.meta.url);
test('official Android preview offers indexable, useful content linked to Google Play', async () => {
  const html = await readFile(previewUrl, 'utf8');
  assert.equal(html.split('<h1 ').length - 1, 1, 'only one H1 should be present');
  assert.ok(html.includes('rel="canonical" href="https://sautilink.com/android-app-preview"'));
  assert.ok(html.includes('name="robots" content="index, follow'));
  assert.ok(html.includes('id="android-features-title"'));
  assert.ok(html.includes('id="android-install-title"'));
  assert.ok(html.includes('https://play.google.com/store/apps/details?id=com.sautilink.app'));
  assert.ok(html.includes('href="/download"'));
  assert.doesNotMatch(html, /Android beta APK|not yet listed on Google Play/i);
});
