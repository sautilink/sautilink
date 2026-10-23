import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function contentHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

// App code only; APIs, user data and root assets retain independent rules.
// Simple build-time template version variables are replaced together with the
// URL so a runtime '?v=${RELEASE}' cannot append a second version after stamping.
const assetReference = /\/app\/assets\/((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9._-]+\.(?:css|js))(?:\?v=(?:[A-Za-z0-9._-]+|\$\{[A-Za-z_$][\w$]*\}))?/g;

export async function uiCodeAssetNames(assetRoot, prefix = '') {
  const names = [];
  for (const entry of await readdir(resolve(assetRoot, prefix), { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) names.push(...await uiCodeAssetNames(assetRoot, name + '/'));
    else if (entry.isFile() && /\.(?:css|js)$/.test(entry.name)) names.push(name);
  }
  return names.sort();
}

export async function stampProductionUiAssets(siteRoot) {
  const assetRoot = resolve(siteRoot, 'app/assets');
  const contents = new Map();
  for (const name of await uiCodeAssetNames(assetRoot)) contents.set(name, await readFile(resolve(assetRoot, name), 'utf8'));
  for (const required of ['app.js', 'app.css', 'profile-x-ui.css', 'profile-settings-ui.css']) {
    if (!contents.has(required)) throw new Error(`production UI cache stamping is missing ${required}`);
  }
  const versions = new Map(), visiting = new Set(), finalContents = new Map();
  function finish(name) {
    if (versions.has(name)) return versions.get(name);
    if (visiting.has(name)) throw new Error(`Circular production UI asset reference: ${name}`);
    visiting.add(name);
    // Resolve dependency bytes first: app.js imports post-edit.js and both embed
    // CSS URLs. Hash only after every dependency URL has its final version.
    const source = contents.get(name).replace(assetReference, (reference, dependency) =>
      contents.has(dependency) ? `/app/assets/${dependency}?v=${finish(dependency)}` : reference);
    visiting.delete(name);
    finalContents.set(name, source);
    versions.set(name, contentHash(source));
    return versions.get(name);
  }
  for (const name of contents.keys()) finish(name);
  const stamp = (source) => source.replace(assetReference, (reference, name) =>
    versions.has(name) ? `/app/assets/${name}?v=${versions.get(name)}` : reference);
  for (const [name, source] of finalContents) await writeFile(resolve(assetRoot, name), source);
  const appHtmlPath = resolve(siteRoot, 'app/index.html');
  await writeFile(appHtmlPath, stamp(await readFile(appHtmlPath, 'utf8')));
  const manifest = Object.fromEntries([...versions.entries()].sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(resolve(assetRoot, 'ui-asset-versions.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await stampProductionUiAssets(resolve(projectRoot, 'dist-production-site'));
  console.log(`Stamped ${Object.keys(manifest).length} production UI code assets with final content hashes.`);
}
