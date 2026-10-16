import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { hashtagSearchHref } from '../src/caption-entities.js';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const normalize = source.slice(source.indexOf('function normalizeDiscoverQuery('), source.indexOf('function renderDiscoverProfile('));
const load = source.slice(source.indexOf('async function loadDiscover('), source.indexOf('async function loadSavedSauti('));

function discoverHarness() {
  const calls = [];
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: true, childElementCount: 0, replaceChildren() {}, append() {} });
    return nodes.get(id);
  };
  const context = {
    currentMemberId: 'self', discoverRequest: 0, byId, URL,
    hydrateDirectPosts: async () => [],
    window: { location: { href: 'https://sautilink.com/app/discover' }, history: { replaceState(...args) { calls.push(['route', args.at(-1)]); } } },
    supabase: {
      from(table) {
        const chain = {
          select() { return this; }, eq() { return this; }, neq() { return this; }, is() { return this; },
          order() { return this; }, limit() { return this; },
          ilike(field, pattern) { calls.push([table, field, pattern]); return this; },
          then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
        };
        return chain;
      },
    },
  };
  runInNewContext(`${normalize}\n${load}\nthis.loadDiscover = loadDiscover;`, context);
  return { context, calls, byId };
}

test('underscore hashtag round-trips through actual Discover loader as a literal search', async () => {
  const { context, calls, byId } = discoverHarness();
  const query = new URL(hashtagSearchHref('#Habari_Leo'), 'https://sautilink.com').searchParams.get('q');
  await context.loadDiscover(query);
  assert.equal(byId('discover-query').value, '#Habari_Leo');
  assert.deepEqual(calls.filter((call) => call[0] !== 'route'), [
    ['social_profiles', 'username', '%#Habari\\_Leo%'],
    ['social_profiles', 'display_name', '%#Habari\\_Leo%'],
    ['social_posts', 'body', '%#Habari\\_Leo%'],
  ]);
  assert.equal(calls.at(-1)[1], '/app/discover?q=%23Habari_Leo');
});

test('Discover preserves normalization and escapes backslash before literal underscore', async () => {
  const { context, calls, byId } = discoverHarness();
  await context.loadDiscover('  cloud_\\engine   %test  ');
  assert.equal(byId('discover-query').value, 'cloud_\\engine %test'.replace('%', ''));
  assert.equal(calls.find((call) => call[1] === 'body')[2], '%cloud\\_\\\\engine test%');
});
