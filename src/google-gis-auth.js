/**
 * SautiLink Google Identity Services (GIS) sign-in.
 *
 * Keep the legacy Supabase OAuth action available as a fallback. A new GIS
 * Google Web Client ID MUST be added to Supabase Auth > Google > Client IDs
 * before this integration is enabled on production.
 *
 * The GIS button must be rendered by Google's library; calling it through
 * a custom button click is not supported by Google.
 */
export const SAUTILINK_GOOGLE_WEB_CLIENT_ID =
  '93555813548-6c14o15be6tfl0hk82m2o3soogq90aq6.apps.googleusercontent.com';

const SDK_URL = 'https://accounts.google.com/gsi/client';
const sdkPromises = new WeakMap();

export function shouldOfferGoogleGis(win) {
  const hostname = win?.location?.hostname || '';
  const path = win?.location?.pathname || '';
  // Do not turn on native Android/webview OAuth by accident.
  if (win?.Capacitor?.getPlatform?.() && win.Capacitor.getPlatform() !== 'web') return false;
  // Google Web OAuth origin is explicitly registered for sautilink.com.
  return hostname === 'sautilink.com' && /^\/(?:login|signup)\/?$/.test(path);
}

async function createNonce(cryptoImpl) {
  const random = cryptoImpl.getRandomValues(new Uint8Array(32));
  const raw = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { raw, hashed };
}

function loadGoogleSdk(win, doc) {
  if (win.google?.accounts?.id) return Promise.resolve(win.google.accounts.id);
  if (sdkPromises.has(doc)) return sdkPromises.get(doc);

  const sdkPromise = new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.addEventListener('load', () => {
      if (win.google?.accounts?.id) resolve(win.google.accounts.id);
      else reject(new Error('Google sign-in library unavailable'));
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('Google sign-in library failed to load')), { once: true });
    doc.head.append(script);
  }).catch((error) => {
    sdkPromises.delete(doc);
    throw error;
  });
  sdkPromises.set(doc, sdkPromise);
  return sdkPromise;
}

export async function installGoogleGis({
  win = window,
  doc = document,
  auth,
  blocks,
  onError = () => {},
  onSuccess = () => {},
  cryptoImpl = crypto,
} = {}) {
  if (!shouldOfferGoogleGis(win) || !auth?.signInWithIdToken || !blocks?.length) return false;

  let provider;
  let nonce;
  try {
    [provider, nonce] = await Promise.all([loadGoogleSdk(win, doc), createNonce(cryptoImpl)]);
  } catch {
    // Google's script can be blocked: leave legacy Google OAuth fully functional.
    return false;
  }

  if (!provider?.initialize || !provider?.renderButton) return false;
  let signingIn = false;

  try {
    provider.initialize({
      client_id: SAUTILINK_GOOGLE_WEB_CLIENT_ID,
      ux_mode: 'popup',
      nonce: nonce.hashed,
      auto_select: false,
      callback: async (response) => {
        if (signingIn) return;
        signingIn = true;
        try {
          if (typeof response?.credential !== 'string' || !response.credential) {
            throw new Error('GOOGLE_ID_TOKEN_MISSING');
          }
          const { error } = await auth.signInWithIdToken({
            provider: 'google',
            token: response.credential,
            nonce: nonce.raw,
          });
          if (error) throw error;
          onSuccess();
          // SautiLink's existing SIGNED_IN subscription handles onboarding
          // and navigation; do not bypass its account/phone checks here.
        } catch {
          onError('Google sign-in could not be completed. Try the alternative Google sign-in below.');
        } finally {
          signingIn = false;
        }
      },
    });

    for (const { block, context } of blocks) {
      if (!block || block.querySelector('[data-google-gis-slot]')) continue;
      const oldButton = block.querySelector('[data-social-oauth-provider="google"]');
      if (!oldButton) continue;
      const slot = doc.createElement('div');
      slot.className = 'google-gis-button-slot';
      slot.dataset.googleGisSlot = context;
      oldButton.before(slot);
      provider.renderButton(slot, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: context === 'signup' ? 'signup_with' : 'continue_with',
        shape: 'rectangular',
        width: 320,
        logo_alignment: 'left',
        state: context,
      });
      oldButton.classList.add('social-oauth-google-alternative');
      oldButton.setAttribute('aria-label', 'Alternative Google sign-in');
      oldButton.querySelector('.social-oauth-label')?.replaceChildren('Alternative Google sign-in');
    }
    return true;
  } catch {
    // The original Google OAuth buttons remain available even if GIS breaks.
    doc.querySelectorAll('.google-gis-button-slot').forEach((node) => node.remove());
    doc.querySelectorAll('.social-oauth-google-alternative').forEach((node) => {
      node.classList.remove('social-oauth-google-alternative');
      node.setAttribute('aria-label', 'Continue with Google');
      node.querySelector('.social-oauth-label')?.replaceChildren('Google');
    });
    return false;
  }
}
