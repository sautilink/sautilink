const uidPattern = /^[a-f0-9]{32}$/;
const binaryPath = /\.(?:ts|m4s|mp4|aac)$/;
const plainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const unixTime = (value) => typeof value === 'string' && /^[0-9]{1,13}$/.test(value)
  && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function canonicalJson(value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 256 || depth > 8) throw new Error('UNSAFE_CONTENT_IDENTITY');
  if (Array.isArray(value)) return value.map((child) => canonicalJson(child, budget, depth + 1));
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonicalJson(value[key], budget, depth + 1)]));
  return value;
}

/** Content identity only, never an authorization decision. The complete original
 * provider path remains sealed in the gateway capability and is forwarded intact.
 * Actual Stream fragment metadata repeats the signed token's exp/nbf in p: these
 * times and s rotate while the track/rendition/path bytes remain unchanged.
 */
export function sautiStreamContentIdentityPath(path, root, uid) {
  if (typeof path !== 'string' || path.length > 2048 || root !== 'uid' || !uidPattern.test(String(uid || ''))) return path;
  const queryAt = path.indexOf('?');
  if (queryAt < 0 || !binaryPath.test(path.slice(0, queryAt))) return path;
  try {
    const query = path.slice(queryAt + 1);
    const pairs = query.split('&');
    // Only the provider's literal signing envelope is recognized. Preserve every
    // unknown parameter byte-for-byte, including duplicate values and their order.
    if (pairs.filter((pair) => pair.split('=')[0] === 'p').length !== 1
      || pairs.filter((pair) => pair.split('=')[0] === 's').length !== 1) return path;
    const parameters = new URLSearchParams(query);
    if (parameters.getAll('p').length !== 1 || parameters.getAll('s').length !== 1) return path;
    const payload = parameters.get('p'); const signature = parameters.get('s');
    if (!/^[A-Za-z0-9_-]{1,4096}={0,2}$/.test(payload || '') || !/^[A-Za-z0-9_-]{16,1024}={0,2}$/.test(signature || '')) return path;
    const unpadded = payload.replace(/=+$/, '');
    const bytes = Uint8Array.from(atob(unpadded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - unpadded.length % 4) % 4)), (char) => char.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const metadata = JSON.parse(text);
    // Reject duplicate keys, noncanonical numeric/string encodings and whitespace
    // rather than silently changing the meaning of an unfamiliar provider payload.
    if (JSON.stringify(metadata) !== text || !plainObject(metadata) || metadata.videoID !== uid
      || !plainObject(metadata.token) || metadata.token.sub !== uid
      || typeof metadata.token.kid !== 'string' || !metadata.token.kid || metadata.token.kid.length > 256
      || !unixTime(metadata.token.exp) || !unixTime(metadata.token.nbf)
      || Number(metadata.token.exp) <= Number(metadata.token.nbf)) return path;
    const token = { ...metadata.token };
    delete token.exp; delete token.nbf;
    const stable = canonicalJson({ ...metadata, token });
    const remaining = pairs.filter((pair) => !['p', 's'].includes(pair.split('=')[0])).join('&');
    return `sauti-stream-content-v1\n${path.slice(0, queryAt)}\n${JSON.stringify(stable)}\n${remaining}`;
  } catch { return path; }
}
