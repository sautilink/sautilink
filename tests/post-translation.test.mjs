import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  accessTokenFromStoredSession,
  detectSupportedPostLanguage,
} from '../src/post-translation.js';
import {
  handlePostTranslationRequest,
  normalizeTranslationSourceLanguage,
} from '../src/post-translation-api.js';

const repoFile = (path) => new URL(`../${path}`, import.meta.url);

test('detects supported post languages conservatively', () => {
  assert.equal(detectSupportedPostLanguage('Habari, tunataka maendeleo mazuri kwa watu wote.'), 'sw');
  assert.equal(detectSupportedPostLanguage('Asante sana kwa kuwa hapa.'), 'sw');
  assert.equal(detectSupportedPostLanguage('Bonjour, nous voulons un bon développement pour tous.'), 'fr');
  assert.equal(detectSupportedPostLanguage('Merci beaucoup, je suis ici maintenant.'), 'fr');
  assert.equal(detectSupportedPostLanguage('Hello, we want good development for everyone.'), 'en');
  assert.equal(detectSupportedPostLanguage('SautiLink'), '');
  assert.equal(detectSupportedPostLanguage('🔥🔥'), '');
});

test('only Kiswahili and French can request English translation', () => {
  assert.equal(normalizeTranslationSourceLanguage('sw'), 'sw');
  assert.equal(normalizeTranslationSourceLanguage('FR'), 'fr');
  assert.equal(normalizeTranslationSourceLanguage('en'), '');
  assert.equal(normalizeTranslationSourceLanguage('de'), '');
});

test('reads the existing persisted session shapes without creating a new auth store', () => {
  const storageFor = (value) => ({
    getItem(key) {
      assert.equal(key, 'sautilink.auth.session');
      return JSON.stringify(value);
    },
  });

  assert.equal(accessTokenFromStoredSession(storageFor({ access_token: 'direct-token' })), 'direct-token');
  assert.equal(accessTokenFromStoredSession(storageFor({ currentSession: { access_token: 'wrapped-token' } })), 'wrapped-token');
  assert.equal(accessTokenFromStoredSession({ getItem: () => '{bad json' }), '');
});

test('translation API rechecks auth and RLS before serving a cached translation', async () => {
  const originalFetch = globalThis.fetch;
  const originalCachesDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const cacheStore = new Map();
  const calls = [];
  let aiCalls = 0;
  let limiterCalls = 0;

  const fakeCache = {
    async match(request) {
      const cached = cacheStore.get(request.url);
      return cached ? cached.clone() : undefined;
    },
    async put(request, response) {
      cacheStore.set(request.url, response.clone());
    },
  };

  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'viewer-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/rest/v1/social_posts?')) {
      return new Response(JSON.stringify([{
        id: '123e4567-e89b-42d3-a456-426614174000',
        body: 'Habari, tunataka maendeleo mazuri kwa watu wote.',
      }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { default: fakeCache },
  });

  const env = {
    AI: {
      async run(model, input) {
        aiCalls += 1;
        assert.equal(model, '@cf/meta/m2m100-1.2b');
        assert.equal(input.source_lang, 'sw');
        assert.equal(input.target_lang, 'en');
        assert.match(input.text, /Habari/);
        return { translated_text: 'Hello, we want good development for everyone.' };
      },
    },
    POST_TRANSLATION_LIMITER: {
      async limit({ key }) {
        limiterCalls += 1;
        assert.equal(key, 'viewer-1');
        return { success: true };
      },
    },
  };

  const makeRequest = () => new Request(
    'https://sautilink.com/api/post-translations/123e4567-e89b-42d3-a456-426614174000',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer viewer-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source_language: 'sw' }),
    },
  );

  try {
    const first = await handlePostTranslationRequest(makeRequest(), env);
    assert.equal(first.status, 200);
    const firstPayload = await first.json();
    assert.equal(firstPayload.data.translated_text, 'Hello, we want good development for everyone.');
    assert.equal(firstPayload.data.cached, false);
    assert.equal(aiCalls, 1);
    assert.equal(limiterCalls, 1);

    const second = await handlePostTranslationRequest(makeRequest(), env);
    assert.equal(second.status, 200);
    const secondPayload = await second.json();
    assert.equal(secondPayload.data.cached, true);
    assert.equal(aiCalls, 1, 'cached translation must not call Workers AI again');
    assert.equal(limiterCalls, 1, 'cached translation must not consume a new translation rate-limit unit');

    const authReads = calls.filter((url) => url.includes('/auth/v1/user')).length;
    const rlsReads = calls.filter((url) => url.includes('/rest/v1/social_posts?')).length;
    assert.equal(authReads, 2, 'every request must re-authenticate before cache access');
    assert.equal(rlsReads, 2, 'every request must re-run the viewer RLS read before cache access');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCachesDescriptor) {
      Object.defineProperty(globalThis, 'caches', originalCachesDescriptor);
    } else {
      delete globalThis.caches;
    }
  }
});

test('translation implementation stays isolated from post mutation and database schema', async () => {
  const [client, api, router, build, productionBuild, productionConfig, stagingConfig] = await Promise.all([
    readFile(repoFile('src/post-translation.js'), 'utf8'),
    readFile(repoFile('src/post-translation-api.js'), 'utf8'),
    readFile(repoFile('src/asset-router.js'), 'utf8'),
    readFile(repoFile('scripts/build-app.mjs'), 'utf8'),
    readFile(repoFile('scripts/build-production-release.mjs'), 'utf8'),
    readFile(repoFile('wrangler.production.jsonc'), 'utf8'),
    readFile(repoFile('wrangler.social-staging.jsonc'), 'utf8'),
  ]);

  assert.match(client, /Translate this post/);
  assert.match(client, /Translating…/);
  assert.match(client, /See Original Post/);
  assert.match(client, /\/api\/post-translations\//);
  assert.doesNotMatch(client, /\.from\(|supabase|service_role/i);

  assert.match(api, /@cf\/meta\/m2m100-1\.2b/);
  assert.match(api, /source_lang: sourceLanguage/);
  assert.match(api, /target_lang: 'en'/);
  assert.match(api, /POST_TRANSLATION_LIMITER/);
  assert.match(api, /body\.length > 500/);
  assert.doesNotMatch(api, /insert\(|update\(|delete\(/i);
  assert.ok(
    api.indexOf('selectVisiblePost(postId, session.auth)') < api.indexOf('cache.match(cacheKey)'),
    'viewer RLS visibility must be checked before the shared edge cache',
  );

  assert.match(router, /handlePostTranslationRequest/);
  assert.match(build, /src\/post-translation\.js/);
  assert.match(productionBuild, /workerSource, 'language-preference\.js'/);
  assert.match(productionBuild, /workerSource, 'post-translation\.js'/);
  assert.match(productionConfig, /"binding": "AI"/);
  assert.match(productionConfig, /"name": "POST_TRANSLATION_LIMITER"/);
  assert.match(stagingConfig, /"binding": "AI"/);
  assert.match(stagingConfig, /"name": "POST_TRANSLATION_LIMITER"/);
});
