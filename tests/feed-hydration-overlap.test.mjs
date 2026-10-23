import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const posts = [
  { id: 'p1', author_id: 'author', quote_post_id: 'q1', author: { username: 'author', display_name: 'Author' } },
  { id: 'p2', author_id: 'viewer', quote_post_id: null, author: { username: 'viewer' } },
];
const events = [
  { event_type: 'post', event_key: 'p1', post_id: 'p1', actor_id: 'author' },
  { event_type: 'post', event_key: 'p2', post_id: 'p2', actor_id: 'viewer' },
];
const repost = { event_type: 'repost', event_key: 'repost1', post_id: 'p1', actor_id: 'reposter' };
const responses = {
  posts, quote: [{ id: 'q1', author_id: 'quoted-author' }], actor: [{ id: 'reposter', username: 'reposter' }],
  reactions: [{ post_id: 'p1', reaction_type: 'like' }, { post_id: 'p2', reaction_type: 'dislike' }],
  reposts: [{ post_id: 'p2' }], saves: [{ post_id: 'p1' }],
  follow: [{ followed_id: 'author' }], reverse: [{ follower_id: 'author' }], interest: [{ author_id: 'author' }],
  media: [{ post_id: 'p1', id: 'm1', media_kind: 'video', position: 0 }],
};

async function harness(overrides = {}) {
  const raw = await read('src/app.js');
  const transformed = transformPostMediaSource('/repo/src/app.js', raw);
  const start = transformed.indexOf('async function loadQuotedPostMap(posts) {');
  const end = transformed.indexOf('\nasync function hydrateDirectPosts(posts)', start);
  assert.ok(start >= 0 && end > start);
  const started = [], builders = [];
  function role(query) {
    if (query.table === 'social_posts') return query.filters.some(([kind, name, ids]) => kind === 'in' && name === 'id' && ids.includes('q1')) ? 'quote' : 'posts';
    if (query.table === 'social_profiles') return 'actor';
    if (query.table === 'social_follows') return query.selection === 'followed_id' ? 'follow' : 'reverse';
    return { social_post_reactions: 'reactions', social_reposts: 'reposts', social_saved_posts: 'saves',
      social_feed_author_interests: 'interest', social_post_media: 'media' }[query.table];
  }
  const context = vm.createContext({ currentMemberId: 'viewer', supabase: { from(table) {
    const query = { table, filters: [], executions: 0,
      select(selection) { this.selection = selection; return this; },
      eq(name, value) { this.filters.push(['eq', name, value]); return this; },
      in(name, value) { this.filters.push(['in', name, [...value]]); return this; },
      order(name, value) { this.ordering = [name, value]; return this; },
      then(ok, fail) {
        this.executions++;
        this.role = role(this); started.push(this);
        const result = Object.hasOwn(overrides, this.role) ? overrides[this.role] : { data: responses[this.role], error: null };
        return Promise.resolve(typeof result === 'function' ? result(this) : result).then(ok, fail);
      },
    };
    builders.push(query); return query;
  } } });
  vm.runInContext(transformed.slice(start, end) + '\nthis.hydrate = hydrateStreamEvents;', context);
  return { context, started, builders, hydrate: (rows = events) => context.hydrate(rows) };
}

test('post-dependent reads overlap slow media, while one thenable executes the main post HTTP read once', async () => {
  const post = deferred(), media = deferred();
  const h = await harness({ posts: post.promise, media: media.promise });
  let complete = false;
  const pending = h.hydrate().then((result) => { complete = true; return result; });
  await tick();
  assert.deepEqual(h.started.map((query) => query.role).sort(), ['media', 'posts', 'reactions', 'reposts', 'saves']);
  // Later dependency work must retain the same viewer as the original batch.
  h.context.currentMemberId = 'another-viewer';
  post.resolve({ data: posts, error: null }); await tick();
  assert.equal(complete, false, 'media still gates final card admission');
  for (const name of ['quote', 'follow', 'reverse', 'interest']) assert.ok(h.started.some((query) => query.role === name), `${name} should start before slow media resolves`);
  assert.equal(h.started.find((query) => query.role === 'posts').executions, 1);
  assert.ok(h.builders.every((query) => query.executions <= 1), 'a shared Supabase thenable must never issue duplicate requests');
  for (const query of h.started.filter((query) => ['follow', 'reverse', 'interest'].includes(query.role))) {
    assert.ok(query.filters.some(([kind, , value]) => kind === 'eq' && value === 'viewer'));
    assert.ok(!query.filters.some(([, , value]) => value === 'another-viewer'));
  }
  media.resolve({ data: responses.media, error: null });
  const result = await pending;
  assert.equal(result.length, 2);
  assert.equal(result[0].post.id, 'p1'); assert.equal(result[0].quotedPost.id, 'q1');
  assert.equal(result[0].liked, true); assert.equal(result[0].saved, true);
  assert.equal(result[0].following, true); assert.equal(result[0].authorFollowsViewer, true); assert.equal(result[0].interested, true);
  assert.equal(result[0].mediaRows[0].id, 'm1');
  assert.equal(result[1].disliked, true); assert.equal(result[1].reposted, true); assert.equal(result[1].following, false);
});

