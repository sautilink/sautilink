import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const PROD_ORIGIN = 'https://sautilink.com';
const MEDIA_ID = 'e8112731-c3c3-44dc-ac7f-573d99d6a24c';
const WIDTHS = [480, 960, 1440];
const SIGN_IN_ATTEMPTS = 12;
const SIGN_IN_RETRY_MS = 10_000;

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pickHeaders(response) {
  return {
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
    etag: response.headers.get('etag'),
    variant: response.headers.get('x-sauti-media-variant'),
    edgeCache: response.headers.get('x-sauti-media-cache'),
    serverTiming: response.headers.get('server-timing'),
  };
}

async function fetchMedia(token, label, suffix = '', extraHeaders = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${PROD_ORIGIN}/api/sauti-media/${MEDIA_ID}${suffix}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'image/*',
      ...extraHeaders,
    },
  });
  const buffer = await response.arrayBuffer();
  return {
    label,
    status: response.status,
    wallMs: Math.round((performance.now() - startedAt) * 10) / 10,
    bytes: buffer.byteLength,
    ...pickHeaders(response),
  };
}

const syntheticEmail = `sautilink-media-probe-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
const syntheticPassword = `${randomBytes(32).toString('base64url')}Aa1!`;

const signUp = await supabase.auth.signUp({
  email: syntheticEmail,
  password: syntheticPassword,
  options: {
    data: { purpose: 'media-performance-probe' },
  },
});

if (signUp.error || !signUp.data?.user?.id) {
  console.log('SYNTHETIC_SIGNUP_FAILED');
  console.log(JSON.stringify({
    code: signUp.error?.code || null,
    status: signUp.error?.status || null,
    message: signUp.error?.message || 'No user returned',
  }));
  process.exit(4);
}

const syntheticUserId = signUp.data.user.id;
console.log(`SYNTHETIC_SIGNUP_CREATED email=${syntheticEmail} user_id=${syntheticUserId}`);

let session = signUp.data.session || null;
let lastSignInError = null;

for (let attempt = 1; !session && attempt <= SIGN_IN_ATTEMPTS; attempt += 1) {
  const signIn = await supabase.auth.signInWithPassword({
    email: syntheticEmail,
    password: syntheticPassword,
  });
  if (signIn.data?.session?.access_token) {
    session = signIn.data.session;
    break;
  }

  lastSignInError = signIn.error;
  console.log(`SYNTHETIC_SIGNIN_WAIT attempt=${attempt} code=${signIn.error?.code || 'unknown'} status=${signIn.error?.status || 'unknown'}`);
  if (attempt < SIGN_IN_ATTEMPTS) await sleep(SIGN_IN_RETRY_MS);
}

if (!session?.access_token) {
  console.log('SYNTHETIC_SIGNIN_FAILED');
  console.log(JSON.stringify({
    code: lastSignInError?.code || null,
    status: lastSignInError?.status || null,
    message: lastSignInError?.message || 'No session returned',
    syntheticEmail,
    syntheticUserId,
  }));
  process.exit(5);
}

const token = session.access_token;
const results = [];

try {
  for (const width of WIDTHS) {
    results.push(await fetchMedia(token, `w${width}-first`, `?w=${width}`));
    results.push(await fetchMedia(token, `w${width}-second`, `?w=${width}`));
  }

  results.push(await fetchMedia(token, 'original'));

  const revalidateSource = results.find((item) => item.label === 'w960-second');
  if (revalidateSource?.etag) {
    results.push(await fetchMedia(token, 'w960-revalidate', '?w=960', { 'If-None-Match': revalidateSource.etag }));
  }

  console.log('AUTHORIZED_MEDIA_PROBE_PASS');
  console.log(JSON.stringify({ syntheticEmail, syntheticUserId, mediaId: MEDIA_ID, results }, null, 2));
} finally {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}
