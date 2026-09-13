import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const downloadPagePath = new URL('../download.html', import.meta.url);
const redirectsPath = new URL('../_redirects', import.meta.url);

test('Android download uses mobile-safe navigation before the release redirect', async () => {
  const [downloadPage, redirects] = await Promise.all([
    readFile(downloadPagePath, 'utf8'),
    readFile(redirectsPath, 'utf8'),
  ]);

  const link = downloadPage.match(/<a class="button" href="\/download\/android"([^>]*)>Download APK<\/a>/);
  assert.ok(link, 'official APK download button must keep the /download/android route');
  assert.doesNotMatch(link[1], /\bdownload\b/i, 'do not force HTML download mode before a cross-origin redirect');
  assert.match(
    redirects,
    /^\/download\/android https:\/\/github\.com\/sautilink\/sautilink\/releases\/download\/android-beta\/SautiLink-Android-Beta\.apk 302$/m,
    'official download route must continue redirecting to the stable signed APK release',
  );
});
