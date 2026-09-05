const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const MAX_POLL_OPTIONS = 4;
const MIN_POLL_OPTIONS = 2;
const MAX_OPTION_LENGTH = 80;
const MAX_BATCH_POSTS = 30;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function apiError(status, code, message) {
  return json(status, { ok: false, error: { code, message } });
}

function authorization(request) {
  const value = String(request.headers.get('Authorization') || '').trim();
  return /^Bearer\s+\S+$/i.test(value) ? value : '';
}

function headers(auth = '') {
  const result = { apikey: SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' };
  if (auth) result.Authorization = auth;
  return result;
}

function uuid(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : '';
}

async function authenticate(request) {
  const auth = authorization(request);
  if (!auth) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: headers(auth) });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? { auth, user } : null;
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return null;
  const options = value.map((item) => String(item || '').trim());
  if (options.length < MIN_POLL_OPTIONS || options.length > MAX_POLL_OPTIONS) return null;
  if (options.some((item) => !item || item.length > MAX_OPTION_LENGTH)) return null;
  const distinct = new Set(options.map((item) => item.toLocaleLowerCase()));
  return distinct.size === options.length ? options : null;
}

async function createPoll(request) {
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before creating a poll.');

  const payload = await request.json().catch(() => null);
  const postId = uuid(payload?.post_id);
  const options = normalizeOptions(payload?.options);
  if (!postId) return apiError(400, 'INVALID_POST', 'This post is unavailable.');
  if (!options) return apiError(400, 'INVALID_POLL', 'A poll needs 2 to 4 different options, each 80 characters or fewer.');

  const postParams = new URLSearchParams({
    id: `eq.${postId}`,
    author_id: `eq.${session.user.id}`,
    select: 'id,author_id',
    limit: '1',
  });
  const postResponse = await fetch(`${SUPABASE_URL}/rest/v1/social_posts?${postParams}`, { headers: headers(session.auth) });
  if (!postResponse.ok) return apiError(409, 'POLL_POST_LOOKUP_FAILED', 'The poll could not be attached to this post.');
  const posts = await postResponse.json().catch(() => []);
  if (!Array.isArray(posts) || !posts[0]?.id) return apiError(403, 'POLL_POST_FORBIDDEN', 'Only the post author can add this poll.');

  const pollResponse = await fetch(`${SUPABASE_URL}/rest/v1/social_post_polls`, {
    method: 'POST',
    headers: { ...headers(session.auth), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ post_id: postId, author_id: session.user.id }),
  });
  if (!pollResponse.ok) return apiError(409, 'POLL_CREATE_FAILED', 'The poll could not be created.');

  const optionRows = options.map((label, position) => ({
    post_id: postId,
    position,
    label,
  }));
  const optionsResponse = await fetch(`${SUPABASE_URL}/rest/v1/social_post_poll_options`, {
    method: 'POST',
    headers: { ...headers(session.auth), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(optionRows),
  });
  if (!optionsResponse.ok) {
    const cleanup = new URLSearchParams({ post_id: `eq.${postId}`, author_id: `eq.${session.user.id}` });
    await fetch(`${SUPABASE_URL}/rest/v1/social_post_polls?${cleanup}`, { method: 'DELETE', headers: headers(session.auth) }).catch(() => {});
    return apiError(409, 'POLL_OPTIONS_FAILED', 'The poll options could not be saved.');
  }

  return json(201, { ok: true, data: { post_id: postId } });
}

function postIdsFromQuery(url) {
  const values = String(url.searchParams.get('post_ids') || '').split(',').map(uuid).filter(Boolean);
  return [...new Set(values)].slice(0, MAX_BATCH_POSTS);
}

async function readPolls(request) {
  const url = new URL(request.url);
  const postIds = postIdsFromQuery(url);
  if (!postIds.length) return json(200, { ok: true, data: { polls: [] } });

  const auth = authorization(request);
  const session = auth ? await authenticate(request) : null;
  const inFilter = `in.(${postIds.join(',')})`;

  const pollParams = new URLSearchParams({ post_id: inFilter, select: 'post_id,total_votes' });
  const optionParams = new URLSearchParams({ post_id: inFilter, select: 'id,post_id,position,label,vote_count', order: 'position.asc' });
  const [pollResponse, optionResponse] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/social_post_polls?${pollParams}`, { headers: headers(auth) }),
    fetch(`${SUPABASE_URL}/rest/v1/social_post_poll_options?${optionParams}`, { headers: headers(auth) }),
  ]);
  if (!pollResponse.ok || !optionResponse.ok) return apiError(409, 'POLL_READ_FAILED', 'Polls could not be loaded.');

  const polls = await pollResponse.json().catch(() => []);
  const options = await optionResponse.json().catch(() => []);
  let votes = [];
  if (session) {
    const voteParams = new URLSearchParams({
      post_id: inFilter,
      voter_id: `eq.${session.user.id}`,
      select: 'post_id,option_id',
    });
    const voteResponse = await fetch(`${SUPABASE_URL}/rest/v1/social_post_poll_votes?${voteParams}`, { headers: headers(session.auth) });
    if (voteResponse.ok) votes = await voteResponse.json().catch(() => []);
  }

  const optionsByPost = new Map();
  for (const option of Array.isArray(options) ? options : []) {
    if (!optionsByPost.has(option.post_id)) optionsByPost.set(option.post_id, []);
    optionsByPost.get(option.post_id).push(option);
  }
  const voteByPost = new Map((Array.isArray(votes) ? votes : []).map((vote) => [vote.post_id, vote.option_id]));
  const payload = (Array.isArray(polls) ? polls : []).map((poll) => ({
    post_id: poll.post_id,
    total_votes: Number(poll.total_votes || 0),
    voted_option_id: voteByPost.get(poll.post_id) || null,
    options: optionsByPost.get(poll.post_id) || [],
  }));
  return json(200, { ok: true, data: { polls: payload } });
}

async function vote(request) {
  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in before voting.');
  const payload = await request.json().catch(() => null);
  const postId = uuid(payload?.post_id);
  const optionId = uuid(payload?.option_id);
  if (!postId || !optionId) return apiError(400, 'INVALID_VOTE', 'Choose a valid poll option.');

  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_post_poll_votes`, {
    method: 'POST',
    headers: { ...headers(session.auth), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ post_id: postId, option_id: optionId, voter_id: session.user.id }),
  });
  if (!response.ok) {
    if (response.status === 409) return apiError(409, 'ALREADY_VOTED', 'You have already voted in this poll.');
    return apiError(409, 'POLL_VOTE_FAILED', 'Your vote could not be recorded.');
  }
  return json(201, { ok: true, data: { post_id: postId, option_id: optionId } });
}

export async function handlePollRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === '/api/polls' && request.method === 'GET') return readPolls(request);
  if (url.pathname === '/api/polls/create' && request.method === 'POST') return createPoll(request);
  if (url.pathname === '/api/polls/vote' && request.method === 'POST') return vote(request);
  return null;
}
