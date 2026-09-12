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
const workerApp = await readFile(resolve(workerRoot, 'src/app.js'), 'utf8');
const mediaApi = await readFile(resolve(workerRoot, 'src/sauti-media-api.js'), 'utf8');
const profileXCss = await readFile(resolve(siteRoot, 'app/assets/profile-x-ui.css'), 'utf8');
const messagesWhatsappCss = await readFile(resolve(siteRoot, 'app/assets/messages-whatsapp.css'), 'utf8');
const roomsFacebookCss = await readFile(resolve(siteRoot, 'app/assets/rooms-facebook.css'), 'utf8');
const router = await readFile(resolve(workerRoot, 'src/asset-router.js'), 'utf8');
const workerEntry = await readFile(resolve(workerRoot, 'src/worker-entry.js'), 'utf8');
const realtimeApi = await readFile(resolve(workerRoot, 'src/dm-realtime-api.js'), 'utf8');
const realtimeHub = await readFile(resolve(workerRoot, 'src/dm-realtime-hub.js'), 'utf8');
const headers = await readFile(resolve(siteRoot, '_headers'), 'utf8');
const config = await readFile(resolve(projectRoot, 'wrangler.production.jsonc'), 'utf8');

for (const [label, value] of [['app html', appHtml], ['app js', appJs]]) {
  if (!value.includes(PRODUCTION_REF)) throw new Error(`${label} does not target production Supabase`);
}
if (!appJs.includes(PRODUCTION_KEY)) throw new Error('browser bundle does not contain the production publishable key');
if (!appJs.includes('sautilink-profile-x-ui')) throw new Error('production browser bundle missing X-style profile UI loader');
if (!appJs.includes('profile-x-ui.css?v=20260910-tabs2')) throw new Error('production browser bundle missing CSP-safe profile stylesheet URL');
if (!appJs.includes('/api/dm-realtime/')) throw new Error('production browser bundle missing Durable Objects Messages realtime client');
for (const marker of [
  '.profile-surface .profile-card',
  '.profile-surface .profile-banner',
  '.profile-surface .profile-avatar-shell',
  '.profile-surface .profile-activity-tabs',
  '@media (max-width: 680px)',
]) {
  if (!profileXCss.includes(marker)) throw new Error(`production profile stylesheet missing UI marker: ${marker}`);
}
for (const marker of [
  'Technology & AI',
  'rooms-invitations.css',
  'The Room invitation could not be updated',
  'rooms-facebook.css',
  'room-fb-detail-tabs',
]) {
  if (!appJs.includes(marker)) throw new Error(`production browser bundle missing Rooms runtime marker: ${marker}`);
}
for (const marker of [
  'messages-whatsapp.css?v=20260910-wa1',
  'whatsapp-inspired',
  'Search or start new chat',
  'Conversation options',
]) {
  if (!appJs.includes(marker)) throw new Error(`production browser bundle missing Messages UI marker: ${marker}`);
}
for (const marker of [
  '.messages-whatsapp-ui',
  '.messages-wa-shell',
  '.messages-wa-sidebar',
  '.messages-wa-stage',
  '.dm-message.own',
  '@media (max-width: 680px)',
]) {
  if (!messagesWhatsappCss.includes(marker)) throw new Error(`production Messages stylesheet missing UI marker: ${marker}`);
}
for (const marker of [
  'Member profile loading timed out.',
  'Session restoration timed out.',
  'AUTH_SESSION_BOOT_TIMEOUT',
  'sautilink.member.cache.v1:',
  'Your session could not be confirmed. Please sign in again.',
]) {
  if (!appJs.includes(marker)) throw new Error(`production browser bundle missing signed-in bootstrap resilience marker: ${marker}`);
}
if (appJs.includes('Your session opened, but your profile could not be loaded. Try again.')) {
  throw new Error('production browser bundle still treats a transient profile read as a signed-out session');
}

