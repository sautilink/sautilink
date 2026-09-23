const WEB_PUSH_PUBLIC_KEY = 'BDt6BePKFcUKr9rFR33MSDJh2uXMsO2k-Bje0-ryABGqC4k7pj0W7QBsk4njhMAu7Bb2nkWfLKI1_bN6UCOFrnU';
const WEB_PUSH_INSTALLATION_KEY = 'sautilink.push.web_installation_id.v1';
const WEB_PUSH_START_MAX_ATTEMPTS = 40;

let webPushStartAttempts = 0;
let webPushSyncInFlight = false;

function isNativePushApp() {
  const capacitor = globalThis.Capacitor;
  if (!capacitor) return false;
  return typeof capacitor.isNativePlatform === 'function'
    ? capacitor.isNativePlatform()
    : typeof capacitor.getPlatform === 'function' && capacitor.getPlatform() !== 'web';
}

function supportsWebPush() {
  return !isNativePushApp()
    && globalThis.isSecureContext
    && 'serviceWorker' in navigator
    && 'PushManager' in globalThis
    && 'Notification' in globalThis;
}

function webPushInstallationId() {
  try {
    const existing = localStorage.getItem(WEB_PUSH_INSTALLATION_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(WEB_PUSH_INSTALLATION_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function bytesToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function publicKeyBytes(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function webPushSession() {
  const bridge = globalThis.__sautilinkPushBridge;
  if (!bridge?.getSession) return null;
  const result = await bridge.getSession().catch(() => null);
  return result?.data?.session || null;
}

async function webPushRpc(name, args) {
  const bridge = globalThis.__sautilinkPushBridge;
  if (!bridge?.rpc) return { error: new Error('Push auth bridge is unavailable') };
  return bridge.rpc(name, args);
}

function webPushElements() {
  return {
    card: document.getElementById('settings-web-push-card'),
    button: document.getElementById('settings-web-push-action'),
    status: document.getElementById('settings-web-push-status'),
  };
}

function renderWebPushState(state, detail) {
  const { card, button, status } = webPushElements();
  if (!card || !button || !status) return;
  card.hidden = state === 'native';
  if (state === 'native') return;

  const labels = {
    unsupported: ['Not supported on this browser', 'Unavailable'],
    blocked: ['Blocked in browser settings', 'Blocked'],
    disabled: ['Off on this device', 'Enable'],
    enabled: ['On for this device', 'Disable'],
    working: [detail || 'Updating device notifications…', 'Please wait…'],
    error: [detail || 'Could not update notifications. Try again.', 'Try again'],
  };
  const [copy, action] = labels[state] || labels.disabled;
  status.textContent = copy;
  button.textContent = action;
  button.disabled = state === 'unsupported' || state === 'blocked' || state === 'working';
  button.dataset.pushState = state;
}

async function currentWebSubscription() {
  if (!supportsWebPush()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function persistWebSubscription(subscription) {
  const session = await webPushSession();
  if (!session?.user?.id || !subscription) return false;
  const p256dh = subscription.getKey('p256dh');
  const auth = subscription.getKey('auth');
  if (!p256dh || !auth) return false;
  const { error } = await webPushRpc('register_web_push_subscription_v1', {
    p_installation_id: webPushInstallationId(),
    p_endpoint: subscription.endpoint,
    p_p256dh: bytesToBase64Url(p256dh),
    p_auth: bytesToBase64Url(auth),
    p_expiration_time: subscription.expirationTime == null ? null : Math.round(subscription.expirationTime),
  });
  return !error;
}

async function unregisterWebSubscription({ unsubscribe = true } = {}) {
  await webPushRpc('unregister_web_push_subscription_v1', {
    p_installation_id: webPushInstallationId(),
  }).catch(() => null);
  if (!unsubscribe) return;
  const subscription = await currentWebSubscription().catch(() => null);
  if (subscription) await subscription.unsubscribe().catch(() => false);
}

async function refreshWebPushState({ sync = true } = {}) {
  if (isNativePushApp()) return renderWebPushState('native');
  if (!supportsWebPush()) return renderWebPushState('unsupported');
  if (Notification.permission === 'denied') return renderWebPushState('blocked');
  const subscription = await currentWebSubscription().catch(() => null);
  if (!subscription) return renderWebPushState('disabled');
  if (sync) await persistWebSubscription(subscription).catch(() => false);
  return renderWebPushState('enabled');
}

async function enableWebPush() {
  if (!supportsWebPush() || webPushSyncInFlight) return;
  webPushSyncInFlight = true;
  renderWebPushState('working');
  try {
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') {
      renderWebPushState(permission === 'denied' ? 'blocked' : 'disabled');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription()
      || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKeyBytes(WEB_PUSH_PUBLIC_KEY),
      });
    if (!await persistWebSubscription(subscription)) throw new Error('subscription_not_saved');
    renderWebPushState('enabled');
  } catch {
    renderWebPushState('error');
  } finally {
    webPushSyncInFlight = false;
  }
}

async function disableWebPush() {
  if (webPushSyncInFlight) return;
  webPushSyncInFlight = true;
  renderWebPushState('working');
  try {
    await unregisterWebSubscription();
    renderWebPushState('disabled');
  } catch {
    renderWebPushState('error');
  } finally {
    webPushSyncInFlight = false;
  }
}

function startWebPushBridge() {
  const bridge = globalThis.__sautilinkPushBridge;
  if (!bridge?.getSession || !bridge?.onAuthStateChange || !bridge?.rpc) {
    webPushStartAttempts += 1;
    if (webPushStartAttempts < WEB_PUSH_START_MAX_ATTEMPTS) window.setTimeout(startWebPushBridge, 100);
    return;
  }

  const { button } = webPushElements();
  button?.addEventListener('click', () => {
    if (button.dataset.pushState === 'enabled') void disableWebPush();
    else void enableWebPush();
  });

  void refreshWebPushState();
  bridge.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user?.id) return;
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      void refreshWebPushState();
    }
  });
  window.addEventListener('focus', () => void refreshWebPushState());
}

globalThis.__sautilinkPushCleanupHooks ||= new Set();
globalThis.__sautilinkPushCleanupHooks.add(() => unregisterWebSubscription({ unsubscribe: false }));

globalThis.__sautilinkSetAppBadge = (count) => {
  const normalized = Math.max(0, Number(count) || 0);
  if (normalized > 0 && typeof navigator.setAppBadge === 'function') {
    void navigator.setAppBadge(normalized).catch(() => {});
  } else if (typeof navigator.clearAppBadge === 'function') {
    void navigator.clearAppBadge().catch(() => {});
  }
};

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWebPushBridge, { once: true });
  } else {
    startWebPushBridge();
  }
}
