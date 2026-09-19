import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = resolve(projectRoot, 'dist-production-site');
const assetRoot = resolve(siteRoot, 'app/assets');
const appHtml = await readFile(resolve(siteRoot, 'app/index.html'), 'utf8');
const appJs = await readFile(resolve(assetRoot, 'app.js'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(assetRoot, 'ui-asset-versions.json'), 'utf8'));

function contentHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

for (const required of ['profile-x-ui.css', 'profile-settings-ui.css']) {
  const css = await readFile(resolve(assetRoot, required));
  const expected = contentHash(css);
  assert.equal(manifest[required], expected, `${required} manifest hash does not match file content`);
  const reference = `/app/assets/${required}?v=${expected}`;
  assert.ok(appHtml.includes(reference) || appJs.includes(reference), `${required} is not referenced with its content hash`);
}

for (const [name, version] of Object.entries(manifest)) {
  assert.match(version, /^[a-f0-9]{12}$/, `${name} has an invalid content hash`);
  assert.doesNotMatch(appHtml, new RegExp(`/app/assets/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?v=(?!${version})[A-Za-z0-9._-]+`), `${name} has a stale HTML version`);
  assert.doesNotMatch(appJs, new RegExp(`/app/assets/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?v=(?!${version})[A-Za-z0-9._-]+`), `${name} has a stale JS version`);
}

assert.doesNotMatch(appHtml, /profile-(?:x|settings)-ui\.css\?v=20260918-profile2/);
assert.doesNotMatch(appJs, /profile-x-ui\.css\?v=20260918-profile2/);

console.log(`Verified ${Object.keys(manifest).length} content-hashed production UI stylesheets.`);
