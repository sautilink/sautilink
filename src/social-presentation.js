export function formatEngagementCount(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (!n) return '';
  if (n < 1000) return String(n);
  const divisor = n >= 1_000_000 ? 1_000_000 : 1000;
  return `${(Math.floor(n / divisor * 10) / 10).toFixed(1).replace(/\.0$/, '')}${divisor === 1000 ? 'k' : 'm'}`;
}

export function setEngagementCount(node, value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  node.dataset.rawCount = String(count);
  node.textContent = formatEngagementCount(count);
  node.hidden = count === 0;
  node.setAttribute('aria-label', count.toLocaleString('en-GB'));
}

export function clampAudioClip(track, startMs, durationMs) {
  const grant = track.license;
  const first = Math.max(0, Number(grant.windowStartMs) || 0);
  const end = Math.min(Number(track.durationMs), Number(grant.windowEndMs));
  const maximum = Math.min(180000, Number(grant.maxClipMs), end - first);
  if (!Number.isFinite(maximum) || maximum < 1000) throw new Error('This audio has no available clip.');
  const duration = Math.min(maximum, Math.max(1000, Math.round(Number(durationMs) || 30000)));
  return { trackId: track.id, title: track.title, artist: track.artist,
    startMs: Math.round(Math.max(first, Math.min(end - duration, Number(startMs) || first))),
    durationMs: duration, musicVolume: 1, originalVolume: 1 };
}

export function isNewMusicRelease(releasedOn, now = Date.now()) {
  const age = now - Date.parse(releasedOn);
  return Number.isFinite(age) && age >= 0 && age < 7 * 86400000;
}

export function audioClipUrl(selection) {
  if (!/^[a-z0-9-]{1,80}$/.test(selection?.trackId || '') ||
      !Number.isSafeInteger(selection.startMs) || selection.startMs < 0 ||
      !Number.isSafeInteger(selection.durationMs) || selection.durationMs < 1000 || selection.durationMs > 180000) return '';
  return `/api/music/tracks/${selection.trackId}/preview?placement=feed&startMs=${selection.startMs}&durationMs=${selection.durationMs}`;
}

export function audioTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
