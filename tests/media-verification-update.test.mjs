import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { uploadPostMedia } from '../src/post-media-upload.js';
import { verificationAccountType, verificationEvidenceReady, rankTrendingPosts } from '../src/verification-request-policy.js';
import { transformPostMediaSource } from '../scripts/post-media-source-transform.mjs';
import { transformVerificationCaseFlowSource } from '../scripts/verification-case-flow-source-transform.mjs';
import { transformMemberBootstrapResilienceSource } from '../scripts/member-bootstrap-resilience-source-transform.mjs';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const app = await read('src/app.js');
const formats = await read('src/composer-formats.js');
const extract = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing function ${start}`);
  return source.slice(from, to);
};
const id = '00000000-0000-4000-8000-000000000001';
const chunkSession = (size) => ({ upload_url: `/api/sauti-media/upload/${id}`, chunk_upload: { part_size_bytes: 8388608,
  part_count: Math.ceil(size / 8388608), part_url: `/api/sauti-media/upload/${id}?part={part}`,
  complete_url: `/api/sauti-media/upload/${id}?complete=1` } });
const videoFile = (size) => ({ size, type: 'video/mp4', slice(from, to, type) { return { size: to - from, type }; } });

test('a 250 MiB video uploads in bounded ordered parts then completes with current credentials', async () => {
  const calls = [], progress = [];
  let tokens = 0;
  await uploadPostMedia(chunkSession(262144000), videoFile(262144000), async () => `Bearer renewed-${++tokens}`,
    (value) => progress.push(value), async (url, bytes, token, report) => { calls.push({ url, size: bytes.size, token }); report(50); report(100); });
  assert.equal(calls.length, 33);
  assert.equal(calls[0].size, 8388608);
  assert.equal(calls[31].size, 2097152);
  assert.equal(calls[32].size, 0);
  assert.ok(calls[32].url.endsWith('?complete=1'));
  assert.equal(tokens, 33);
  assert.ok(calls.every((call, i) => call.token === `Bearer renewed-${i + 1}`));
  assert.ok(progress.every((value, i) => value >= 0 && value <= 100 && (!i || value >= progress[i - 1])));
  assert.equal(progress.at(-1), 100);
});

test('upload stops without completion when an account or selected item changes', async () => {
  let active = true;
  const calls = [];
  await assert.rejects(uploadPostMedia(chunkSession(20000000), videoFile(20000000), 'Bearer current', () => {},
    async (url) => { calls.push(url); active = false; }, () => active), /cancelled/);
  assert.equal(calls.length, 1);
  assert.ok(!calls.some((url) => url.includes('complete')));
});

test('invalid chunk targets cannot receive a bearer and small media retains its existing upload path', async () => {
  const bad = chunkSession(9000000); bad.chunk_upload.part_url = `https://other.invalid/${id}?part={part}`;
  let calls = 0;
  await assert.rejects(uploadPostMedia(bad, videoFile(9000000), 'Bearer private', () => {}, () => { calls++; }), /invalid/);
  assert.equal(calls, 0);
  const mismatch = chunkSession(9000000); mismatch.upload_url = '/api/sauti-media/upload/00000000-0000-4000-8000-000000000002';
  await assert.rejects(uploadPostMedia(mismatch, videoFile(9000000), 'Bearer private', () => {}, () => { calls++; }), /invalid/);
  await assert.rejects(uploadPostMedia(chunkSession(262144001), videoFile(262144001), 'Bearer private', () => {}, () => { calls++; }), /invalid/);
  assert.equal(calls, 0);
  await uploadPostMedia({ upload_url: `/api/sauti-media/upload/${id}` }, videoFile(1000), 'Bearer current', () => {},
    (url, file, token) => { calls++; assert.equal(file.size, 1000); assert.equal(token, 'Bearer current'); assert.ok(url.endsWith(id)); });
  assert.equal(calls, 1);
});

