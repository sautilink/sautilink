const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';

const SLOT_LIMITS = {
  avatar: 5 * 1024 * 1024,
  header: 8 * 1024 * 1024,
};

const CONTENT_TYPES = {
  'image/jpeg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
};

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{2,29}$/;
const MAX_DIMENSION = 12000;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function apiError(status, code, message) {
  return json(status, { ok: false, error: { code, message } });
}

function authorization(request) {
  const value = request.headers.get('Authorization') || '';
  return /^Bearer\s+[^\s]+$/i.test(value) ? value : '';
}

function supabaseHeaders(auth = '') {
  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Accept: 'application/json',
  };
  if (auth) headers.Authorization = auth;
  return headers;
}

async function authenticate(request) {
  const auth = authorization(request);
  if (!auth) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: supabaseHeaders(auth),
  });
  if (!response.ok) return null;

  const user = await response.json().catch(() => null);
  return user?.id ? { auth, user } : null;
}

async function selectProfileByUsername(username, auth = '') {
  const params = new URLSearchParams({
    select: 'id,username,avatar_key,header_key,is_discoverable',
    username: `eq.${username}`,
    limit: '1',
  });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_profiles?${params}`, {
    headers: supabaseHeaders(auth),
  });
  if (!response.ok) return { error: true, profile: null };
  const rows = await response.json().catch(() => []);
  return { error: false, profile: Array.isArray(rows) ? rows[0] || null : null };
}

async function selectOwnProfile(userId, auth) {
  const params = new URLSearchParams({
    select: 'id,username,avatar_key,header_key,is_discoverable',
    id: `eq.${userId}`,
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_profiles?${params}`, {
    headers: supabaseHeaders(auth),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function setOwnMediaKey(userId, auth, slot, objectKey) {
  const column = slot === 'avatar' ? 'avatar_key' : 'header_key';
  const params = new URLSearchParams({ id: `eq.${userId}` });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/social_profiles?${params}`, {
    method: 'PATCH',
    headers: {
      ...supabaseHeaders(auth),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ [column]: objectKey }),
  });

  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function uint16be(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint24le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function pngDimensions(bytes) {
  if (bytes.length < 24) return null;
  if (
    bytes[0] !== 0x89 || ascii(bytes, 1, 3) !== 'PNG' ||
    bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
  ) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    contentType: 'image/png',
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}

function jpegDimensions(bytes) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.length) break;

    const length = uint16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) break;

    if (sof.has(marker) && length >= 7) {
      return {
        contentType: 'image/jpeg',
        height: uint16be(bytes, offset + 3),
        width: uint16be(bytes, offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(bytes, 12, 4);

  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      contentType: 'image/webp',
      width: 1 + uint24le(bytes, 24),
      height: 1 + uint24le(bytes, 27),
    };
  }

  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return {
      contentType: 'image/webp',
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + (((b2 & 0xc0) >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }

  if (
    chunk === 'VP8 ' && bytes.length >= 30 &&
    bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a
  ) {
    return {
      contentType: 'image/webp',
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }

  return null;
}

export function inspectImageBytes(bytes) {
  const result = pngDimensions(bytes) || jpegDimensions(bytes) || webpDimensions(bytes);
  if (!result) return null;
  if (
    !Number.isInteger(result.width) || !Number.isInteger(result.height) ||
    result.width < 1 || result.height < 1 ||
    result.width > MAX_DIMENSION || result.height > MAX_DIMENSION
  ) return null;
  return result;
}

function profileMediaPath(pathname) {
  const match = pathname.match(/^\/api\/profile-media\/([a-z0-9][a-z0-9._]{2,29})\/(avatar|header)$/);
  return match ? { username: match[1], slot: match[2] } : null;
}

async function serveProfileMedia(request, env, username, slot) {
  if (!env.PROFILE_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Profile media is not enabled yet.');

  const auth = authorization(request);
  const { error, profile } = await selectProfileByUsername(username, auth);
  if (error) return apiError(502, 'PROFILE_LOOKUP_FAILED', 'Profile media could not be loaded.');
  if (!profile) return apiError(404, 'MEDIA_NOT_FOUND', 'Profile media was not found.');

  const key = slot === 'avatar' ? profile.avatar_key : profile.header_key;
  if (!key) return apiError(404, 'MEDIA_NOT_FOUND', 'Profile media was not found.');

  const object = await env.PROFILE_MEDIA.get(key);
  if (!object) return apiError(404, 'MEDIA_NOT_FOUND', 'Profile media was not found.');

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Content-Security-Policy', "default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');
  if (!headers.get('Content-Type')) headers.set('Content-Type', 'application/octet-stream');

  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}

async function uploadProfileMedia(request, env) {
  if (!env.PROFILE_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Profile media is not enabled yet.');

  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in again before changing profile media.');

  const contentLength = Number(request.headers.get('Content-Length') || '0');
  if (contentLength > 9 * 1024 * 1024) {
    return apiError(413, 'FILE_TOO_LARGE', 'The selected image is too large.');
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, 'INVALID_FORM', 'The upload request is invalid.');
  }

  const slot = String(form.get('slot') || '');
  const file = form.get('file');
  if (!Object.hasOwn(SLOT_LIMITS, slot)) return apiError(400, 'INVALID_SLOT', 'Choose a valid profile media slot.');
  if (!(file instanceof File)) return apiError(400, 'FILE_REQUIRED', 'Choose an image to upload.');
  if (!CONTENT_TYPES[file.type]) return apiError(415, 'UNSUPPORTED_IMAGE', 'Use a JPEG, PNG or WebP image.');
  if (file.size < 1 || file.size > SLOT_LIMITS[slot]) {
    return apiError(413, 'FILE_TOO_LARGE', slot === 'avatar' ? 'Avatar images must be 5 MB or smaller.' : 'Header images must be 8 MB or smaller.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectImageBytes(bytes);
  if (!inspected || inspected.contentType !== file.type) {
    return apiError(415, 'INVALID_IMAGE_BYTES', 'The file contents do not match a supported image format.');
  }

  const profile = await selectOwnProfile(session.user.id, session.auth);
  if (!profile) return apiError(409, 'PROFILE_UNAVAILABLE', 'Your social profile is unavailable.');

  const extension = CONTENT_TYPES[inspected.contentType].extension;
  const objectKey = `profiles/${session.user.id}/${slot}/${crypto.randomUUID()}.${extension}`;
  const oldKey = slot === 'avatar' ? profile.avatar_key : profile.header_key;

  try {
    await env.PROFILE_MEDIA.put(objectKey, bytes, {
      httpMetadata: { contentType: inspected.contentType },
      customMetadata: {
        ownerId: session.user.id,
        slot,
        width: String(inspected.width),
        height: String(inspected.height),
      },
    });

    const updated = await setOwnMediaKey(session.user.id, session.auth, slot, objectKey);
    if (!updated) {
      await env.PROFILE_MEDIA.delete(objectKey);
      return apiError(409, 'MEDIA_FINALIZE_FAILED', 'The image was uploaded but could not be attached to your profile.');
    }

    if (oldKey && oldKey !== objectKey) {
      await env.PROFILE_MEDIA.delete(oldKey).catch(() => {});
    }

    return json(200, {
      ok: true,
      data: {
        slot,
        width: inspected.width,
        height: inspected.height,
        contentType: inspected.contentType,
      },
    });
  } catch {
    await env.PROFILE_MEDIA.delete(objectKey).catch(() => {});
    return apiError(502, 'MEDIA_UPLOAD_FAILED', 'The image could not be stored. Try again.');
  }
}

async function removeProfileMedia(request, env) {
  if (!env.PROFILE_MEDIA) return apiError(503, 'MEDIA_NOT_READY', 'Profile media is not enabled yet.');

  const session = await authenticate(request);
  if (!session) return apiError(401, 'AUTH_REQUIRED', 'Sign in again before changing profile media.');

  const payload = await request.json().catch(() => null);
  const slot = String(payload?.slot || '');
  if (!Object.hasOwn(SLOT_LIMITS, slot)) return apiError(400, 'INVALID_SLOT', 'Choose a valid profile media slot.');

  const profile = await selectOwnProfile(session.user.id, session.auth);
  if (!profile) return apiError(409, 'PROFILE_UNAVAILABLE', 'Your social profile is unavailable.');

  const oldKey = slot === 'avatar' ? profile.avatar_key : profile.header_key;
  if (!oldKey) return json(200, { ok: true, data: { slot, removed: false } });

  const updated = await setOwnMediaKey(session.user.id, session.auth, slot, null);
  if (!updated) return apiError(409, 'MEDIA_REMOVE_FAILED', 'The image could not be removed from your profile.');

  let cleanupPending = false;
  try {
    await env.PROFILE_MEDIA.delete(oldKey);
  } catch {
    cleanupPending = true;
  }

  return json(200, { ok: true, data: { slot, removed: true, cleanupPending } });
}

export async function handleProfileMediaRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/profile-media/status' && request.method === 'GET') {
    return json(200, { ok: true, data: { ready: Boolean(env.PROFILE_MEDIA) } });
  }

  const publicRoute = profileMediaPath(url.pathname);
  if (publicRoute && (request.method === 'GET' || request.method === 'HEAD')) {
    return serveProfileMedia(request, env, publicRoute.username, publicRoute.slot);
  }

  if (url.pathname === '/api/profile-media/upload' && request.method === 'POST') {
    return uploadProfileMedia(request, env);
  }

  if (url.pathname === '/api/profile-media/remove' && request.method === 'POST') {
    return removeProfileMedia(request, env);
  }

  return null;
}
