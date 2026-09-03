import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stageRoot = resolve(projectRoot, 'dist-preview-site');

const forbiddenSegments = new Set([
  '.git',
  '.github',
  'docs',
  'src',
  'supabase',
  'tests',
  'preview-src',
  'scripts',
  'node_modules',
  '.wrangler',
]);
const forbiddenFiles = new Set([
  'package.json',
  'package-lock.json',
  'wrangler.jsonc',
  '.assetsignore',
  '.gitignore',
  '.dev.vars',
  '.env',
]);
const textExtensions = new Set(['.html', '.js', '.css', '.json', '.txt', '.xml', '.webmanifest']);
const secretPatterns = [
  { label: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9._-]{20,}/ },
  { label: 'private key', pattern: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
  { label: 'service-role environment assignment', pattern: /(?:SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)\\s*[:=]\\s*['"][^'"]{16,}/ },
  { label: 'Cloudflare token environment assignment', pattern: /CLOUDFLARE_API_TOKEN\\s*[:=]\\s*['"][^'"]{16,}/ },
];

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

const stageStat = await stat(stageRoot).catch(() => null);
if (!stageStat?.isDirectory()) {
  throw new Error('dist-preview-site is missing. Run the staging build before artifact verification.');
}

const files = await walk(stageRoot);
if (!files.length) throw new Error('dist-preview-site is empty.');

for (const full of files) {
  const rel = relative(stageRoot, full);
  const segments = rel.split(sep);
  const basename = segments.at(-1);

  if (segments.some((segment) => forbiddenSegments.has(segment))) {
    throw new Error(`forbidden staging path leaked: ${rel}`);
  }
  if (forbiddenFiles.has(basename) || basename.startsWith('.env') || basename.startsWith('.dev.vars')) {
    throw new Error(`forbidden staging file leaked: ${rel}`);
  }
  if (extname(basename).toLowerCase() === '.map') {
    throw new Error(`source map must not ship to staging: ${rel}`);
  }

  const extension = extname(basename).toLowerCase();
  if (!textExtensions.has(extension) && basename !== '_headers' && basename !== '_redirects') continue;

  const content = await readFile(full, 'utf8');
  for (const { label, pattern } of secretPatterns) {
    if (pattern.test(content)) {
      throw new Error(`sensitive ${label} leaked in staging artifact: ${rel}`);
    }
  }
  if (content.includes('sourceMappingURL=')) {
    throw new Error(`source map reference leaked in staging artifact: ${rel}`);
  }
}

for (const required of [
  'index.html',
  '_headers',
  'app/index.html',
  'app/assets/app.js',
  'app/assets/app.css',
  'assets/brand/system.css',
]) {
  const requiredStat = await stat(resolve(stageRoot, required)).catch(() => null);
  if (!requiredStat?.isFile()) throw new Error(`required staged asset missing: ${required}`);
}

const headers = await readFile(resolve(stageRoot, '_headers'), 'utf8');
if (!headers.includes('X-Robots-Tag: noindex, nofollow, noarchive')) {
  throw new Error('staging _headers must enforce noindex/noarchive');
}

const stagedAppJs = await readFile(resolve(stageRoot, 'app/assets/app.js'), 'utf8');
const productionSupabaseRef = 'rggpyiterdbbugluejcs';
const retiredStagingSupabaseRef = 'bbrydwzlhweuqxpgbahu';
if (!headers.includes(`https://${productionSupabaseRef}.supabase.co`)) {
  throw new Error('staging frontend does not target the production account backend');
}
if (headers.includes(retiredStagingSupabaseRef) || stagedAppJs.includes(retiredStagingSupabaseRef)) {
  throw new Error('retired staging account backend leaked into the staged social app');
}
if (!stagedAppJs.includes(productionSupabaseRef)) {
  throw new Error('staged social app does not target production Supabase');
}

const appHtml = await readFile(resolve(stageRoot, 'app/index.html'), 'utf8');
if (!appHtml.includes('id="settings-surface"')) throw new Error('staged app shell is incomplete');
if (/Private preview|Phase 31|Phase 27|Foundation in progress/i.test(appHtml)) {
  throw new Error('development presentation copy leaked into staged app shell');
}
if (!appHtml.includes('app.js?v=20260903-badges2')) throw new Error('staged app JS cache marker is stale');
if (!appHtml.includes('app.css?v=20260903-badges3')) throw new Error('staged app CSS cache marker is stale');

console.log(`Verified ${files.length} staged files: allowlist intact, no source maps or sensitive markers.`);
