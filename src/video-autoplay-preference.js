const STORAGE_KEY = 'sautilink:video-autoplay:v1';
const DEFAULT_ROLLOUT_KEY = 'sautilink:video-autoplay-default:v2';
export const VIDEO_AUTOPLAY_EVENT = 'sautilink:video-autoplay-preference';

let fallbackPreference = true;

function applyDefaultOnRollout() {
  try {
    if (localStorage.getItem(DEFAULT_ROLLOUT_KEY) === 'applied') return;
    localStorage.setItem(STORAGE_KEY, 'on');
    localStorage.setItem(DEFAULT_ROLLOUT_KEY, 'applied');
    fallbackPreference = true;
  } catch {
    fallbackPreference = true;
  }
}

export function getVideoAutoplayPreference() {
  applyDefaultOnRollout();
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
    localStorage.setItem(DEFAULT_ROLLOUT_KEY, 'applied');
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
