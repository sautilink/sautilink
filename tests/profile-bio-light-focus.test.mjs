import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const brandCssPath = new URL('../assets/brand/system.css', import.meta.url);

test('Edit Profile bio stays readable while focused in light mode', async () => {
  const css = await readFile(brandCssPath, 'utf8');

  assert.match(
    css,
    /html\[data-theme="light"\] body \.profile-editor \.profile-form textarea:focus\s*\{[^}]*background:\s*var\(--app-panel\);[^}]*color:\s*var\(--app-text\);[^}]*caret-color:\s*var\(--app-text\);[^}]*-webkit-text-fill-color:\s*var\(--app-text\);[^}]*\}/s,
  );
});
