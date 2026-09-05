import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerRoot = resolve(projectRoot, 'dist-production-worker');
const workerSource = resolve(workerRoot, 'src');
const siteRoot = resolve(projectRoot, 'dist-production-site');

const PRODUCTION_REF = 'rggpyiterdbbugluejcs';
const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`;

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

function productionText(input) {
  return input.replaceAll('/assets/brand/logo-compact.webp', '/logo.png');
}

await rm(workerRoot, { recursive: true, force: true });
await rm(siteRoot, { recursive: true, force: true });
await mkdir(workerRoot, { recursive: true });
await mkdir(siteRoot, { recursive: true });

await cp(resolve(projectRoot, 'src'), workerSource, { recursive: true });
await cp(resolve(projectRoot, 'app'), resolve(siteRoot, 'app'), { recursive: true });

for (const file of await walk(workerSource)) {
  if (extname(file) !== '.js' && extname(file) !== '.ts') continue;
  const source = await readFile(file, 'utf8');
  let output = productionText(source);
  if (file.endsWith('asset-router.js')) {
    output = output.replace(
      "environment: isStaging(url) ? 'staging' : 'unknown',",
      "environment: isStaging(url) ? 'staging' : 'production',",
    );
  }
  await writeFile(file, output);
}

const appHtmlPath = resolve(siteRoot, 'app/index.html');
let appHtml = productionText(await readFile(appHtmlPath, 'utf8'));
appHtml = appHtml
  .replace(/\s*<meta name="robots" content="noindex, nofollow">\s*/i, '\n')
  .replace("img-src 'self' data: blob:; script-src", "img-src 'self' data: blob:; media-src 'self' blob:; script-src");
await writeFile(appHtmlPath, appHtml);

const appCssPath = resolve(siteRoot, 'app/assets/app.css');
await writeFile(appCssPath, productionText(await readFile(appCssPath, 'utf8')));

await build({
  entryPoints: [resolve(workerSource, 'app.js')],
  inject: [
    resolve(workerSource, 'caption-entities.js'),
    resolve(workerSource, 'composer-formats.js'),
    resolve(workerSource, 'username-login.js'),
    resolve(workerSource, 'verified-identity-controls.js'),
    resolve(workerSource, 'profile-activity.js'),
    resolve(workerSource, 'profile-route-states.js'),
  ],
  outfile: resolve(siteRoot, 'app/assets/app.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'info',
});

const productionHeaders = `/app/*
  Cache-Control: no-store, max-age=0
  Content-Security-Policy: default-src 'self'; connect-src 'self' ${PRODUCTION_URL} wss://${PRODUCTION_REF}.supabase.co; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY

/api/*
  Cache-Control: no-store, max-age=0
  X-Content-Type-Options: nosniff
`;
await writeFile(resolve(siteRoot, '_headers'), productionHeaders);

console.log('Built production-isolated SautiLink app/Worker artifacts.');
