import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workerRoot = resolve(projectRoot, 'dist-production-worker');
const siteRoot = resolve(projectRoot, 'dist-production-site');
const STAGING_REF = 'bbrydwzlhweuqxpgbahu';
const STAGING_KEY = 'sb_publishable_oTYKPMJoxN1b8YBmG-a5eQ_M75Kl6VF';
const PRODUCTION_REF = 'rggpyiterdbbugluejcs';
const PRODUCTION_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

for (const root of [workerRoot, siteRoot]) {
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`missing production artifact directory: ${relative(projectRoot, root)}`);
}

const files = [...await walk(workerRoot), ...await walk(siteRoot)];
if (!files.length) throw new Error('production artifact is empty');

for (const file of files) {
  if (extname(file) === '.map') throw new Error(`production source map must not ship: ${relative(projectRoot, file)}`);
  if (!['.js', '.ts', '.html', '.css', '.txt'].includes(extname(file)) && !file.endsWith('_headers')) continue;
  const text = await readFile(file, 'utf8');
  if (text.includes(STAGING_REF) || text.includes(STAGING_KEY)) {
    throw new Error(`staging Supabase identity leaked into production artifact: ${relative(projectRoot, file)}`);
  }
  if (/sb_secret_[A-Za-z0-9._-]{20,}/.test(text)) {
    throw new Error(`Supabase secret-shaped value leaked into production artifact: ${relative(projectRoot, file)}`);
  }
  if (/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(text)) {
    throw new Error(`private key leaked into production artifact: ${relative(projectRoot, file)}`);
  }
  if (text.includes('sourceMappingURL=')) {
    throw new Error(`source map reference leaked into production artifact: ${relative(projectRoot, file)}`);
  }
}

const appHtml = await readFile(resolve(siteRoot, 'app/index.html'), 'utf8');
const appJs = await readFile(resolve(siteRoot, 'app/assets/app.js'), 'utf8');
const router = await readFile(resolve(workerRoot, 'src/asset-router.js'), 'utf8');
const headers = await readFile(resolve(siteRoot, '_headers'), 'utf8');
const config = await readFile(resolve(projectRoot, 'wrangler.production.jsonc'), 'utf8');

for (const [label, value] of [['app html', appHtml], ['app js', appJs]]) {
  if (!value.includes(PRODUCTION_REF)) throw new Error(`${label} does not target production Supabase`);
}
if (!appJs.includes(PRODUCTION_KEY)) throw new Error('browser bundle does not contain the production publishable key');
if (appHtml.includes('Private preview') || appHtml.includes('Phase 31')) throw new Error('production app still contains staging/phase UI copy');
if (/name="robots"[^>]+noindex/i.test(appHtml)) throw new Error('production app must not carry staging noindex meta');
if (!appHtml.includes('theme-init.js?v=20260904-account2')) throw new Error('production theme bootstrap is missing');
if (!appHtml.includes('app.css?v=20260905-badge1')) throw new Error('production CSS cache marker is missing');
if (!appHtml.includes('app.js?v=20260905-badge1')) throw new Error('production JS cache marker is missing');
if (!appHtml.includes('/logo.png')) throw new Error('production app must use the main-site logo path');
if (appHtml.includes('/assets/brand/logo-compact.webp')) throw new Error('production app references a logo asset absent from the main-site repo');
if (!headers.includes(`https://${PRODUCTION_REF}.supabase.co`)) throw new Error('production CSP does not target production Supabase');
if (/X-Robots-Tag:\s*noindex/i.test(headers)) throw new Error('production static headers must not force noindex');
if (!router.includes("'production'")) throw new Error('production Worker health environment was not transformed');

for (const marker of [
  'sautilink.com/app/*',
  'www.sautilink.com/app/*',
  'sautilink.com/api/*',
  'www.sautilink.com/api/*',
  'sautilink.com/login*',
  'sautilink.com/signup*',
  'sautilink.com/home*',
  'sautilink.com/messages*',
  'sautilink.com/sautify*',
  'sautilink.com/u/*',
  'sautilink.com/post/*',
  'www.sautilink.com/login*',
  'www.sautilink.com/signup*',
  'www.sautilink.com/home*',
  'sautilink-media-production',
]) {
  if (!config.includes(marker)) throw new Error(`production Wrangler config missing: ${marker}`);
}
if (/"pattern"\s*:\s*"(?:www\.)?sautilink\.com\/\*"/.test(config)) {
  throw new Error('production Worker must not intercept the marketing/legal site root');
}

console.log(`Verified ${files.length} production artifact files: production DB isolated, clean social routes present, root site preserved, no secrets/source maps.`);
