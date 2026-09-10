import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformBootstrapResilienceSource } from './bootstrap-resilience-source-transform.mjs';
import { transformLoginBootSource } from './login-boot-source-transform.mjs';
import { transformMemberBootstrapResilienceSource } from './member-bootstrap-resilience-source-transform.mjs';
import { transformMentionNotificationSource } from './mention-notification-source-transform.mjs';
import { transformPostMediaSource } from './post-media-source-transform.mjs';
import { transformProfileTabIconsSource } from './profile-tab-icons-source-transform.mjs';
import { transformRoomsStartupIsolationSource } from './rooms-startup-isolation-source-transform.mjs';
import { transformVideoPlayerSource } from './video-player-source-transform.mjs';
import { transformWhatsAppOtpSource } from './whatsapp-otp-source-transform.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerRoot = resolve(projectRoot, 'dist-production-worker');
const workerSource = resolve(workerRoot, 'src');
const siteRoot = resolve(projectRoot, 'dist-production-site');

const PRODUCTION_REF = 'rggpyiterdbbugluejcs';
const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`;
const APP_JS_RELEASE = '20260910-profileui1';

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

function wireProductionPwa(input) {
  let output = input;
  if (!output.includes('<link rel="manifest" href="/manifest.json">')) {
    const pwaHead = [
      '  <meta name="mobile-web-app-capable" content="yes">',
      '  <meta name="apple-mobile-web-app-capable" content="yes">',
      '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '  <meta name="apple-mobile-web-app-title" content="SautiLink">',
      '  <link rel="manifest" href="/manifest.json">',
      '  <link rel="apple-touch-icon" href="/assets/favicon.png">',
    ].join('\n');
    output = output.replace(/(\s*<meta name="theme-color"[^>]*>\s*)/i, `$1\n${pwaHead}\n`);
  }
  if (!output.includes('<script src="/assets/pwa.js" defer></script>')) {
    output = output.replace('</body>', '  <script src="/assets/pwa.js" defer></script>\n</body>');
  }
  return output;
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
  let output = transformProfileTabIconsSource(
    file,
    transformRoomsStartupIsolationSource(
      file,
      transformMemberBootstrapResilienceSource(
        file,
        transformBootstrapResilienceSource(
          file,
          transformLoginBootSource(
            file,
            transformWhatsAppOtpSource(
              file,
              transformVideoPlayerSource(
                file,
                transformMentionNotificationSource(
                  file,
                  transformPostMediaSource(file, productionText(source)),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
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
  .replace("img-src 'self' data: blob:; script-src", "img-src 'self' data: blob:; media-src 'self' blob:; script-src")
  .replace(/app\.js\?v=[^"']+/g, `app.js?v=${APP_JS_RELEASE}`);
appHtml = wireProductionPwa(appHtml);
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
    resolve(workerSource, 'profile-x-ui.js'),
    resolve(workerSource, 'professional-profile-category.js'),
    resolve(workerSource, 'profile-media-upload-icons.js'),
    resolve(workerSource, 'home-feed-author-profile-links.js'),
    resolve(workerSource, 'messages-whatsapp-ui.js'),
    resolve(workerSource, 'mobile-nav-icon-style.js'),
    resolve(workerSource, 'mobile-more-drawer.js'),
    resolve(workerSource, 'post-media-carousel.js'),
    resolve(workerSource, 'short-videos-feed.js'),
    resolve(workerSource, 'social-oauth-auth.js'),
    resolve(workerSource, 'whatsapp-otp-auth.js'),
    resolve(workerSource, 'sautilink-video-player.js'),
    resolve(workerSource, 'rooms-platform.js'),
    resolve(workerSource, 'room-post-images.js'),
    resolve(workerSource, 'rooms-invitations-style.js'),
    resolve(workerSource, 'rooms-invitations.js'),
    resolve(workerSource, 'rooms-facebook-ui.js'),
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