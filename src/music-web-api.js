const PREFIX = '/api/music';
const TRACK = /^[a-z0-9-]{1,80}$/;
export async function handleMusicWebRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX + '/')) return null;
  const parts = url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
  if (parts[0] !== 'tracks' || parts.length > 3 || parts[1] && !TRACK.test(parts[1])
      || parts[2] && !['cover', 'preview'].includes(parts[2])) return new Response('Not found', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  if (!env.SAUTILINK_MUSIC?.fetch) return new Response('Music is temporarily unavailable.', { status: 503 });
  const upstream = new URL('/v1/' + parts.join('/'), 'https://music.sautilink.com');
  // Public read only. Never forward a member token, cookie or caller-selected territory.
  for (const key of ['q', 'limit', 'offset', 'compact', 'startMs', 'durationMs']) {
    if (url.searchParams.has(key)) upstream.searchParams.set(key, url.searchParams.get(key));
  }
  upstream.searchParams.set('placement', 'feed');
  const headers = new Headers({ Accept: parts[2] ? '*/*' : 'application/json' });
  for (const key of ['Range', 'If-Range', 'If-None-Match']) if (request.headers.has(key)) headers.set(key, request.headers.get(key));
  try {
    const response = await env.SAUTILINK_MUSIC.fetch(new Request(upstream, { method: request.method, headers, cf: request.cf, redirect: 'manual' }));
    if (response.status >= 300 && response.status < 400 && response.status !== 304) return new Response('Music is temporarily unavailable.', { status: 502 });
    const output = new Headers();
    for (const key of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag']) if (response.headers.has(key)) output.set(key, response.headers.get(key));
    output.set('Cache-Control', response.ok ? (parts[2] === 'cover' ? 'private, max-age=300' : 'private, max-age=20') : 'no-store');
    output.set('X-Content-Type-Options', 'nosniff'); output.set('Cross-Origin-Resource-Policy', 'same-origin');
    output.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: output });
  } catch { return new Response('Music is temporarily unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
