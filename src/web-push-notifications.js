const WEB_PUSH_PUBLIC_KEY = 'BDt6BePKFcUKr9rFR33MSDJh2uXMsO2k-Bje0-ryABGqC4k7pj0W7QBsk4njhMAu7Bb2nkWfLKI1_bN6UCOFrnU';
const WEB_PUSH_INSTALLATION_KEY = 'sautilink.push.web_installation_id.v1';
const WEB_PUSH_PROMPT_DISMISSED_KEY = 'sautilink.push.web_prompt_dismissed_at.v1';
const WEB_PUSH_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const WEB_PUSH_PROMPT_DELAY_MS = 900;
const WEB_PUSH_START_MAX_ATTEMPTS = 40;

let webPushStartAttempts = 0;
let webPushSyncInFlight = false;
let webPushPromptTimer = 0;

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

function isInstalledWebApp() {
  return globalThis.matchMedia?.('(display-mode: standalone)').matches
    || globalThis.navigator?.standalone === true;
}

function webPushPromptDismissedRecently() {
  try {
    const dismissedAt = Number(localStorage.getItem(WEB_PUSH_PROMPT_DISMISSED_KEY));
    return Number.isFinite(dismissedAt)
      && dismissedAt > 0
      && Date.now() - dismissedAt < WEB_PUSH_PROMPT_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function removeWebPushPrompt({ remember = false } = {}) {
  document.getElementById('sautilink-web-push-prompt')?.remove();
  if (!remember) return;
  try {
    localStorage.setItem(WEB_PUSH_PROMPT_DISMISSED_KEY, String(Date.now()));
  } catch {
    // The prompt can still close when storage is unavailable.
  }
}

function clearWebPushPromptDismissal() {
  try {
    localStorage.removeItem(WEB_PUSH_PROMPT_DISMISSED_KEY);
  } catch {
    // Storage cleanup is best effort.
  }
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
  if (!subscription) {
    if (sync && Notification.permission === 'granted') return enableWebPush({ allowPermissionPrompt: false });
    return renderWebPushState('disabled');
  }
  if (sync) await persistWebSubscription(subscription).catch(() => false);
  return renderWebPushState('enabled');
}

async function enableWebPush({ allowPermissionPrompt = true } = {}) {
  if (!supportsWebPush() || webPushSyncInFlight) return false;
  webPushSyncInFlight = true;
  renderWebPushState('working');
  try {
    if (Notification.permission !== 'granted' && !allowPermissionPrompt) {
      renderWebPushState('disabled');
      return false;
    }
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') {
      renderWebPushState(permission === 'denied' ? 'blocked' : 'disabled');
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription()
      || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKeyBytes(WEB_PUSH_PUBLIC_KEY),
      });
    if (!await persistWebSubscription(subscription)) throw new Error('subscription_not_saved');
    clearWebPushPromptDismissal();
    renderWebPushState('enabled');
    return true;
  } catch {
    renderWebPushState('error');
    return false;
  } finally {
    webPushSyncInFlight = false;
  }
}

function createWebPushPrompt() {
  const prompt = document.createElement('section');
  prompt.id = 'sautilink-web-push-prompt';
  prompt.className = 'sautilink-web-push-prompt';
  prompt.setAttribute('role', 'dialog');
  prompt.setAttribute('aria-modal', 'false');
  prompt.setAttribute('aria-labelledby', 'sautilink-web-push-prompt-title');
  prompt.innerHTML = `
    <div class="sautilink-web-push-prompt-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>
    </div>
    <div class="sautilink-web-push-prompt-copy">
      <strong id="sautilink-web-push-prompt-title">Turn on notifications?</strong>
      <p>Get messages, calls and important SautiLink updates even when the app is closed.</p>
    </div>
    <div class="sautilink-web-push-prompt-actions">
      <button type="button" data-web-push-prompt-later>Not now</button>
      <button type="button" data-web-push-prompt-enable>Turn on notifications</button>
    </div>`;

  prompt.querySelector('[data-web-push-prompt-later]')?.addEventListener('click', () => {
    removeWebPushPrompt({ remember: true });
  });
  prompt.querySelector('[data-web-push-prompt-enable]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Turning on…';
    const enabled = await enableWebPush();
    if (enabled) {
      removeWebPushPrompt();
      return;
    }
    if (Notification.permission === 'denied') {
      removeWebPushPrompt();
      return;
    }
    removeWebPushPrompt({ remember: true });
  });
  return prompt;
}

async function maybeOfferWebPush() {
  if (!isInstalledWebApp() || !supportsWebPush() || Notification.permission === 'denied') {
    removeWebPushPrompt();
    return;
  }
  const session = await webPushSession();
  if (!session?.user?.id) {
    removeWebPushPrompt();
    return;
  }
  const subscription = await currentWebSubscription().catch(() => null);
  if (subscription) {
    await persistWebSubscription(subscription).catch(() => false);
    removeWebPushPrompt();
    return;
  }
  if (Notification.permission === 'granted') {
    await enableWebPush({ allowPermissionPrompt: false });
    removeWebPushPrompt();
    return;
  }
  if (Notification.permission !== 'default' || webPushPromptDismissedRecently()) return;
  if (!document.getElementById('sautilink-web-push-prompt')) {
    document.body.append(createWebPushPrompt());
  }
}

function scheduleWebPushOffer() {
  window.clearTimeout(webPushPromptTimer);
  webPushPromptTimer = window.setTimeout(() => void maybeOfferWebPush(), WEB_PUSH_PROMPT_DELAY_MS);
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
  scheduleWebPushOffer();
  bridge.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user?.id) {
      removeWebPushPrompt();
      return;
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      void refreshWebPushState();
      scheduleWebPushOffer();
    }
  });
  window.addEventListener('focus', () => {
    void refreshWebPushState();
    scheduleWebPushOffer();
  });
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
