import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const PROD_ORIGIN = 'https://sautilink.com';
const MEDIA_ID = 'e8112731-c3c3-44dc-ac7f-573d99d6a24c';
const EXPECTED_ORIGINAL_BYTES = 5_077_713;
const WIDTHS = [480, 960, 1440];
const SIGN_IN_ATTEMPTS = 18;
const SIGN_IN_RETRY_MS = 10_000;

const apiSource = await readFile(new URL('../src/sauti-media-api.js', import.meta.url), 'utf8');
const urlMatch = apiSource.match(/const SUPABASE_URL = '([^']+)'/);
const keyMatch = apiSource.match(/const SUPABASE_PUBLISHABLE_KEY = '([^']+)'/);
if (!urlMatch || !keyMatch) throw new Error('PUBLIC_SUPABASE_CONFIG_NOT_FOUND');

const supabase = createClient(urlMatch[1], keyMatch[1], {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function headersFrom(response) {
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
    headers: { Authorization: `Bearer ${token}`, Accept: 'image/*', ...extraHeaders },
  });
  const bytes = (await response.arrayBuffer()).byteLength;
  return {
    label,
    status: response.status,
    wallMs: Math.round((performance.now() - startedAt) * 10) / 10,
    bytes,
    ...headersFrom(response),
  };
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

const syntheticEmail = `sautilink-media-probe-v2-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
const syntheticPassword = `${randomBytes(32).toString('base64url')}Aa1!`;
const signUp = await supabase.auth.signUp({
  email: syntheticEmail,
  password: syntheticPassword,
  options: { data: { purpose: 'media-performance-probe-v2' } },
});

if (signUp.error || !signUp.data?.user?.id) {
  console.log('SYNTHETIC_SIGNUP_FAILED');
  console.log(JSON.stringify({ code: signUp.error?.code || null, status: signUp.error?.status || null }));
  process.exit(4);
}

const syntheticUserId = signUp.data.user.id;
console.log(`SYNTHETIC_SIGNUP_CREATED email=${syntheticEmail} user_id=${syntheticUserId}`);

let session = signUp.data.session || null;
for (let attempt = 1; !session && attempt <= SIGN_IN_ATTEMPTS; attempt += 1) {
  const signIn = await supabase.auth.signInWithPassword({ email: syntheticEmail, password: syntheticPassword });
  if (signIn.data?.session?.access_token) {
    session = signIn.data.session;
    break;
  }
  console.log(`SYNTHETIC_SIGNIN_WAIT attempt=${attempt} code=${signIn.error?.code || 'unknown'} status=${signIn.error?.status || 'unknown'}`);
  if (attempt < SIGN_IN_ATTEMPTS) await sleep(SIGN_IN_RETRY_MS);
}

if (!session?.access_token) {
  console.log(`SYNTHETIC_SIGNIN_FAILED email=${syntheticEmail} user_id=${syntheticUserId}`);
  process.exit(5);
}

const token = session.access_token;
const results = [];
let failure = null;

try {
  for (const width of WIDTHS) {
    results.push(await fetchMedia(token, `w${width}-first`, `?w=${width}`));
    results.push(await fetchMedia(token, `w${width}-second`, `?w=${width}`));
  }
  results.push(await fetchMedia(token, 'original'));

  const etag960 = results.find((item) => item.label === 'w960-second')?.etag;
  if (etag960) {
    results.push(await fetchMedia(token, 'w960-revalidate', '?w=960', { 'If-None-Match': etag960 }));
  }

  const original = results.find((item) => item.label === 'original');
  ensure(original?.status === 200, `original HTTP ${original?.status}`);
  ensure(original?.contentType === 'image/jpeg', `original type ${original?.contentType}`);
  ensure(original?.variant === 'original', `original variant ${original?.variant}`);
  ensure(original?.bytes === EXPECTED_ORIGINAL_BYTES, `original bytes ${original?.bytes}`);

  for (const width of WIDTHS) {
    for (const phase of ['first', 'second']) {
      const item = results.find((row) => row.label === `w${width}-${phase}`);
      ensure(item?.status === 200, `${item?.label} HTTP ${item?.status}`);
      ensure(item?.contentType === 'image/webp', `${item?.label} type ${item?.contentType}`);
      ensure(item?.variant === `v1;w=${width}`, `${item?.label} variant ${item?.variant}`);
      ensure(item?.bytes > 0 && item.bytes < EXPECTED_ORIGINAL_BYTES, `${item?.label} bytes ${item?.bytes}`);
      ensure(['HIT', 'MISS'].includes(item?.edgeCache), `${item?.label} cache ${item?.edgeCache}`);
    }
  }

  const revalidate = results.find((item) => item.label === 'w960-revalidate');
  ensure(revalidate?.status === 304, `revalidate HTTP ${revalidate?.status}`);
  ensure(revalidate?.bytes === 0, `revalidate bytes ${revalidate?.bytes}`);
  console.log('AUTHORIZED_MEDIA_PROBE_PASS');
} catch (error) {
  failure = error;
  console.log('AUTHORIZED_MEDIA_PROBE_ASSERTION_FAILED');
} finally {
  console.log(JSON.stringify({
    syntheticEmail,
    syntheticUserId,
    mediaId: MEDIA_ID,
    expectedOriginalBytes: EXPECTED_ORIGINAL_BYTES,
    results: results.map((item) => ({
      ...item,
      savingsPercent: item.status === 200 && item.bytes > 0
        ? Math.round((1 - item.bytes / EXPECTED_ORIGINAL_BYTES) * 1000) / 10
        : null,
    })),
  }, null, 2));
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}

if (failure) {
  console.error(failure.message || String(failure));
  process.exit(6);
}
