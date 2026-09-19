import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = resolve(projectRoot, 'dist-production-site');
const assetRoot = resolve(siteRoot, 'app/assets');
const appHtmlPath = resolve(siteRoot, 'app/index.html');
const appJsPath = resolve(assetRoot, 'app.js');
const manifestPath = resolve(assetRoot, 'ui-asset-versions.json');

function contentHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

const versions = new Map();
for (const name of await readdir(assetRoot)) {
  if (!name.endsWith('.css') || name === 'app.css') continue;
  const content = await readFile(resolve(assetRoot, name));
  versions.set(name, contentHash(content));
}

if (!versions.has('profile-x-ui.css') || !versions.has('profile-settings-ui.css')) {
  throw new Error('production UI cache stamping is missing required profile stylesheets');
}

const assetReference = /\/app\/assets\/([A-Za-z0-9._-]+\.css)(?:\?v=[A-Za-z0-9._-]+)?/g;
function stamp(input) {
  return input.replace(assetReference, (reference, name) => {
    const version = versions.get(name);
    return version ? `/app/assets/${name}?v=${version}` : reference;
  });
}

for (const path of [appHtmlPath, appJsPath]) {
  const source = await readFile(path, 'utf8');
  await writeFile(path, stamp(source));
}

const manifest = Object.fromEntries([...versions.entries()].sort(([a], [b]) => a.localeCompare(b)));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Stamped ${versions.size} production component stylesheets with content hashes.`);
