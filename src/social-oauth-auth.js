const SOCIAL_OAUTH_REDIRECT = 'https://sautilink.com/home';
const SOCIAL_OAUTH_STYLESHEET = '/app/assets/guest-entry-gate.css?v=20260909-social4';

let client = null;
let installed = false;

const id = (value) => document.getElementById(value);

function setMessage(node, message, type = 'error') {
  if (!node) return;
  node.textContent = message || '';
  node.className = `form-message${type === 'success' ? ' success' : ''}`;
  node.hidden = !message;
}

function googleIconMarkup() {
  return `
    <svg class="social-oauth-brand-icon social-oauth-google-icon" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false" style="stroke:none">
      <path style="stroke:none" fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.39a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.97-4.33 2.97-7.39Z"></path>
      <path style="stroke:none" fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.38l-3.24-2.53c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.6-4.12H3.05v2.6A10 10 0 0 0 12 22Z"></path>
      <path style="stroke:none" fill="#FBBC05" d="M6.4 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.32-1.93v-2.6H3.05A10 10 0 0 0 2 12c0 1.61.38 3.14 1.05 4.53l3.35-2.6Z"></path>
      <path style="stroke:none" fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2 10 10 0 0 0 3.05 7.47l3.35 2.6C7.2 7.71 9.4 5.95 12 5.95Z"></path>
    </svg>`;
}

function facebookIconMarkup() {
  return `
    <svg class="social-oauth-brand-icon social-oauth-facebook-icon" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false" style="stroke:none">
      <circle style="stroke:none" cx="12" cy="12" r="12" fill="#1877F2"></circle>
      <path style="stroke:none" fill="#ffffff" d="M13.64 20.5v-7.74h2.6l.39-3.02h-2.99V7.82c0-.88.25-1.47 1.5-1.47h1.6V3.64c-.28-.04-1.23-.12-2.34-.12-2.31 0-3.9 1.41-3.9 4.01v2.21H7.88v3.02h2.62v7.74h3.14Z"></path>
    </svg>`;
}

function microsoftIconMarkup() {
  return `
    <svg class="social-oauth-brand-icon social-oauth-microsoft-icon" viewBox="0 0 21 21" width="19" height="19" aria-hidden="true" focusable="false" style="stroke:none">
      <rect style="stroke:none" x="0" y="0" width="10" height="10" fill="#F25022"></rect>
      <rect style="stroke:none" x="11" y="0" width="10" height="10" fill="#7FBA00"></rect>
      <rect style="stroke:none" x="0" y="11" width="10" height="10" fill="#00A4EF"></rect>
      <rect style="stroke:none" x="11" y="11" width="10" height="10" fill="#FFB900"></rect>
    </svg>`;
}

const SOCIAL_OAUTH_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'google', name: 'Google', label: 'Continue with Google', icon: googleIconMarkup }),
  Object.freeze({ id: 'facebook', name: 'Facebook', label: 'Continue with Facebook', icon: facebookIconMarkup }),
  Object.freeze({ id: 'azure', name: 'Microsoft', label: 'Continue with Microsoft', icon: microsoftIconMarkup, scopes: 'email' }),
]);

function oauthProvider(providerId) {
  return SOCIAL_OAUTH_PROVIDERS.find((provider) => provider.id === providerId) || null;
}

function socialOAuthError(providerId, error) {
  const provider = oauthProvider(providerId);
  const providerName = provider?.name || 'Social';
  const code = String(error?.code || '').trim().toLowerCase();
  const status = Number(error?.status || 0);

  if (code === 'provider_disabled') return `${providerName} sign-in is temporarily unavailable.`;
  if (status === 429 || code === 'over_request_rate_limit') {
    return 'Too many sign-in attempts. Wait a moment and try again.';
  }

  return `We could not start ${providerName} sign-in. Please try again.`;
}

function ensureStylesheet() {
  if (id('social-oauth-auth-styles')) return;
  const link = document.createElement('link');
  link.id = 'social-oauth-auth-styles';
  link.rel = 'stylesheet';
  link.href = SOCIAL_OAUTH_STYLESHEET;
  document.head.append(link);
}

function setProviderButtonsBusy(block, busy) {
  block?.querySelectorAll('[data-social-oauth-provider]').forEach((button) => {
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  });
}

function createProviderButton(provider, context) {
  const button = document.createElement('button');
  button.className = 'social-oauth-button';
  button.type = 'button';
  button.dataset.socialOauthProvider = provider.id;
  button.dataset.socialOauthContext = context;
  button.innerHTML = `${provider.icon()}<span class="social-oauth-label">${provider.label}</span>`;
  button.addEventListener('click', startSocialOAuth);
  return button;
}

function createBlock(panelId, formId, context) {
  const panel = id(panelId);
  const form = id(formId);
  if (!panel || !form || panel.querySelector(`[data-social-oauth-block="${context}"]`)) return;

  const block = document.createElement('div');
  block.className = 'social-oauth-block';
  block.dataset.socialOauthBlock = context;

  SOCIAL_OAUTH_PROVIDERS.forEach((provider) => {
    block.append(createProviderButton(provider, context));
  });

  const message = document.createElement('div');
  message.className = 'form-message';
  message.id = `social-oauth-${context}-message`;
  message.setAttribute('role', 'alert');
  message.hidden = true;
  block.append(message);

  if (context === 'signup') {
    const legal = document.createElement('p');
    legal.className = 'social-oauth-legal';
    legal.innerHTML = 'By continuing, you agree to the <a href="/terms">Terms</a> and acknowledge the <a href="/privacy">Privacy Policy</a>.';
    block.append(legal);
  }

  const separator = document.createElement('div');
  separator.className = 'social-oauth-separator';
  separator.setAttribute('aria-hidden', 'true');
  separator.textContent = 'or';
  block.append(separator);

  form.insertAdjacentElement('beforebegin', block);
}

async function startSocialOAuth(event) {
  if (!client) return;
  const button = event.currentTarget;
  const context = button.dataset.socialOauthContext || 'login';
  const providerId = button.dataset.socialOauthProvider || '';
  const provider = oauthProvider(providerId);
  if (!provider) return;

  const message = id(`social-oauth-${context}-message`);
  const block = button.closest('[data-social-oauth-block]');
  setMessage(message, '');
  setProviderButtonsBusy(block, true);

  try {
    const options = {
      redirectTo: SOCIAL_OAUTH_REDIRECT,
      ...(provider.scopes ? { scopes: provider.scopes } : {}),
    };
    const { error } = await client.auth.signInWithOAuth({
      provider: provider.id,
      options,
    });
    if (error) throw error;
  } catch (error) {
    setMessage(message, socialOAuthError(provider.id, error));
    setProviderButtonsBusy(block, false);
  }
}

function install() {
  if (installed || !client) return;
  installed = true;
  ensureStylesheet();
  createBlock('login-panel', 'login-form', 'login');
  createBlock('signup-panel', 'signup-form', 'signup');
}

window.addEventListener('sautilink:auth-client-ready', (event) => {
  client = event.detail || null;
  install();
}, { once: true });

if (window.__sautilinkSupabaseAuthClient) {
  client = window.__sautilinkSupabaseAuthClient;
  install();
}
