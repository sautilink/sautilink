import { serveSautiStreamHls } from './sauti-stream-playback.js';

const BODY_LIMIT = 256 * 1024;
const CHILD_LIMIT = 8;
const INIT_LIMIT = 16 * 1024;
const BOOTSTRAP_BUDGET_MS = 1500;
const encoder = new TextEncoder();

function resourceUrl(value, origin, base, kind = 'm') {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.hash
      || !url.pathname.startsWith(base)
      || !new RegExp(`^${kind}_[A-Za-z0-9_-]{43}$`).test(url.pathname.slice(base.length))
      || [...url.searchParams.keys()].some(key => key !== 'c')
      || url.searchParams.getAll('c').length !== 1
      || !/^[A-Za-z0-9_-]{40,4096}\.[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('c'))) return null;
    return url.href;
  } catch { return null; }
}

function childPlaylists(body, origin, base) {
  const urls = new Set();
  for (const line of body.split('\n')) {
    const candidates = line.startsWith('#') ? [...line.matchAll(/URI="([^"]*)"/g)].map(match => match[1])
      : line.trim() ? [line.trim()] : [];
    for (const candidate of candidates) {
      const url = resourceUrl(candidate, origin, base);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

async function boundedBytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('BOOTSTRAP_EMPTY');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('BOOTSTRAP_LIMIT');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Only MP4 decoder configuration, never sample data. Reject extended/zero box
// sizes, trailing bytes, duplicate boxes and every box other than ftyp/moov.
export function sautiStreamInitializationHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32 || bytes.length > INIT_LIMIT) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  for (const expected of ['ftyp', 'moov']) {
    if (offset + 16 > bytes.length) return false;
    const size = view.getUint32(offset, false);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (size < 16 || offset + size > bytes.length || type !== expected) return false;
    offset += size;
  }
  return offset === bytes.length;
}

function initializationUrls(playlists, origin, base) {
  const urls = new Set();
  for (const { body } of playlists) for (const line of body.split('\n')) {
    if (!line.startsWith('#EXT-X-MAP:')) continue;
    const uri = /(?:^|[:,])URI="([^"]+)"/.exec(line)?.[1];
    const url = uri && resourceUrl(uri, origin, base, 's');
    if (url) urls.add(url);
  }
  return [...urls];
}

/** The caller has just authorized this asset and checked its current source.
 * Return a bounded, rewritten metadata snapshot in that same response.
 * Optional MAP headers contain only decoder configuration (ftyp/moov).
 * Media segments still go through the normal live authorization gateway.
 * No provider token/URL, permission result or playlist is cached here.
 */
export async function sautiStreamBootstrap(request, env, asset, descriptor, options) {
  if (request.signal.aborted || request.headers.get('X-Sauti-Playback-Bootstrap') !== '1' || descriptor?.type !== 'hls') return null;
  const origin = new URL(request.url).origin;
  const base = asset?.kind === 'post' ? `/api/sauti-media/${asset.id}/hls/`
    : asset?.kind === 'story' ? `/api/stories/${asset.id}/hls/` : null;
  const root = base && options?.basePath === base && resourceUrl(descriptor.url, origin, base);
  if (!root) return null;
  const controller = new AbortController();
  async function read(url) {
    if (controller.signal.aborted || request.signal.aborted) throw new Error('BOOTSTRAP_ABORTED');
    const response = await serveSautiStreamHls(new Request(url, {
      signal: AbortSignal.any([controller.signal, request.signal]),
    }), env, asset, { ...options, manifestOnly: true });
    if (response.status !== 200 || response.headers.get('Content-Type') !== 'application/vnd.apple.mpegurl') {
      await response.body?.cancel();
      throw new Error('BOOTSTRAP_UNAVAILABLE');
    }
    const bytes = await boundedBytes(response, BODY_LIMIT);
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!body.startsWith('#EXTM3U')) throw new Error('BOOTSTRAP_INVALID');
    return { url, body };
  }
  let timer;
  let snapshot = null;
  const collect = async () => {
    const master = await read(root);
    if (controller.signal.aborted || request.signal.aborted) return null;
    const children = childPlaylists(master.body, origin, base).filter(url => url !== root);
    if (children.length > CHILD_LIMIT) return null;
    const playlists = [master, ...await Promise.all(children.map(read))];
    const metadataSize = playlists.reduce((size, item) => size + encoder.encode(item.body).length, 0);
    if (metadataSize > BODY_LIMIT) return null;
    snapshot = { playlists };
    const initialUrls = initializationUrls(playlists, origin, base);
    if (!initialUrls.length || initialUrls.length > CHILD_LIMIT) return snapshot;
    try {
      const initializations = await Promise.all(initialUrls.map(async url => {
        if (controller.signal.aborted || request.signal.aborted) throw new Error('BOOTSTRAP_ABORTED');
        const response = await serveSautiStreamHls(new Request(url, {
          signal: AbortSignal.any([controller.signal, request.signal]),
        }), env, asset, { ...options, initializationOnly: true });
        if (response.status !== 200) { await response.body?.cancel(); throw new Error('BOOTSTRAP_INIT_UNAVAILABLE'); }
        const bytes = await boundedBytes(response, INIT_LIMIT);
        if (!sautiStreamInitializationHeader(bytes)) throw new Error('BOOTSTRAP_INIT_INVALID');
        return { url, base64: btoa(String.fromCharCode(...bytes)), size: bytes.length };
      }));
      if (metadataSize + initializations.reduce((size, item) => size + item.size, 0) <= BODY_LIMIT)
        snapshot = { playlists, initializations: initializations.map(({ url, base64 }) => ({ url, base64 })) };
    } catch { /* A failed optional header leaves the valid playlist snapshot. */ }
    return snapshot;
  };
  try {
    return await Promise.race([collect(), new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(snapshot); }, BOOTSTRAP_BUDGET_MS);
    })]);
  } catch { return null; }
  finally { clearTimeout(timer); controller.abort(); }
}
