const STORAGE_KEY = 'sautilink:video-autoplay:v1';
export const VIDEO_AUTOPLAY_EVENT = 'sautilink:video-autoplay-preference';

let fallbackPreference = true;

export function getVideoAutoplayPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? fallbackPreference : stored !== 'off';
  } catch {
    return fallbackPreference;
  }
}

export function setVideoAutoplayPreference(enabled) {
  fallbackPreference = Boolean(enabled);
  try {
    localStorage.setItem(STORAGE_KEY, fallbackPreference ? 'on' : 'off');
  } catch {
    // Keep the choice for this session when browser storage is unavailable.
  }
  document.dispatchEvent(new CustomEvent(VIDEO_AUTOPLAY_EVENT, {
    detail: { enabled: fallbackPreference },
  }));
  return fallbackPreference;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    fallbackPreference = event.newValue !== 'off';
    document.dispatchEvent(new CustomEvent(VIDEO_AUTOPLAY_EVENT, {
      detail: { enabled: fallbackPreference },
    }));
  });
}