for (const marker of [
  'SAUTI_MEDIA_VARIANT_WIDTHS = Object.freeze([480, 960, 1440])',
  'waitForSautiMediaNearViewport(button)',
  'selectSautiMediaVariantWidth(media, button)',
  "url.searchParams.set('w', String(variantWidth))",
]) {
  if (!workerApp.includes(marker)) throw new Error(`production browser source missing media performance marker: ${marker}`);
}
for (const marker of [
  'IMAGE_VARIANT_WIDTHS = Object.freeze([480, 960, 1440])',
  "output({ format: 'image/webp', quality: 85, anim: true })",
  'globalThis.caches?.default',
  'private, max-age=0, must-revalidate',
]) {
  if (!mediaApi.includes(marker)) throw new Error(`production media Worker missing performance marker: ${marker}`);
}
if (!router.includes('protectedMediaDelivery')) throw new Error('production Worker does not preserve protected media cache policy');

for (const marker of [
  "url.pathname.startsWith('/api/dm-realtime/')",
  'handleDmRealtimeRequest',
  'return router.fetch(request, env, ctx)',
]) {
  if (!workerEntry.includes(marker)) throw new Error(`production Worker entry missing realtime isolation marker: ${marker}`);
}
for (const marker of [
  '/auth/v1/user',
  'dm_conversations',
  'social_blocks',
  'social_member_preferences',
  'activity_status',
  'DM_REALTIME_HUB',
]) {
  if (!realtimeApi.includes(marker)) throw new Error(`production realtime API missing authorization marker: ${marker}`);
}
for (const marker of ['acceptWebSocket', 'getWebSockets', 'serializeAttachment']) {
  if (!realtimeHub.includes(marker)) throw new Error(`production realtime hub missing hibernation marker: ${marker}`);
}
if (/service_role|sb_secret_/i.test(realtimeApi)) throw new Error('production realtime API must not contain privileged Supabase credentials');

if (!roomsFacebookCss.includes('body.rooms-facebook-view')) throw new Error('production Rooms Groups-style stylesheet is missing its feature scope');
if (!roomsFacebookCss.includes('room-fb-detail-aside')) throw new Error('production Rooms Groups-style detail layout is missing');
if (appHtml.includes('Private preview') || appHtml.includes('Phase 31')) throw new Error('production app still contains staging/phase UI copy');
if (/name="robots"[^>]+noindex/i.test(appHtml)) throw new Error('production app must not carry staging noindex meta');
if (!appHtml.includes('theme-init.js?v=20260904-account2')) throw new Error('production theme bootstrap is missing');
if (!appHtml.includes('app.css?v=20260909-home-loading')) throw new Error('production CSS cache marker is missing');
if (!appHtml.includes('app.js?v=20260912-durable1')) throw new Error('production JS cache marker is missing');
if (!appHtml.includes('/logo.png')) throw new Error('production app must use the main-site logo path');
if (appHtml.includes('/assets/brand/logo-compact.webp')) throw new Error('production app references a logo asset absent from the main-site repo');
if (!headers.includes(`https://${PRODUCTION_REF}.supabase.co`)) throw new Error('production CSP does not target production Supabase');
if (!headers.includes('wss://sautilink.com')) throw new Error('production CSP does not allow the same-origin Durable Objects WebSocket');
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
  'sautilink.com/rooms*',
  'www.sautilink.com/rooms*',
  'sautilink.com/sautify*',
  'sautilink.com/u/*',
  'sautilink.com/post/*',
  'www.sautilink.com/login*',
  'www.sautilink.com/signup*',
  'www.sautilink.com/home*',
  'sautilink-media-production',
  '"binding": "IMAGES"',
  '"SAUTI_MEDIA_VARIANTS_ENABLED": "true"',
  '"main": "./dist-production-worker/src/worker-entry.js"',
  '"name": "DM_REALTIME_HUB"',
  '"class_name": "DmRealtimeHub"',
  '"type": "durable-object"',
  '"storage": "sqlite"',
  '"DM_REALTIME_SUPABASE_URL"',
  '"DM_REALTIME_SUPABASE_KEY"',
]) {
  if (!config.includes(marker)) throw new Error(`production Wrangler config missing: ${marker}`);
}
if (/"pattern"\s*:\s*"(?:www\.)?sautilink\.com\/\*"/.test(config)) {
  throw new Error('production Worker must not intercept the marketing/legal site root');
}

console.log(`Verified ${files.length} production artifact files: production DB isolated, protected responsive media optimization present, CSP-safe X-style profile stylesheet present, transient read/session resilience present, scoped Messages UI present, Durable Objects presence/typing isolated behind authenticated RLS checks, clean social routes present, Rooms runtime present, root site preserved, no secrets/source maps.`);
