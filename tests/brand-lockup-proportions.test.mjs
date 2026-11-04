import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('SautiLink artwork stays theme-adaptive with a balanced icon/wordmark lockup', async () => {
  const css = await readFile(new URL('../assets/brand/system.css', import.meta.url), 'utf8');

  // Only the logo lettering is affected; global Inter typography stays untouched.
  assert.match(css, /--font-primary:\s*"Inter"/);
  assert.match(css, /--sautilink-wordmark-image:\s*url\("\/assets\/brand\/sautilink-wordmark-white\.png"\)/);
  assert.match(css, /html\[data-theme="light"\][\s\S]*?sautilink-wordmark-black\.png/);

  // The colored icon and artwork are visually paired instead of separated by
  // the former 10-12px gap, and lettering no longer dominates the icon height.
  assert.match(css, /html body a\.brand,[\s\S]*?html body a\.auth-entry-brand\s*\{\s*gap:\s*5px !important;/);
  assert.match(css, /html body a\.brand > span:first-of-type,[\s\S]*?width:\s*108px;\s*height:\s*23px;/);
  assert.match(css, /html body a\.app-brand > span:first-of-type\s*\{\s*width:\s*112px;\s*height:\s*24px;/);
  assert.match(css, /html body a\.auth-entry-brand > span:first-of-type\s*\{\s*width:\s*118px;\s*height:\s*25px;/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*?gap:\s*4px !important;/);
  assert.match(css, /html body \.mobile-header a\.app-brand > span:first-of-type\s*\{\s*width:\s*98px;\s*height:\s*21px;/);
});
