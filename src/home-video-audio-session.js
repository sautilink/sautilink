const STORAGE_KEY = 'sautilink.home-video-audio.session.v1';

function storedPreference() {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (typeof value?.muted !== 'boolean') return null;
    const volume = Number(value.volume);
    return { muted: value.muted, volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1 };
  } catch {
    return null;
  }
}

let preference = storedPreference() || { muted: true, volume: 1 };
let revision = 0;

export function homeVideoAudioPreference() {
  return { ...preference };
}

export function rememberHomeVideoAudio(muted, volume = 1, video = null) {
  const level = Number(volume);
  preference = {
    muted: Boolean(muted) || level === 0,
    volume: Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 1,
  };
  revision += 1;
  if (video) video.dataset.sautiAudioRevision = String(revision);
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(preference)); } catch { /* Session storage is optional. */ }
}

export function applyHomeVideoAudio(video) {
  if (!video) return;
  if (video.dataset.sautiAudioRevision === String(revision)) return;
  video.volume = preference.volume;
  video.muted = preference.muted;
  video.defaultMuted = preference.muted;
  video.dataset.sautiAudioPreference = preference.muted ? 'muted' : 'unmuted';
  video.dataset.sautiAudioRevision = String(revision);
}

export function resetHomeVideoAudio() {
  preference = { muted: true, volume: 1 };
  revision += 1;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Session storage is optional. */ }
}
