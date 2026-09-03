import { handleProfileMediaRequest } from './profile-media-api.js';
import { handleSautiRequest } from './sauti-posts-api.js';
import { handleSautiMediaRequest } from './sauti-media-api.js';
import { handleSocialInteractionRequest } from './social-interactions-api.js';
import { handleTrustSafetyRequest } from './trust-safety-api.js';
import { handleModerationRequest } from './moderation-api.js';
import { handleAccountControlRequest } from './account-controls-api.js';

const PROFILE_ROUTE = /^\/app\/u\/[^/]+\/?$/;
const AUTH_CONFIRM_ROUTE = /^\/app\/auth\/confirm\/?$/;
const MEMBER_ROUTE = /^\/app\/notifications\/?$/;
const DISCOVER_ROUTE = /^\/app\/discover\/?$/;
const SAVED_ROUTE = /^\/app\/saved\/?$/;
const APPEALS_ROUTE = /^\/app\/appeals\/?$/;
const MODERATION_ROUTE = /^\/app\/moderation\/?$/;
const SETTINGS_ROUTE = /^\/app\/settings\/?$/;
const SAUTI_ROUTE = /^\/app\/sauti\/[0-9a-f-]{36}\/?$/;
const MESSAGE_ROUTE = /^\/app\/messages(?:\/[0-9a-f-]{36})?\/?$/;
// Sautify is canonical; keep the legacy Circles route readable so shared links do not break.
const CIRCLE_ROUTE = /^\/app\/(?:sautify|circles)(?:\/[^/]+)?\/?$/;
const CLEAN_PROFILE_ROUTE = /^\/u\/[^/]+\/?$/;
const CLEAN_MEMBER_ROUTE = /^\/(?:home|discover|saved|appeals|moderation|settings|notifications)\/?$/;
const CLEAN_AUTH_ROUTE = /^\/(?:login|signup)\/?$/;
const CLEAN_POST_ROUTE = /^\/post\/[0-9a-f-]{36}\/?$/;
const CLEAN_MESSAGE_ROUTE = /^\/messages(?:\/[0-9a-f-]{36})?\/?$/;
const CLEAN_SAUTIFY_ROUTE = /^\/sautify(?:\/[^/]+)?\/?$/;
const CLEAN_ROUTE_PREFIX = /^\/(?:login|signup|home|discover|saved|appeals|moderation|settings|notifications|messages|sautify)/;

const STAGING_HOST = 'test.sautilink.com';
const RATE_LIMIT_BINDINGS = [
  'SAUTI_CREATE_LIMITER',
  'SAUTI_DELETE_LIMITER',
  'SAUTI_MEDIA_BEGIN_LIMITER',
  'SOCIAL_FOLLOW_LIMITER',
  'SOCIAL_LIKE_LIMITER',
  'SOCIAL_COMMENT_LIMITER',
  'SOCIAL_COMMENT_DELETE_LIMITER',
  'SOCIAL_REPOST_LIMITER',
  'SAFETY_REPORT_LIMITER',
  'SAFETY_BLOCK_LIMITER',
  'SAFETY_DELETION_LIMITER',
  'SAFETY_MUTE_LIMITER',
  'SAFETY_APPEAL_LIMITER',
  'MODERATION_ACTION_LIMITER',
  'ACCOUNT_CONTROL_LIMITER',
];

