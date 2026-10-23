import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function contentHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

export async function verifyProductionUiAssetHashes(siteRoot) {
  const assetRoot = resolve(siteRoot, 'app/assets');
  const appHtml = await readFile(resolve(siteRoot, 'app/index.html'), 'utf8');
  const manifest = JSON.parse(await readFile(resolve(assetRoot, 'ui-asset-versions.json'), 'utf8'));
  const sourceFiles = new Map([['app/index.html', appHtml]]);
  async function codeAssets(prefix = '') {
    const names = [];
    for (const entry of await readdir(resolve(assetRoot, prefix), { withFileTypes: true })) {
      if (entry.isDirectory()) names.push(...await codeAssets(prefix + entry.name + '/'));
      else if (entry.isFile() && /\.(?:css|js)$/.test(entry.name)) names.push(prefix + entry.name);
    }
    return names.sort();
  }
  const codeNames = await codeAssets();
  assert.deepEqual(Object.keys(manifest).sort(), codeNames, 'manifest must describe every UI code asset exactly');
  for (const [name, version] of Object.entries(manifest)) {
    assert.match(name, /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9._-]+\.(?:css|js)$/, 'manifest asset is outside UI code scope');
    assert.match(version, /^[a-f0-9]{12}$/, `${name} has an invalid content hash`);
    const content = await readFile(resolve(assetRoot, name));
    assert.equal(version, contentHash(content), `${name} manifest hash does not match final file content`);
    sourceFiles.set(name, content.toString('utf8'));
  }
  for (const required of ['app.js', 'app.css', 'profile-x-ui.css', 'profile-settings-ui.css']) {
    assert.ok(manifest[required], `${required} is missing from the version manifest`);
    const reference = `/app/assets/${required}?v=${manifest[required]}`;
    assert.ok(appHtml.includes(reference) || sourceFiles.get('app.js').includes(reference), `${required} is not referenced with its content hash`);
  }
  for (const [sourceName, source] of sourceFiles) {
    for (const match of source.matchAll(/\/app\/assets\/((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9._-]+\.(?:css|js))(?:\?([A-Za-z0-9._%=&;-]+))?/g)) {
      const [, name, query = ''] = match;
      if (!manifest[name]) continue;
      const params = new URLSearchParams(query.replaceAll('&amp;', '&'));
      assert.equal(params.getAll('v').length, 1, `${sourceName} must reference ${name} with exactly one version`);
      assert.equal(params.get('v'), manifest[name], `${sourceName} has a stale ${name} version`);
    }
  }
  return Object.keys(manifest).length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await verifyProductionUiAssetHashes(resolve(projectRoot, 'dist-production-site'));
  console.log(`Verified ${count} content-hashed production UI stylesheets and scripts against final bytes.`);
}
