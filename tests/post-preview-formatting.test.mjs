import assert from 'node:assert/strict';
import test from 'node:test';

import { hasPostFormatting, postTextPlainText } from '../src/post-text-formatting.js';
import { handlePublicIndexingRoutes } from '../src/public-indexing-routes.js';

const POST_ID = '123e4567-e89b-42d3-a456-426614174000';
const shell = '<!doctype html><html><head><title>SautiLink</title></head><body><main>App shell</main></body></html>';
const env = {
  ASSETS: {
    fetch: async () => new Response(shell, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  },
};

function post(body) {
  return {
    post_id: POST_ID,
    body,
    author_username: 'benlinker',
    author_display_name: 'BenLinker',
    search_indexable: true,
    updated_at: '2026-10-19T18:00:00Z',
    media: [],
  };
}

async function withPost(body, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/rest\/v1\/rpc\/public_share_post_v1$/);
    return Response.json([post(body)]);
  };
  try { return await run(); } finally { globalThis.fetch = originalFetch; }
}

function structuredPost(html) {
  return JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
}

test('plain post text projects all supported styles and nesting without changing caption content', () => {
  const source = '**Redesigned** the *SautiLink* App __today__ and ~~yesterday~~.\n**One *nested* style** 🔥 #sautilink @benlinker';
  assert.equal(postTextPlainText(source), 'Redesigned the SautiLink App today and yesterday.\nOne nested style 🔥 #sautilink @benlinker');
  assert.equal(postTextPlainText(''), '');
  assert.equal(postTextPlainText(null), '');
  assert.equal(postTextPlainText('***Bold and italic***'), 'Bold and italic');
  assert.equal(postTextPlainText('** Bold ** * Italic * __ Underline __ ~~ Strike ~~'), ' Bold   Italic   Underline   Strike ');
  assert.equal(postTextPlainText('2026 *2* events'), '2026 2 events');
  assert.equal(hasPostFormatting('2026 *2* events'), true);
});

test('plain post text retains unmatched syntax, literal multiplication and URL characters', () => {
  for (const source of [
    'An unpaired * marker',
    'An unpaired **bold',
    'An unpaired __underline',
    '2 * 3 * 4 = 24; asterisk * means multiply',
    '2*3*4 = 24',
    '* First item\n* Second item',
    'https://example.com/a*b*c?ref=__token__&version=~~v1~~ #sautilink',
    'www.example.com/a**b**c?ref=__token__',
    '#sauti__link__tz @user__name__xx',
  ]) assert.equal(postTextPlainText(source), source, source);
  assert.equal(postTextPlainText('2*3*4 and *Ready*'), '2*3*4 and Ready');
  assert.equal(hasPostFormatting('2 * 3 * 4 = 24'), false);
  assert.equal(postTextPlainText('**https://example.com/a*b*c?ref=__token__**'), 'https://example.com/a*b*c?ref=__token__');
  assert.equal(postTextPlainText('**https://example.com/a*b*c**. *Ready*'), 'https://example.com/a*b*c. Ready');
  assert.equal(postTextPlainText('__#sauti_link__ **@user_name**'), '#sauti_link @user_name');
});