function requestId(request) {
  const supplied = String(request.headers.get('X-Request-ID') || '').trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function isApiPath(pathname) {
  return pathname.startsWith('/api/');
}

function isStaging(url) {
  return url.hostname.toLowerCase() === STAGING_HOST;
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function healthResponse(env, url) {
  const assetsReady = Boolean(env.ASSETS);
  const mediaReady = Boolean(env.PROFILE_MEDIA) && Boolean(env.SAUTI_MEDIA);
  const rateLimitsReady = RATE_LIMIT_BINDINGS.every((name) => Boolean(env[name]));
  const ready = assetsReady && mediaReady && rateLimitsReady;

  return json(ready ? 200 : 503, {
    ok: ready,
    data: {
      status: ready ? 'ok' : 'degraded',
      service: 'sautilink-web',
      release_generation: 31,
      environment: isStaging(url) ? 'staging' : 'unknown',
      checks: {
        assets: assetsReady,
        media: mediaReady,
        rate_limits: rateLimitsReady,
      },
    },
  });
}

function stagingRobotsResponse() {
  return new Response('User-agent: *\nDisallow: /\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function finalizeResponse(response, id, url) {
  const headers = new Headers(response.headers);
  headers.set('X-Request-ID', id);
  headers.set('X-Content-Type-Options', 'nosniff');

  if (isApiPath(url.pathname)) {
    headers.set('Cache-Control', 'no-store');
  }

  if (isStaging(url)) {
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function routeRequest(request, env, url) {
  if (url.pathname === '/api/health') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or HEAD for health checks.' } });
    }
    return healthResponse(env, url);
  }

  if (url.pathname === '/robots.txt' && isStaging(url)) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }
    return stagingRobotsResponse();
  }

  if (url.pathname.startsWith('/api/profile-media/')) {
    const mediaResponse = await handleProfileMediaRequest(request, env);
    if (mediaResponse) return mediaResponse;
    return new Response('Not found', { status: 404 });
  }

  if (url.pathname.startsWith('/api/sauti-media/')) {
    const mediaResponse = await handleSautiMediaRequest(request, env);
    if (mediaResponse) return mediaResponse;
    return new Response('Not found', { status: 404 });
  }

  if (url.pathname === '/api/sauti' || url.pathname.startsWith('/api/sauti/')) {
    const sautiResponse = await handleSautiRequest(request, env);
    if (sautiResponse) return sautiResponse;
    return new Response('Not found', { status: 404 });
  }

  if (url.pathname.startsWith('/api/social/')) {
    const socialResponse = await handleSocialInteractionRequest(request, env);
    if (socialResponse) return socialResponse;
    return new Response('Not found', { status: 404 });
  }

  if (url.pathname.startsWith('/api/safety/')) {
    const safetyResponse = await handleTrustSafetyRequest(request, env);
    if (safetyResponse) return safetyResponse;
    return new Response('Not found', { status: 404 });
  }

  if (url.pathname.startsWith('/api/moderation/') || url.pathname === '/api/appeals') {
    const moderationResponse = await handleModerationRequest(request, env);
    if (moderationResponse) return moderationResponse;
    return new Response('Not found', { status: 404 });
  }

  if (url.pathname.startsWith('/api/account/')) {
    const accountResponse = await handleAccountControlRequest(request, env);
    if (accountResponse) return accountResponse;
    return new Response('Not found', { status: 404 });
  }

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    (
      PROFILE_ROUTE.test(url.pathname)
      || AUTH_CONFIRM_ROUTE.test(url.pathname)
      || MEMBER_ROUTE.test(url.pathname)
      || DISCOVER_ROUTE.test(url.pathname)
      || SAVED_ROUTE.test(url.pathname)
      || APPEALS_ROUTE.test(url.pathname)
      || MODERATION_ROUTE.test(url.pathname)
      || SETTINGS_ROUTE.test(url.pathname)
      || SAUTI_ROUTE.test(url.pathname)
      || MESSAGE_ROUTE.test(url.pathname)
      || CIRCLE_ROUTE.test(url.pathname)
      || CLEAN_PROFILE_ROUTE.test(url.pathname)
      || CLEAN_MEMBER_ROUTE.test(url.pathname)
      || CLEAN_AUTH_ROUTE.test(url.pathname)
      || CLEAN_POST_ROUTE.test(url.pathname)
      || CLEAN_MESSAGE_ROUTE.test(url.pathname)
      || CLEAN_SAUTIFY_ROUTE.test(url.pathname)
    )
  ) {
    if (!env.ASSETS) return new Response('Not found', { status: 404 });
    const shellUrl = new URL('/app/', url);
    return env.ASSETS.fetch(new Request(shellUrl, request));
  }

  if (!isStaging(url) && CLEAN_ROUTE_PREFIX.test(url.pathname)) {
    // Production route wildcards are query-safe by design. If a future
    // marketing path merely shares one of these prefixes, pass it through
    // to the existing origin instead of swallowing it with the social asset bundle.
    return fetch(request);
  }

  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = requestId(request);

    try {
      const response = await routeRequest(request, env, url);
      return finalizeResponse(response, id, url);
    } catch {
      console.error('Unhandled SautiLink request', {
        request_id: id,
        method: request.method,
        pathname: url.pathname,
      });

      const response = isApiPath(url.pathname)
        ? json(500, {
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'SautiLink could not complete this request.',
              request_id: id,
            },
          })
        : new Response('SautiLink is temporarily unavailable.', {
            status: 500,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          });

      return finalizeResponse(response, id, url);
    }
  },
};
