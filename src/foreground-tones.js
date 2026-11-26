// Browser notification sounds in the background remain controlled by the OS.
// A visible, signed-in window can play the same short brand tones as Android.
export function installForegroundTones(getMemberId) {
  let lastPlayed = 0, sound = null;
  const seen = new Set();
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.type !== 'sautilink:notification-received'
        || !getMemberId() || document.hidden || globalThis.Notification?.permission !== 'granted') return;
    const { id, category } = event.data;
    if (typeof id !== 'string' || seen.has(id)) return;
    seen.add(id); if (seen.size > 100) seen.delete(seen.values().next().value);
    if (Date.now() - lastPlayed < 1500) return;
    lastPlayed = Date.now(); sound?.pause();
    sound = new Audio(category === 'message' ? '/app/assets/sounds/sautilink_message.wav' : '/app/assets/sounds/sautilink_activity.wav');
    sound.volume = .65; void sound.play().catch(() => {});
  });
}
