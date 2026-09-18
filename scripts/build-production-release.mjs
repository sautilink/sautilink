import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformAndroidPushSource } from './android-push-source-transform.mjs';
import { transformAuthSessionStabilitySource } from './auth-session-stability-source-transform.mjs';
import { transformBootstrapResilienceSource } from './bootstrap-resilience-source-transform.mjs';
import { transformLoginBootSource } from './login-boot-source-transform.mjs';
import { transformMediaPerformanceSource } from './media-performance-source-transform.mjs';
import { transformMemberBootstrapResilienceSource } from './member-bootstrap-resilience-source-transform.mjs';
import { transformMentionNotificationSource } from './mention-notification-source-transform.mjs';
import { transformMessagesDurableRealtimeSource } from './messages-durable-realtime-source-transform.mjs';
import { transformMessagesMediaSource } from './messages-media-source-transform.mjs';
import { transformPostMediaSource } from './post-media-source-transform.mjs';
import { transformPostViewMetricsSource } from './post-view-metrics-source-transform.mjs';
import { transformProfileTabIconsSource } from './profile-tab-icons-source-transform.mjs';
import { transformRoomsStartupIsolationSource } from './rooms-startup-isolation-source-transform.mjs';
import { transformRuntimePerformanceSource } from './runtime-performance-source-transform.mjs';
import { transformVerificationCaseFlowSource } from './verification-case-flow-source-transform.mjs';
import { transformVideoPlayerSource } from './video-player-source-transform.mjs';
import { transformWhatsAppOtpSource } from './whatsapp-otp-source-transform.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerRoot = resolve(projectRoot, 'dist-production-worker');
const workerSource = resolve(workerRoot, 'src');
const productionAppSource = resolve(workerSource, 'app.js');
const siteRoot = resolve(projectRoot, 'dist-production-site');

