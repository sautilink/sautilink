import { APP_LINK_HOSTS } from './android-app-links.js';

// The manifest id is "/" on the canonical origin, resolving to this URL.
export const PWA_ID = 'https://sautilink.com/';
export const WWW_PWA_ID = 'https://www.sautilink.com/';
export const PWA_ORIGIN_ASSOCIATION = Object.freeze({
  [PWA_ID]: { scope: '/' },
  [WWW_PWA_ID]: { scope: '/' },
});

export function pwaOriginAssociationResponse(request, url) {
  if (url.pathname !== '/.well-known/web-app-origin-association'
    || !APP_LINK_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(PWA_ORIGIN_ASSOCIATION), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
