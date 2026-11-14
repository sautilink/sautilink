import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const previewUrl = new URL('../android-app-preview.html', import.meta.url);
test('official Android preview offers indexable, useful content linked to Google Play', async () => {
  const html = await readFile(previewUrl, 'utf8');
  assert.equal((html.match(/<h1\\b/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\\/\\/sautilink\\.com\\/android-app-preview">/);
  assert.match(html, /name="robots" content="index, follow/);
  assert.match(html, /id="android-features-title"/);
  assert.match(html, /id="android-install-title"/);
  assert.match(html, /https:\\/\\/play\\.google\\.com\\/store\\/apps\\/details\\?id=com\\.sautilink\\.app/);
  assert.match(html, /href="\\/download"/);
  assert.doesNotMatch(html, /Android beta APK|not yet listed on Google Play/i);
});