test('only repost attribution requests an actor identity, preserving the exact actor select and filter', async () => {
  const h = await harness();
  const result = await h.hydrate([...events, repost]);
  const actor = h.started.find((query) => query.role === 'actor');
  assert.equal(actor.selection, 'id, username, display_name, is_discoverable, is_verified, verification_badge_type');
  assert.deepEqual(actor.filters, [['in', 'id', ['reposter']]]);
  assert.equal(result[2].actor.username, 'reposter');
  const unavailable = await harness({ actor: { data: [], error: null } });
  const filtered = await unavailable.hydrate([...events, repost, { event_type: 'post', post_id: 'missing', actor_id: 'missing' }]);
  assert.deepEqual(Array.from(filtered, (row) => row.event_key), ['p1', 'p2']);
});

test('a self-authored feed avoids actor, quote and relationship requests without changing empty results', async () => {
  const h = await harness({ posts: { data: [posts[1]], error: null }, media: { data: [], error: null } });
  const result = await h.hydrate([events[1]]);
  assert.deepEqual(h.started.map((query) => query.role).sort(), ['media', 'posts', 'reactions', 'reposts', 'saves']);
  assert.equal(result[0].following, false); assert.equal(result[0].authorFollowsViewer, false);
  assert.equal(result[0].quotedPost, null); assert.deepEqual(Array.from(result[0].mediaRows), []);
  const empty = await harness(); assert.deepEqual(Array.from(await empty.hydrate([])), []); assert.equal(empty.started.length, 0);
});

test('base response errors retain their original priority before early quote/relationship failures', async () => {
  const quoteError = new Error('quote denied'), followError = new Error('follow denied');
  const ordered = ['posts', 'actor', 'reactions', 'reposts', 'saves'];
  for (let index = 0; index < ordered.length; index++) {
    const errors = ordered.slice(index).map((name) => [name, new Error(`${name} denied`)]);
    const overrides = Object.fromEntries(errors.map(([name, error]) => [name, { data: null, error }]));
    if (index === 0) overrides.posts = { data: null, error: errors[0][1] };
    const h = await harness({ ...overrides, quote: { data: null, error: quoteError }, follow: { data: null, error: followError } });
    await assert.rejects(h.hydrate([...events, repost]), (error) => error === errors[0][1]);
    if (index === 0) assert.ok(!h.started.some((query) => ['quote', 'follow', 'reverse', 'interest'].includes(query.role)));
    await tick(); // Node's test runner also rejects any unhandled early failures.
  }
});

test('quote failures do not wait for unresolved author reads and still precede their errors', async () => {
  const follow = deferred(), quoteError = new Error('quote denied');
  const h = await harness({ quote: { data: null, error: quoteError }, follow: follow.promise });
  let outcome;
  const pending = h.hydrate().then(() => { outcome = 'unexpected success'; }, (error) => { outcome = error; });
  await tick(); assert.equal(outcome, quoteError, 'quoted-post denial should not be hidden behind a pending relationship request');
  follow.resolve({ data: null, error: new Error('follow denied later') });
  await pending; await tick();
});

test('transport post rejection executes once and cannot leave a dangling dependent rejection', async () => {
  const failure = new Error('post transport failed');
  const h = await harness({ posts: () => Promise.reject(failure) });
  await assert.rejects(h.hydrate(), (error) => error === failure);
  await tick();
  assert.equal(h.started.find((query) => query.role === 'posts').executions, 1);
  assert.ok(!h.started.some((query) => ['quote', 'follow', 'reverse', 'interest'].includes(query.role)));
});

test('early relationship denials stay captured while a slow base read finishes', async () => {
  const media = deferred(), denied = new Error('follow denied');
  const h = await harness({ media: media.promise, follow: { data: null, error: denied } });
  let outcome;
  const pending = h.hydrate().then(() => { outcome = 'unexpected success'; }, (error) => { outcome = error; });
  await tick(); assert.equal(outcome, undefined);
  media.resolve({ data: responses.media, error: null });
  await pending; assert.equal(outcome, denied);
});
