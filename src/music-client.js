import { audioClipUrl, clampAudioClip } from './social-presentation.js';
export const MUSIC_ORIGIN = '/api/music';
const catalogCache = new Map();
const trackCache = new Map();

export function createMusicClient({ supabase, getMemberId }) {
  async function publicRead(path, signal) {
    const response = await fetch(MUSIC_ORIGIN + path.replace(/^\/v1/, ''), { mode: 'cors', credentials: 'omit', signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Music could not load. Please try again.');
    return response.json();
  }
  async function savedIds() {
    const id = getMemberId(); if (!id) return new Set();
    const { data, error } = await supabase.from('social_saved_audio').select('track_id').eq('owner_id', id).limit(1000);
    if (error) throw new Error('Saved audio could not load. Please try again.');
    return new Set(data.map(row => row.track_id));
  }
  return {
    async catalog(query = '', signal) {
      const key = query.trim().slice(0, 160), cached = catalogCache.get(key);
      let value;
      if (cached && Date.now() - cached.at < 60000) value = cached.value;
      else {
        value = await publicRead(`/v1/tracks?placement=feed&compact=1&limit=50&q=${encodeURIComponent(key)}`, signal);
        catalogCache.set(key, { value, at: Date.now() });
        if (catalogCache.size > 50) catalogCache.delete(catalogCache.keys().next().value);
      }
      return value;
    },
    async page(query, offset, signal) {
      return publicRead(`/v1/tracks?placement=feed&compact=1&limit=50&offset=${offset}&q=${encodeURIComponent(query.slice(0, 160))}`, signal);
    },
    async details(id, signal) {
      if (!/^[a-z0-9-]{1,80}$/.test(id)) throw new Error('Invalid audio.');
      if (trackCache.has(id)) return trackCache.get(id);
      const { track } = await publicRead(`/v1/tracks/${id}?placement=feed`, signal);
      trackCache.set(id, track); if (trackCache.size > 100) trackCache.delete(trackCache.keys().next().value);
      return track;
    },
    savedIds,
    async usage(ids) {
      const result = new Map();
      for (let i = 0; i < ids.length; i += 50) {
        const { data, error } = await supabase.rpc('social_audio_usage', { track_ids: ids.slice(i, i + 50) });
        if (error) throw new Error('Audio usage could not load.');
        for (const row of data || []) result.set(row.track_id, Number(row.uses) || 0);
      }
      return result;
    },
    async save(id, enabled) {
      const owner = getMemberId(); if (!owner) throw new Error('Sign in to save audio.');
      if (!/^[a-z0-9-]{1,80}$/.test(id)) throw new Error('Invalid audio.');
      const query = enabled ? supabase.from('social_saved_audio').insert({ owner_id: owner, track_id: id })
        : supabase.from('social_saved_audio').delete().eq('owner_id', owner).eq('track_id', id);
      const { error } = await query;
      if (error && !(enabled && error.code === '23505')) throw new Error('Your music library could not be updated. Try again.');
      if (getMemberId() !== owner) throw new Error('Account changed.');
    },
  };
}

export { audioClipUrl, clampAudioClip };