const PRODUCTION_REF = 'rggpyiterdbbugluejcs';
const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`;
const APP_JS_RELEASE = '20260917-commentmenu1';
const APP_JS_FEATURE_RELEASE = '20260918-dashboardroute1';
const PWA_RELEASE = '20260916-loadingfix1';
const POST_ACTION_ICON_CSS_RELEASE = '20260914-instagram2';
const SETTINGS_LIGHT_THEME_CSS_RELEASE = '20260917-settings1';

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
  return input
    .replaceAll('/assets/brand/logo-compact.webp', '/logo.png')
    .replaceAll(
      'We will send the required confirmation email before the address changes.',
      'We will send an 8-digit verification code before the address changes.',
    )
    .replaceAll('>Send confirmation</button>', '>Send verification code</button>')
    .replaceAll(
      'Confirmation email sent. Follow the SautiLink confirmation link to finish changing your email address.',
      'Verification code sent. Enter the 8-digit code below to finish changing your email address.',
    );
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
  const postActionIconStylesheet = `/app/assets/post-media-carousel.css?v=${POST_ACTION_ICON_CSS_RELEASE}`;
  if (!output.includes(postActionIconStylesheet)) {
    output = output.replace('</head>', `  <link rel="stylesheet" href="${postActionIconStylesheet}">\n</head>`);
  }
  const settingsLightThemeStylesheet = `/app/assets/settings-light-theme-hotfix.css?v=${SETTINGS_LIGHT_THEME_CSS_RELEASE}`;
  if (!output.includes(settingsLightThemeStylesheet)) {
    output = output.replace('</head>', `  <link rel="stylesheet" href="${settingsLightThemeStylesheet}">\n</head>`);
  }
  if (!output.includes('pwa.js?v=')) {
    output = output.replace('</body>', `  <script src="/assets/pwa.js?v=${PWA_RELEASE}" defer></script>\n</body>`);
  } else {
    output = output.replace(/pwa\.js\?v=[^"']+/g, `pwa.js?v=${PWA_RELEASE}`);
  }
  return output;
}

await rm(workerRoot, { recursive: true, force: true });
await rm(siteRoot, { recursive: true, force: true });
await mkdir(workerSource, { recursive: true });
await mkdir(siteRoot, { recursive: true });

for (const source of [
  'src',
  'worker',
  'wrangler.toml',
  'wrangler.production.toml',
  'package.json',
  'package-lock.json',
]) {
  await cp(resolve(projectRoot, source), resolve(workerRoot, source), { recursive: true });
}

for (const source of ['app', 'assets', '_headers', '_redirects', 'manifest.json', 'sw.js', 'logo.png']) {
  await cp(resolve(projectRoot, source), resolve(siteRoot, source), { recursive: true });
}

const productionFiles = await walk(workerSource);
for (const file of productionFiles) {
  if (extname(file) !== '.js') continue;
  const source = await readFile(file, 'utf8');
  let output = transformAuthSessionStabilitySource(
    file,
    transformPostViewMetricsSource(
      file,
      transformRuntimePerformanceSource(
        file,
        transformAndroidPushSource(
          file,
          transformMessagesDurableRealtimeSource(
            file,
            transformMessagesMediaSource(
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
                          transformMediaPerformanceSource(
                            file,
                            transformPostMediaSource(file, source),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  output = transformVerificationCaseFlowSource(file, output);
  await writeFile(file, productionText(output));
}

const profileTabIconsPath = resolve(workerSource, 'profile-activity.js');
await writeFile(
  profileTabIconsPath,
  transformProfileTabIconsSource(profileTabIconsPath, await readFile(profileTabIconsPath, 'utf8')),
);
for (const roomPath of ['rooms-platform.js', 'rooms-facebook-ui.js']) {
  const file = resolve(workerSource, roomPath);
  await writeFile(file, transformRoomsStartupIsolationSource(file, await readFile(file, 'utf8')));
}

const appSource = await readFile(productionAppSource, 'utf8');
await build({
  stdin: {
    contents: appSource,
    resolveDir: workerSource,
    sourcefile: 'src/app.js',
    loader: 'js',
  },
  inject: [
    resolve(workerSource, 'language-preference.js'),
    resolve(workerSource, 'post-caption-placement.js'),
    resolve(workerSource, 'member-notices.js'),
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
    resolve(workerSource, 'messages-media-ui.js'),
    resolve(workerSource, 'messages-durable-realtime.js'),
    resolve(workerSource, 'rooms-platform.js'),
    resolve(workerSource, 'room-post-images.js'),
    resolve(workerSource, 'rooms-invitations-style.js'),
    resolve(workerSource, 'rooms-invitations.js'),
    resolve(workerSource, 'rooms-facebook-ui.js'),
    resolve(workerSource, 'mobile-nav-icon-style.js'),
    resolve(workerSource, 'mobile-more-drawer.js'),
    resolve(workerSource, 'post-media-carousel.js'),
    resolve(workerSource, 'post-view-metrics.js'),
    resolve(workerSource, 'conversation-replies-ui.js'),
    resolve(workerSource, 'short-videos-feed.js'),
    resolve(workerSource, 'social-oauth-auth.js'),
    resolve(workerSource, 'whatsapp-otp-auth.js'),
    resolve(workerSource, 'sautilink-video-player.js'),
    resolve(workerSource, 'android-push-notifications.js'),
  ],
  outfile: resolve(siteRoot, 'app/assets/app.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'info',
});

const appHtmlPath = resolve(siteRoot, 'app/index.html');
let appHtml = productionText(await readFile(appHtmlPath, 'utf8'));
appHtml = appHtml
  .replace(/\s*<meta name="robots" content="noindex, nofollow">\s*/i, '\n')
  .replace("img-src 'self' data: blob:; script-src", "img-src 'self' data: blob:; media-src 'self' blob:; script-src")
  .replace(/app\.js\?v=[^"']+/g, `app.js?v=${APP_JS_RELEASE}&feature=${APP_JS_FEATURE_RELEASE}`);
appHtml = wireProductionPwa(appHtml);
await writeFile(appHtmlPath, appHtml);

const productionSwPath = resolve(siteRoot, 'sw.js');
let productionSw = await readFile(productionSwPath, 'utf8');
productionSw = productionSw
  .replace(/const APP_RELEASE = "[^"]+";/, `const APP_RELEASE = "${APP_JS_RELEASE}";`)
  .replace(/const APP_FEATURE_RELEASE = "[^"]+";/, `const APP_FEATURE_RELEASE = "${APP_JS_FEATURE_RELEASE}";`);
await writeFile(productionSwPath, productionSw);

const productionPwaPath = resolve(siteRoot, 'assets/pwa.js');
let productionPwa = await readFile(productionPwaPath, 'utf8');
productionPwa = productionPwa.replace(/const PWA_RELEASE = '[^']+';/, `const PWA_RELEASE = '${PWA_RELEASE}';`);
await writeFile(productionPwaPath, productionPwa);
