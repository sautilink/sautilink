import { STREAM_UID, STREAM_UUID, streamOrigin, streamSourceKey, streamHmac, verifyStreamHmac, streamBase64url, streamOperation } from './sauti-stream-provider.js';
import { sautiStreamContentIdentityPath } from './sauti-stream-content-identity.js';

const TOKEN_TTL = 300;
const MANIFEST_LIMIT = 256 * 1024;
const providerTokens = new Map();
const PLAYBACK_TOKEN_LIMIT = 128;

function decoded(value) {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(String(value || ''))) throw new Error('INVALID_HLS_CAPABILITY');
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), (char) => char.charCodeAt(0)));
}
async function accessHash(scope) {
  if (typeof scope !== 'string' || !scope || scope.length > 8192) return null;
  let stableScope = scope;
  // The caller's successful Supabase/RLS lookup authenticates the token. This
  // parsing ONLY binds the capability to that session across a token refresh;
  // it grants no permission and never replaces the caller's authorization.
  try {
    const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(scope)?.[1];
    const claims = token && JSON.parse(decoded(token.split('.')[1]));
    if (STREAM_UUID.test(String(claims?.sub || '')) && STREAM_UUID.test(String(claims?.session_id || ''))) {
      stableScope = `supabase-session:${claims.sub}:${claims.session_id}`;
    }
  } catch { /* Opaque authenticated caller scopes remain valid too. */ }
  return streamBase64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableScope)));
}