test('external share metadata removes formatting before truncation, while JSON retains the stored caption', async () => {
  const body = `**${'SautiLink '.repeat(70).trim()}**\n*Enjoy* the __new look__ ~~now~~ #sautilink`;
  await withPost(body, async () => {
    const response = await handlePublicIndexingRoutes(new Request(`https://sautilink.com/post/${POST_ID}`), env);
    const html = await response.text();
    const data = structuredPost(html);
    assert.match(html, /public-post-card\/[^" ]+\.png\?v=3-/);
    assert.doesNotMatch(html, /\*\*|__new|~~now/);
    assert.match(html, /<strong>SautiLink /);
    assert.match(html, /<em>Enjoy<\/em> the <u>new look<\/u> <s>now<\/s>/);
    assert.equal(data.articleBody.length, 500);
    assert.equal(data.articleBody.startsWith('SautiLink '), true);
    assert.doesNotMatch(data.description, /\*|__|~~/);
    assert.equal(data.description.length <= 180, true);
    for (const name of ['description', 'og:description', 'twitter:description']) {
      assert.match(html, new RegExp(`(?:name|property)="${name}" content="SautiLink `));
    }
    const jsonResponse = await handlePublicIndexingRoutes(new Request(`https://sautilink.com/api/public-post/${POST_ID}`), env);
    const json = await jsonResponse.json();
    assert.equal(json.data.post.body, body);
  });
});

test('share title truncation preserves the emoji at the actual styled-caption boundary', async () => {
  const body = 'We **Redesigned** the **SautiLink App** and **Web** for a smoother user experience🔥 🚀. Enjoy the new look! 👀. **Update the App** (as a tester) or check it here: https://www.sautilink.com/home';
  await withPost(body, async () => {
    const response = await handlePublicIndexingRoutes(new Request(`https://sautilink.com/post/${POST_ID}`), env);
    const html = await response.text();
    const data = structuredPost(html);
    const headline = 'We Redesigned the SautiLink App and Web for a smoother user experience🔥…';
    assert.equal(data.headline, headline);
    assert.equal(data.headline.isWellFormed(), true);
    assert.match(html, /<title>We Redesigned the SautiLink App and Web for a smoother user experience🔥… — BenLinker on SautiLink<\/title>/);
    assert.doesNotMatch(html, /\uFFFD/);
  });
});

test('share description truncation keeps complete emoji within its readable character limit', async () => {
  const prefix = 'a'.repeat(178);
  const body = `**${prefix}🚀** more caption text`;
  await withPost(body, async () => {
    const response = await handlePublicIndexingRoutes(new Request(`https://sautilink.com/post/${POST_ID}`), env);
    const html = await response.text();
    const data = structuredPost(html);
    assert.equal(data.description, `${prefix}🚀…`);
    assert.equal(data.description.isWellFormed(), true);
    assert.equal(Array.from(data.description).length, 180);
    assert.doesNotMatch(html, /\uFFFD/);
    for (const name of ['description', 'og:description', 'twitter:description']) {
      assert.match(html, new RegExp(`(?:name|property)="${name}" content="${prefix}🚀…"`));
    }
  });
});

test('public fallback renders trusted format tags and escapes caption HTML in every context', async () => {
  const body = '**<img src=x onerror="alert(1)">**\n*Hello* __<script>bad()</script>__ ~~& done~~';
  await withPost(body, async () => {
    const response = await handlePublicIndexingRoutes(new Request(`https://sautilink.com/post/${POST_ID}`), env);
    const html = await response.text();
    assert.match(html, /<strong>&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;<\/strong><br><em>Hello<\/em>/);
    assert.match(html, /<u>&lt;script&gt;bad\(\)&lt;\/script&gt;<\/u>/);
    assert.match(html, /<s>&amp; done<\/s>/);
    assert.doesNotMatch(html, /<img src=x|<script>bad\(\)/);
    assert.equal(structuredPost(html).articleBody, '<img src=x onerror="alert(1)"> Hello <script>bad()</script> & done');
  });
});

test('PNG text preview draws visible caption text without editor delimiters', async () => {
  const drawn = [];
  const imageEnv = {
    ...env,
    ASSETS: {
      async fetch(request) {
        assert.equal(new URL(request.url).pathname, '/app/assets/post-share-base.png');
        return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } });
      },
    },
    IMAGES: {
      text(value, options) {
        assert.equal(options.font.url, 'https://sautilink.com/app/assets/fonts/post-preview/SautiLinkPostPreview-Regular.woff2');
        drawn.push(value);
        return value;
      },
      input(stream) {
        assert.ok(stream instanceof ReadableStream);
        return {
          draw() { return this; },
          async output() {
            return { response: ({ headers }) => new Response('png', { headers: { ...headers, 'Content-Type': 'image/png' } }) };
          },
        };
      },
    },
  };
  await withPost('**Redesigned** the *SautiLink* App __today__ ~~now~~', async () => {
    const response = await handlePublicIndexingRoutes(new Request(`https://sautilink.com/api/public-post-card/${POST_ID}.png?v=clean-formatting`), imageEnv);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    const caption = drawn.slice(3, -1).join(' ');
    assert.equal(caption, 'Redesigned the SautiLink App today now');
    assert.doesNotMatch(caption, /\*|__|~~/);
  });
});
