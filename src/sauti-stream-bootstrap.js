import { serveSautiStreamHls } from './sauti-stream-playback.js';

const BODY_LIMIT = 256 * 1024;
const CHILD_LIMIT = 8;
const BOOTSTRAP_BUDGET_MS = 1500;
const encoder = new TextEncoder();

function playlistUrl(value, origin, base) {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.hash
      || !url.pathname.startsWith(base)
      || !/^m_[A-Za-z0-9_-]{43}$/.test(url.pathname.slice(base.length))
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
      const url = playlistUrl(candidate, origin, base);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

/** The caller has just authorized this asset and checked its current source.
 * Return only a bounded, rewritten metadata snapshot in that same response.
 * Media segments still go through the normal live authorization gateway.
 * No provider token/URL, permission result or playlist is cached here.
 */
export async function sautiStreamBootstrap(request, env, asset, descriptor, options) {
  if (request.signal.aborted || request.headers.get('X-Sauti-Playback-Bootstrap') !== '1' || descriptor?.type !== 'hls') return null;
  const origin = new URL(request.url).origin;
  const base = asset?.kind === 'post' ? `/api/sauti-media/${asset.id}/hls/`
    : asset?.kind === 'story' ? `/api/stories/${asset.id}/hls/` : null;
  const root = base && options?.basePath === base && playlistUrl(descriptor.url, origin, base);
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
    const reader = response.body?.getReader();
    if (!reader) throw new Error('BOOTSTRAP_EMPTY');
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > BODY_LIMIT) throw new Error('BOOTSTRAP_LIMIT');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!body.startsWith('#EXTM3U')) throw new Error('BOOTSTRAP_INVALID');
    return { url, body };
  }
  let timer;
  const collect = async () => {
    const master = await read(root);
    if (controller.signal.aborted || request.signal.aborted) return null;
    const children = childPlaylists(master.body, origin, base).filter(url => url !== root);
    if (children.length > CHILD_LIMIT) return null;
    const playlists = [master, ...await Promise.all(children.map(read))];
    if (playlists.reduce((size, item) => size + encoder.encode(item.body).length, 0) > BODY_LIMIT) return null;
    return { playlists };
  };
  try {
    return await Promise.race([collect(), new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, BOOTSTRAP_BUDGET_MS);
    })]);
  } catch { return null; }
  finally { clearTimeout(timer); controller.abort(); }
}
