import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const siteRoot = resolve(projectRoot, 'dist-production-site');
const workerRoot = resolve(projectRoot, 'dist-production-worker');

const appJs = await readFile(resolve(siteRoot, 'app/assets/app.js'), 'utf8');
const translationCssPath = resolve(siteRoot, 'app/assets/post-translation.css');
const router = await readFile(resolve(workerRoot, 'src/asset-router.js'), 'utf8');
const translationApi = await readFile(resolve(workerRoot, 'src/post-translation-api.js'), 'utf8');
const productionConfig = await readFile(resolve(projectRoot, 'wrangler.production.jsonc'), 'utf8');

for (const marker of [
  'sautilink.language',
  'settings-language-preference',
  'Translate this post',
  'See Original Post',
  '/api/post-translations/',
]) {
  if (!appJs.includes(marker)) throw new Error(`production browser bundle missing translation marker: ${marker}`);
}

const cssInfo = await stat(translationCssPath).catch(() => null);
if (!cssInfo?.isFile()) throw new Error('production artifact missing post translation stylesheet');

for (const marker of [
  "import { handlePostTranslationRequest } from './post-translation-api.js';",
  "url.pathname.startsWith('/api/post-translations/')",
]) {
  if (!router.includes(marker)) throw new Error(`production Worker router missing post translation marker: ${marker}`);
}

for (const marker of [
  "@cf/meta/m2m100-1.2b",
  "new Set(['sw', 'fr'])",
  'social_posts',
  'source_lang: sourceLanguage',
  "target_lang: 'en'",
  'POST_TRANSLATION_LIMITER',
  'globalThis.caches?.default',
]) {
  if (!translationApi.includes(marker)) throw new Error(`production translation Worker missing marker: ${marker}`);
}

const rlsRead = translationApi.indexOf('selectVisiblePost(postId, session.auth)');
const cacheRead = translationApi.indexOf('cache.match(cacheKey)');
if (rlsRead < 0 || cacheRead < 0 || rlsRead > cacheRead) {
  throw new Error('post translation cache must remain behind authenticated RLS visibility check');
}

for (const marker of [
  '"binding": "AI"',
  '"name": "POST_TRANSLATION_LIMITER"',
  '"namespace_id": "3216"',
]) {
  if (!productionConfig.includes(marker)) throw new Error(`production translation binding missing: ${marker}`);
}

console.log('Verified production language preference + on-demand post translation bundle, protected RLS-before-cache Worker path, stylesheet, Workers AI binding and rate limit.');