function validAsset(asset) {
  return STREAM_UID.test(String(asset?.stream_uid || '')) && STREAM_UUID.test(String(asset?.generation || ''))
    && STREAM_UUID.test(String(asset?.id || '')) && ['post', 'story'].includes(asset?.kind);
}
function gatewayBase(basePath, asset) {
  const expected = asset.kind === 'story' ? `/api/stories/${asset.id}/hls/` : `/api/sauti-media/${asset.id}/hls/`;
  return basePath === expected ? basePath : null;
}
function safeRelativePath(path) {
  if (typeof path !== 'string' || !path || path.length > 2048 || /[\\\s\u0000-\u001f#]/.test(path)
    || path.startsWith('/') || path.includes('://')) return false;
  const pathname = path.split('?')[0];
  if (!/^[A-Za-z0-9_./%+-]+\.(?:m3u8|ts|m4s|mp4|aac|vtt|key)$/.test(pathname)) return false;
  try {
    const decodedPath = decodeURIComponent(pathname);
    return !decodedPath.split('/').some((part) => part === '.' || part === '..')
      && !/[\\?#\u0000-\u0020]/.test(decodedPath) && !/%(?:2f|5c|2e)/i.test(decodedPath);
  } catch { return false; }
}

async function capabilityUrl(env, asset, base, path, expiry, scopeHash, root = 'token') {
  if (!safeRelativePath(path) || !['token', 'uid'].includes(root)) throw new Error('UNSAFE_HLS_PATH');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const claims = new TextEncoder().encode(JSON.stringify({ v: 2, k: asset.kind, id: asset.id, g: asset.generation,
    u: asset.stream_uid, p: path, r: root, e: expiry, a: scopeHash }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: capabilityContext(asset) }, await capabilityKey(env), claims));
  const sealed = new Uint8Array(iv.length + ciphertext.length); sealed.set(iv); sealed.set(ciphertext, iv.length);
  const payload = streamBase64url(sealed);
  return `${base}${await pathIdentity(path, root, asset.stream_uid)}?c=${payload}.${await streamHmac(env, payload)}`;
}

function capabilityContext(asset) { return new TextEncoder().encode(`sautilink-hls-capability-v2\n${asset.kind}\n${asset.id}`); }
async function capabilityKey(env) {
  const source = streamSourceKey(env);
  if (!source) throw new Error('STREAM_SIGNING_NOT_CONFIGURED');
  const material = await crypto.subtle.importKey('raw', source, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256',
    salt: new TextEncoder().encode('sautilink-stream-v2'),
    info: new TextEncoder().encode('opaque-hls-provider-paths') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function pathIdentity(path, root, uid, legacy = false) {
  // The harmless type hint lets private clients cache only binary segments;
  // expiring manifests and their child capabilities always reauthorize.
  const segment = /\.(?:ts|m4s|mp4|aac)$/.test(path.split('?')[0]);
  const contentPath = legacy ? path : sautiStreamContentIdentityPath(path, root, uid);
  return `${segment ? 's' : 'm'}_${streamBase64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${root}\n${contentPath}`)))}`;
}
async function openCapability(env, asset, payload) {
  if (!/^[A-Za-z0-9_-]{40,4096}$/.test(String(payload || ''))) throw new Error('INVALID_HLS_CAPABILITY');
  const bytes = Uint8Array.from(atob(payload.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - payload.length % 4) % 4)), (char) => char.charCodeAt(0));
  if (bytes.length < 29) throw new Error('INVALID_HLS_CAPABILITY');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12),
    additionalData: capabilityContext(asset) }, await capabilityKey(env), bytes.slice(12));
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
}

/** Caller has authorized this exact current database row; scope is never returned. */
export async function sautiStreamPlaybackDescriptor(request, env, asset, { basePath, accessScope, expiresAt } = {}, now = Math.floor(Date.now() / 1000)) {
  if (!validAsset(asset) || !streamOrigin(env)) return null;
  const base = gatewayBase(basePath, asset);
  const hash = await accessHash(accessScope);
  const expiry = Math.min(now + TOKEN_TTL, expiresAt == null ? Infinity : Math.floor(new Date(expiresAt).getTime() / 1000));
  if (!base || !hash || !Number.isSafeInteger(expiry) || expiry <= now) return null;
  try {
    return { type: 'hls', url: new URL(await capabilityUrl(env, asset, base, 'manifest/video.m3u8', expiry, hash), new URL(request.url).origin).href,
      qualities: [], cache_key: asset.generation, expires_in: expiry - now, expires_at: new Date(expiry * 1000).toISOString() };
  } catch { return null; }
}

async function providerToken(env, uid, now) {
  const prior = providerTokens.get(uid);
  if (prior && prior.until > now + 10) return prior.token;
  const token = await streamOperation(() => env.STREAM.video(uid).generateToken());
  // Tokens remain solely inside the Worker, never in a rewritten manifest.
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 4096) throw new Error('STREAM_TOKEN_INVALID');
  providerTokens.set(uid, { token, until: now + TOKEN_TTL });
  if (providerTokens.size > PLAYBACK_TOKEN_LIMIT) providerTokens.delete(providerTokens.keys().next().value);
  return token;
}

function providerRelativePath(uri, manifestUrl, expectedOrigin, token, uid) {
  if (!uri || /[\\\u0000-\u0020]/.test(uri) || uri.includes('{$')) throw new Error('UNSAFE_HLS_URI');
  const resolved = new URL(uri, manifestUrl);
  if (resolved.origin !== expectedOrigin || resolved.username || resolved.password || resolved.hash) throw new Error('UNSAFE_HLS_ORIGIN');
  const prefix = `/${token}/`;
  const uidPrefix = `/${uid}/`;
  const root = resolved.pathname.startsWith(prefix) ? 'token'
    : resolved.pathname.startsWith(uidPrefix) ? 'uid' : null;
  const relative = root === 'token' ? resolved.pathname.slice(prefix.length)
    : root === 'uid' ? resolved.pathname.slice(uidPrefix.length) : null;
  const path = relative == null ? null : `${relative}${resolved.search}`;
  if (!safeRelativePath(path)) throw new Error('UNSAFE_HLS_PATH');
  return { path, root };
}

/** Rewrites lines and all URI attributes (keys, MAP, audio, subtitles, I-frames). */
export async function rewriteSautiStreamManifest(text, { manifestUrl, providerOrigin, providerToken: token, uid, rewrite }) {
  if (typeof text !== 'string' || !text.startsWith('#EXTM3U') || new TextEncoder().encode(text).length > MANIFEST_LIMIT) throw new Error('INVALID_HLS_MANIFEST');
  if (/^#EXT-X-(?:DEFINE|CONTENT-STEERING|SESSION-DATA):/m.test(text)) throw new Error('UNSUPPORTED_HLS_EXTERNAL_RESOURCE');
  const lines = [];
  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    if (!line.trim()) { lines.push(line); continue; }
    if (!line.startsWith('#')) {
      const resource = providerRelativePath(line, manifestUrl, providerOrigin, token, uid);
      lines.push(await rewrite(resource.path, resource.root));
      continue;
    }
    let cursor = 0;
    let replaced = '';
    // Reject unquoted or alternate URI spelling rather than accidentally leaking it.
    const matches = [...line.matchAll(/(?:^|[, :])URI="([^"]*)"/g)];
    if ([...line.matchAll(/(?:^|[, :])URI=/gi)].length !== matches.length) throw new Error('INVALID_HLS_URI_ATTRIBUTE');
    for (const match of matches) {
      const start = match.index + match[0].indexOf('URI="') + 5;
      replaced += line.slice(cursor, start);
      const resource = providerRelativePath(match[1], manifestUrl, providerOrigin, token, uid);
      replaced += await rewrite(resource.path, resource.root);
      cursor = start + match[1].length;
    }
    lines.push(replaced + line.slice(cursor));
  }
  return lines.join('\n');
}

async function boundedManifest(response) {
  if (Number(response.headers.get('Content-Length') || 0) > MANIFEST_LIMIT) throw new Error('HLS_MANIFEST_TOO_LARGE');
  if (!response.body) throw new Error('HLS_MANIFEST_EMPTY');
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MANIFEST_LIMIT) throw new Error('HLS_MANIFEST_TOO_LARGE');
      chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder('utf-8', { fatal: true }).decode(output);
  } finally { await reader.cancel().catch(() => {}); }
}

/** Caller MUST reauthorize its post/Room/story row on every invocation. */
export async function serveSautiStreamHls(request, env, asset, { basePath, accessScope, expiresAt, manifestOnly = false, initializationOnly = false } = {}, now = Math.floor(Date.now() / 1000)) {
  const unavailable = (status = 404) => new Response(null, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  const origin = streamOrigin(env);
  const base = validAsset(asset) && gatewayBase(basePath, asset);
  if (!origin || !base || request.signal.aborted || !['GET', 'HEAD'].includes(request.method)) return unavailable();
  const url = new URL(request.url);
  if (!url.pathname.startsWith(base) || [...url.searchParams.keys()].some((key) => key !== 'c') || url.searchParams.getAll('c').length !== 1) return unavailable();
  const opaquePath = url.pathname.slice(base.length);
  const cap = String(url.searchParams.get('c') || '').split('.');
  let claims;
  let path;
  try {
    if (cap.length !== 2 || !await verifyStreamHmac(env, cap[0], cap[1])) return unavailable();
    claims = await openCapability(env, asset, cap[0]);
    path = claims.p;
  } catch { return unavailable(); }
  const hash = await accessHash(accessScope);
  // The old full-path identity remains valid only with its original sealed,
  // unexpired capability, so already-issued five-minute grants survive rollout.
  const boundPath = safeRelativePath(path) && ['token', 'uid'].includes(claims.r)
    && (await pathIdentity(path, claims.r, asset.stream_uid) === opaquePath
      || await pathIdentity(path, claims.r, asset.stream_uid, true) === opaquePath);
  if (!boundPath || claims.v !== 2 || claims.k !== asset.kind || claims.id !== asset.id
    || claims.g !== asset.generation || claims.u !== asset.stream_uid || claims.p !== path || !hash || claims.a !== hash
    || !Number.isSafeInteger(claims.e) || claims.e <= now || claims.e > now + TOKEN_TTL
    || (expiresAt != null && new Date(expiresAt).getTime() <= now * 1000)) return unavailable(401);
  const range = request.headers.get('Range');
  if (range && !/^bytes=\d+-\d*$/.test(range)) return unavailable(416);
  try {
    const manifest = path.split('?')[0].endsWith('.m3u8');
    if (manifestOnly && !manifest) return unavailable();
    if (initializationOnly && !/\.(?:mp4|m4s)$/.test(path.split('?')[0])) return unavailable();
    const token = manifest || claims.r === 'token' ? await providerToken(env, asset.stream_uid, now) : null;
    // Cloudflare signs UID-rooted fragment URLs with their original path.
    // Preserve the validated root sealed in the grant; moving a signed fragment
    // beneath the playback token causes a redirect and invalidates delivery.
    const upstream = `${origin}/${claims.r === 'uid' ? asset.stream_uid : token}/${path}`;
    if (request.signal.aborted) return unavailable();
    // Workers supports manual/follow redirects. Keep every 3xx un-followed;
    // response.ok below rejects it before any provider bytes are returned.
    const response = await fetch(upstream, { method: manifest ? 'GET' : request.method, redirect: 'manual',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]), headers: range && !manifest ? { Range: range } : {} });
    if (!response.ok || (manifest && response.status !== 200)) { await response.body?.cancel(); return unavailable(response.status === 429 ? 429 : 502); }
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'" });
    if (manifest) {
      const rewritten = await rewriteSautiStreamManifest(await boundedManifest(response), {
        manifestUrl: upstream, providerOrigin: origin, providerToken: token, uid: asset.stream_uid,
        rewrite: (relative, root) => capabilityUrl(env, asset, base, relative, claims.e, hash, root),
      });
      headers.set('Content-Type', 'application/vnd.apple.mpegurl');
      return new Response(request.method === 'HEAD' ? null : rewritten, { status: 200, headers });
    }
    for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const value = response.headers.get(name); if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch { return unavailable(502); }
}

/** Root authorizes the current Story row and its 24-hour expiry first. */
export async function serveSautiStreamThumbnail(request, env, asset, { expiresAt } = {}, now = Math.floor(Date.now() / 1000)) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  const unavailable = (status = 404) => new Response(null, { status, headers });
  const origin = streamOrigin(env);
  if (!origin || !validAsset(asset) || !['GET', 'HEAD'].includes(request.method)
    || (expiresAt != null && (!Number.isFinite(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime() <= now * 1000))) return unavailable();
  try {
    const token = await providerToken(env, asset.stream_uid, now);
    const response = await fetch(`${origin}/${token}/thumbnails/thumbnail.jpg?time=0s&height=480`, {
      method: request.method, redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || !/^image\/jpeg(?:;|$)/i.test(response.headers.get('Content-Type') || '')
      || Number(response.headers.get('Content-Length') || 0) > 2 * 1024 * 1024) { await response.body?.cancel(); return unavailable(502); }
    headers.set('Content-Type', 'image/jpeg');
    if (request.method === 'HEAD') { await response.body?.cancel(); return new Response(null, { status: 200, headers }); }
    // Thumbnail bytes are bounded even when the provider omits Content-Length.
    const reader = response.body?.getReader();
    if (!reader) return unavailable(502);
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 2 * 1024 * 1024) throw new Error('THUMBNAIL_TOO_LARGE');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return unavailable(502);
    headers.set('Content-Length', String(bytes.length));
    return new Response(bytes, { status: 200, headers });
  } catch { return unavailable(502); }
}
