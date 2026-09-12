import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const PROD_ORIGIN = 'https://sautilink.com';
const MEDIA_ID = 'e8112731-c3c3-44dc-ac7f-573d99d6a24c';
const WIDTHS = [480, 960, 1440];

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

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

const { data, error } = await supabase.auth.signInAnonymously();
if (error || !data?.session?.access_token || !data?.user?.id) {
  console.log('ANONYMOUS_AUTH_UNAVAILABLE');
  console.log(JSON.stringify({ code: error?.code || null, status: error?.status || null, message: error?.message || 'No session returned' }));
  process.exit(3);
}

const token = data.session.access_token;
const syntheticUserId = data.user.id;
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
  console.log(JSON.stringify({ syntheticUserId, mediaId: MEDIA_ID, results }, null, 2));
} finally {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}