test('individual evidence rules stay intact and every nonindividual type requires an article', () => {
  assert.equal(verificationAccountType(undefined), 'individual');
  assert.equal(verificationEvidenceReady('individual', ['known-profile'], []), true);
  assert.equal(verificationEvidenceReady('individual', [], ['https://news.example/article']), true);
  assert.equal(verificationEvidenceReady('individual', [], []), false);
  for (const type of ['business', 'brand', 'entity', 'organisation']) {
    assert.equal(verificationEvidenceReady(type, ['popular-profile'], []), false);
    assert.equal(verificationEvidenceReady(type, [], ['https://news.example/article']), true);
  }
  const runtime = transformVerificationCaseFlowSource('/repo/src/app.js', app);
  assert.match(runtime, /p_account_type: verificationAccountType/);
  assert.match(runtime, /supabase\.rpc\('submit_verification_case'/);
  const errorSource = extract(runtime, 'function verificationSubmissionError(', "window.addEventListener('focus'");
  const message = runInNewContext(errorSource + '\nverificationSubmissionError;');
  for (const code of ['VERIFICATION_ARTICLE_REQUIRED', 'VERIFICATION_ARTICLES_REQUIRED']) {
    assert.equal(message({ message: code }), 'Add at least one independent news or blog article about this entity.');
  }
  assert.doesNotMatch(runtime, /window\.location\.assign\(`mailto:team@sautilink/);
});

test('badge policy definitions sit inside the existing account and identity legal sections', async () => {
  for (const [file, section] of [['terms.html', 'accounts'], ['community-guidelines.html', 'identity']]) {
    const html = await read(file);
    const start = html.indexOf(`<section class="legal-section" id="${section}"`);
    const end = html.indexOf('</section>', start);
    assert.ok(start >= 0 && end > start);
    assert.match(html.slice(start, end), /Verification badge meanings/);
    assert.doesNotMatch(html.slice(html.indexOf('<section class="trust-grid"'), html.indexOf('<article class="legal-document"')), /Verification badge meanings/);
  }
});

test('verification form switches the actual required field when the identity type changes', () => {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', dataset: {}, hidden: false, checked: true,
      setAttribute() {}, setCustomValidity(message) { this.validityMessage = message; } });
    return nodes.get(id);
  };
  const form = byId('verification-request-form');
  form.checkValidity = () => !byId('verification-articles').required || Boolean(byId('verification-articles').value);
  const sync = runInNewContext(`${extract(app, 'function syncVerificationRequestState(', 'function openVerificationRequestDialog(')}\nsyncVerificationRequestState;`, {
    byId, verificationAccountType, verificationEvidenceReady,
    VERIFICATION_SOCIAL_FIELDS: [['verification-facebook']], verificationSocialHandle: (v) => v || '',
    verificationArticleLinks: () => byId('verification-articles').value ? [byId('verification-articles').value] : [],
    verificationArticleLinksValid: (links) => links.every((link) => link.startsWith('https://')),
  });
  byId('verification-facebook').value = 'known-account';
  byId('verification-account-type').value = 'business'; sync();
  assert.equal(byId('verification-articles').required, true);
  assert.equal(byId('verification-request-send').disabled, true);
  byId('verification-articles').value = 'https://news.example/story'; sync();
  assert.equal(byId('verification-request-send').disabled, false);
  byId('verification-account-type').value = 'individual'; byId('verification-articles').value = ''; sync();
  assert.equal(byId('verification-articles').required, false);
  assert.equal(byId('verification-request-send').disabled, false);
});

test('Trending uses the native engagement score, excludes blocked/muted authors and bounds results', () => {
  const posts = Array.from({ length: 12 }, (_, n) => ({ id: String(n), author_id: `author-${n}`, like_count: n,
    comment_count: 0, repost_count: 0, created_at: '2026-10-23T00:00:00Z' }));
  posts[0].comment_count = 10;
  const result = rankTrendingPosts([...posts, posts[0]], { blocked: new Set(['author-11']), muted: new Set(['author-10']) });
  assert.deepEqual(result.map((row) => row.id), ['0', '9', '8', '7', '6']);
  assert.equal(rankTrendingPosts(posts, { limit: 20 }).length, 12);
  const candidates = extract(app, 'async function loadDiscoverTrendingCandidates(', 'async function loadTrendingPostDetails(');
  assert.match(candidates, /7 \* 24 \* 60 \* 60 \* 1000/);
  for (const marker of [".eq('visibility', 'public')", ".is('circle_id', null)", ".eq('post_status', 'published')", ".is('deleted_at', null)", '.limit(250)']) assert.ok(candidates.includes(marker));
  const built = transformMemberBootstrapResilienceSource('/repo/src/app.js', app);
  assert.match(built, /async function loadStream[^]*?if \(activeHomeFeed === 'trending'\) return loadTrendingStream/);
});

test('post media runtime admits ten items at 5 MiB/photo and preserves the full gallery count', () => {
  const runtime = transformPostMediaSource('/repo/src/app.js', app);
  assert.match(runtime, /Math\.max\(0, 10 - composerMedia\.length\)/);
  assert.match(runtime, /composerMedia\.length \+ files\.length > 10/);
  assert.match(runtime, /bucket\.length >= 10/);
  assert.match(runtime, /image \? 5 \* 1024 \* 1024 : 250 \* 1024 \* 1024/);
});

test('all media entry paths share 180-second preparation and oversized files fail before a metadata read', async () => {
  const source = extract(formats, 'export async function preparePostComposerFiles(', 'async function validateSelectedShortVideo(').replace('export ', '');
  let reads = 0, trims = 0;
  const prepare = runInNewContext(`${source}\npreparePostComposerFiles;`, {
    POST_VIDEO_LIMIT_SECONDS: 180, POST_VIDEO_MAX_BYTES: 262144000, preparedPostVideos: new WeakSet(),
    videoDuration: async (file) => { reads++; return file.duration; },
    promptVideoTrim: async (file) => { trims++; return { ...file, duration: 180, trimmed: true }; },
  });
  const boundary = { type: 'video/mp4', size: 262144000, duration: 180 };
  assert.equal((await prepare([boundary]))[0], boundary);
  assert.equal(trims, 0);
  await prepare([boundary]); assert.equal(reads, 1, 'a validated file is not read again by the input and queue paths');
  const longer = await prepare([{ type: 'video/mp4', size: 1000, duration: 180.01 }]);
  assert.equal(longer[0].trimmed, true); assert.equal(trims, 1);
  await assert.rejects(prepare([{ type: 'video/mp4', size: 262144001, duration: 2 }]), /250 MiB/);
  assert.equal(reads, 2);
  await assert.rejects(prepare([{ type: 'video/mp4', size: 1000, duration: null }]), /duration/);
  assert.match(app, /async function addComposerFiles[^]*?await preparePostComposerFiles/);
});

test('after publishing, Home is selected and an authoritative own post is prepended without a history back race', async () => {
  const changes = [], feed = { children: [], querySelectorAll() { return this.children; }, prepend(card) { this.children.unshift(card); } };
  const context = { currentMemberId: 'owner', activeHomeFeed: 'short-videos', streamRequest: 1, streamLoading: true, streamSurface: { hidden: false }, THREAD_POST_SELECT: 'id',
    closeSautiComposer(options) { assert.equal(options.syncUrl, false); changes.push('close'); },
    showMemberSurface(name, options) { assert.equal(name, 'stream'); assert.equal(options.syncUrl, false); changes.push('home'); },
    window: { history: { replaceState(_state, _title, url) { assert.equal(url, '/home'); changes.push('route'); } }, dispatchEvent() {}, scrollTo() {} }, Event,
    loadStream: async () => { changes.push('fresh-feed'); }, byId: (name) => name === 'stream-feed' ? feed : {},
    supabase: { from() { return { select() { return this; }, eq(key, value) { if (key === 'author_id') assert.equal(value, 'owner'); return this; }, maybeSingle: async () => ({ data: { id } }) }; } },
    hydrateDirectPosts: async (rows) => rows, createSautiCard: (row) => ({ dataset: { postId: row.id } }),
  };
  const navigate = runInNewContext(`${extract(app, 'async function returnHomeAfterPost(', 'async function shareSauti(')}\nreturnHomeAfterPost;`, context);
  await navigate(id, 'owner');
  assert.deepEqual(changes, ['close', 'route', 'home', 'fresh-feed']);
  assert.equal(feed.children[0].dataset.postId, id);
  assert.equal(context.activeHomeFeed, 'for-you');
  context.currentMemberId = 'other'; await navigate(id, 'owner'); assert.equal(changes.length, 4);
});

test('Shorts labels contain only ranks returned by the real top20 and never manufacture a rank', async () => {
  const shorts = await read('src/short-videos-feed.js');
  let suffix;
  class Node {
    constructor() { this.children = []; }
    replaceChildren(...children) { this.children = children; }
    remove() { suffix = undefined; }
  }
  const username = { after(node) { suffix = node; } };
  const slide = { dataset: { postId: id }, querySelector(selector) { return selector === '.sauti-short-username' ? username : suffix; } };
  const render = runInNewContext(`${extract(shorts, 'function syncShortTrendingRank(', 'function syncSlideFromSource(')}\nsyncShortTrendingRank;`, {
    document: { createElement: () => new Node(), createTextNode: (text) => ({ textContent: text }) },
  });
  for (const value of [undefined, 0, -1, 21, 1.5, '11']) { render(slide, { [id]: value }); assert.equal(suffix, undefined); }
  render(slide, { [id]: 11 });
  assert.deepEqual(suffix.children.map((node) => node.textContent), [' • ', '#11', ' on trending']);
  render(slide, {}); assert.equal(suffix, undefined);
  assert.match(shorts, /if \(sourceFollow && sourceFollow\.dataset\.following !== 'true'\)/);
  assert.match(shorts, /follow\.disabled = sourceFollow\.disabled \|\| following/);
});
