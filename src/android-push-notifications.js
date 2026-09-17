const PUSH_INSTALLATION_KEY = 'sautilink.push.installation_id.v1';
const PUSH_TOKEN_KEY = 'sautilink.push.fcm_token.v1';
const PUSH_CHANNEL_ID = 'sautilink_updates';
const PUSH_START_MAX_ATTEMPTS = 40;

let pushPlugin = null;
let pushListenersReady = false;
let pushRegistrationInFlight = false;
let pushStartAttempts = 0;

function isNativeAndroid() {
  const capacitor = globalThis.Capacitor;
  if (!capacitor) return false;
  const platform = typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : '';
  const native = typeof capacitor.isNativePlatform === 'function'
    ? capacitor.isNativePlatform()
    : platform === 'android';
  return native && platform === 'android';
}

function getPushPlugin() {
  if (pushPlugin) return pushPlugin;
  if (!isNativeAndroid()) return null;

  const capacitor = globalThis.Capacitor;
  if (typeof capacitor?.registerPlugin === 'function') {
    pushPlugin = capacitor.registerPlugin('PushNotifications');
    return pushPlugin;
  }

  pushPlugin = capacitor?.Plugins?.PushNotifications || null;
  return pushPlugin;
}

function installationId() {
  try {
    const existing = localStorage.getItem(PUSH_INSTALLATION_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(PUSH_INSTALLATION_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function storedToken() {
  try {
    return String(localStorage.getItem(PUSH_TOKEN_KEY) || '').trim();
  } catch {
    return '';
  }
}

function rememberToken(token) {
  try {
    if (token) localStorage.setItem(PUSH_TOKEN_KEY, token);
    else localStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    // Token persistence is best effort; Firebase can issue it again on a later launch.
  }
}

function safeRoute(value) {
  const route = String(value || '').trim();
  if (!route.startsWith('/')) return '';
  if (/^\/(?:notifications|home)\/?(?:[?#].*)?$/.test(route)) return route;
  if (/^\/u\/[a-z0-9][a-z0-9._]{2,29}\/?(?:[?#].*)?$/i.test(route)) return route;
  if (/^\/post\/[0-9a-f-]{36}\/?(?:[?#].*)?$/i.test(route)) return route;
  if (/^\/messages(?:\/[0-9a-f-]{36})?\/?(?:[?#].*)?$/i.test(route)) return route;
  return '';
}

function openNotificationRoute(notification) {
  const route = safeRoute(notification?.notification?.data?.route || notification?.data?.route);
  if (!route) return;
  const destination = new URL(route, globalThis.location.origin);
  if (destination.origin !== globalThis.location.origin) return;
  globalThis.location.assign(destination.href);
}

async function bridgeRpc(name, args) {
  const bridge = globalThis.__sautilinkPushBridge;
  if (!bridge?.rpc) return { error: new Error('Push auth bridge is unavailable') };
  return bridge.rpc(name, args);
}

async function currentSession() {
  const bridge = globalThis.__sautilinkPushBridge;
  if (!bridge?.getSession) return null;
  const result = await bridge.getSession().catch(() => null);
  return result?.data?.session || null;
}

async function persistRegistration(token) {
  const normalized = String(token || '').trim();
  if (!normalized || normalized.length > 4096) return;
  const session = await currentSession();
  if (!session?.user?.id) return;

  const { error } = await bridgeRpc('register_push_device_token_v1', {
    p_installation_id: installationId(),
    p_token: normalized,
  });
  if (!error) rememberToken(normalized);
}

async function removeRegistration() {
  if (!storedToken()) return;
  await bridgeRpc('unregister_push_device_token_v1', {
    p_installation_id: installationId(),
  }).catch(() => null);
  rememberToken('');
}

globalThis.__sautilinkPushBeforeSignOut = removeRegistration;

async function ensurePushListeners(plugin) {
  if (pushListenersReady) return;
  pushListenersReady = true;

  await plugin.addListener('registration', ({ value }) => {
    void persistRegistration(value);
  });

  await plugin.addListener('registrationError', () => {
    // Firebase/Google Play Services can recover on a later launch or token refresh.
  });

  await plugin.addListener('pushNotificationActionPerformed', openNotificationRoute);
}

async function ensureChannel(plugin) {
  if (typeof plugin.createChannel !== 'function') return;
  await plugin.createChannel({
    id: PUSH_CHANNEL_ID,
    name: 'SautiLink notifications',
    description: 'Likes, comments, follows, mentions, messages and important SautiLink updates.',
    importance: 3,
    visibility: 1,
    vibration: true,
  }).catch(() => null);
}

async function registerPushIfReady() {
  if (pushRegistrationInFlight) return;
  const plugin = getPushPlugin();
  if (!plugin) return;
  const session = await currentSession();
  if (!session?.user?.id) return;

  pushRegistrationInFlight = true;
  try {
    await ensurePushListeners(plugin);
    await ensureChannel(plugin);
    const permission = await plugin.checkPermissions();
    if (permission?.receive !== 'granted') return;
    await plugin.register();
  } catch {
    // Push is optional; the web notification inbox remains available if native registration fails.
  } finally {
    pushRegistrationInFlight = false;
  }
}

function startPushBridge() {
  if (!isNativeAndroid()) return;
  const bridge = globalThis.__sautilinkPushBridge;
  if (!bridge?.getSession || !bridge?.onAuthStateChange || !bridge?.rpc) {
    pushStartAttempts += 1;
    if (pushStartAttempts < PUSH_START_MAX_ATTEMPTS) {
      window.setTimeout(startPushBridge, 100);
    }
    return;
  }

  void registerPushIfReady();
  bridge.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user?.id) {
      rememberToken('');
      return;
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      void registerPushIfReady();
    }
  });

  window.addEventListener('focus', () => void registerPushIfReady());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void registerPushIfReady();
  });
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPushBridge, { once: true });
  } else {
    startPushBridge();
  }
}
