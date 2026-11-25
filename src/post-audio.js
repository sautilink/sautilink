const MUSIC_ORIGIN = 'https://music.sautilink.com';

export class PostAudioError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Canonical metadata and clip boundaries always come from the approved Music catalog. */
export async function validatePostAudio(input, country, fetcher = fetch) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input) ||
      !/^[a-z0-9-]{1,80}$/.test(input.trackId || '') ||
      !Number.isSafeInteger(input.startMs) || !Number.isSafeInteger(input.durationMs)) {
    throw new PostAudioError(400, 'Choose a valid audio track and clip.');
  }
  const response = await fetcher(`${MUSIC_ORIGIN}/v1/tracks/${input.trackId}?placement=feed`, {
    headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new PostAudioError(response.status === 404 ? 409 : 503,
    'This audio is currently unavailable. Choose another track.');
  const { track } = await response.json();
  const grant = track?.license;
  const today = new Date().toISOString().slice(0, 10);
  if (!track || track.id !== input.trackId || !grant || !grant.placements?.includes('feed') ||
      !grant.territories?.some(code => code === '*' || code === country) ||
      grant.startsOn > today || (grant.endsOn && grant.endsOn < today)) {
    throw new PostAudioError(409, 'This audio is unavailable for this post or region.');
  }
  if (input.startMs < grant.windowStartMs || input.durationMs < 1000 || input.durationMs > 180000 ||
      input.durationMs > grant.maxClipMs || input.startMs + input.durationMs > grant.windowEndMs) {
    throw new PostAudioError(400, 'Choose a clip within the permitted audio range.');
  }
  return { trackId: track.id, title: track.title, artist: track.artist,
    startMs: input.startMs, durationMs: input.durationMs };
}
