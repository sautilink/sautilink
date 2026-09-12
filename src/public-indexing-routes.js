import { handlePublicIndexingRequest } from './public-indexing-api.js';

const PRODUCTION_SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const PRODUCTION_SUPABASE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const PRIVATE_ROBOTS = 'noindex, nofollow, noarchive';
const LEGACY_PUBLIC_ROUTE = /^\/app\/(?:u\/[^/]+|sauti\/[0-9a-f-]{36})\/?$/i;

const ROUTE_ALIASES = new Map([
  ['/api/public-index/sitemap.xml', '/sitemap-social.xml'],
  ['/api/public-index/profiles.xml', '/sitemap-social-profiles.xml'],
  ['/api/public-index/posts.xml', '/sitemap-social-posts.xml'],
]);

function indexingEnv(env) {
  return {
    ...env,
    PUBLIC_INDEX_SUPABASE_URL: env.PUBLIC_INDEX_SUPABASE_URL || PRODUCTION_SUPABASE_URL,
    PUBLIC_INDEX_SUPABASE_KEY: env.PUBLIC_INDEX_SUPABASE_KEY || PRODUCTION_SUPABASE_KEY,
  };
}

function mappedRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

async function noindexAppShell(request, env) {
  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  const url = new URL('/app/', request.url);
  const response = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('X-Robots-Tag', PRIVATE_ROBOTS);
  headers.delete('Content-Length');
  headers.delete('ETag');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function rewriteSitemapIndex(response, request) {
  if (!response || request.method === 'HEAD' || !response.ok) return response;
  const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
  if (!contentType.includes('xml')) return response;

  const body = (await response.text())
    .replaceAll('https://sautilink.com/sitemap-social-profiles.xml', 'https://sautilink.com/api/public-index/profiles.xml')
    .replaceAll('https://sautilink.com/sitemap-social-posts.xml', 'https://sautilink.com/api/public-index/posts.xml');
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete('ETag');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handlePublicIndexingRoutes(request, env) {
  const url = new URL(request.url);
  const alias = ROUTE_ALIASES.get(url.pathname);
  const safeEnv = indexingEnv(env);

  if (LEGACY_PUBLIC_ROUTE.test(url.pathname) && (request.method === 'GET' || request.method === 'HEAD')) {
    return noindexAppShell(request, env);
  }

  if (alias) {
    const response = await handlePublicIndexingRequest(mappedRequest(request, alias), safeEnv);
    return url.pathname === '/api/public-index/sitemap.xml'
      ? rewriteSitemapIndex(response, request)
      : response;
  }

  return handlePublicIndexingRequest(request, safeEnv);
}
