const SOCIAL_OAUTH_REDIRECT = 'https://sautilink.com/home';
const SOCIAL_OAUTH_STYLESHEET = '/app/assets/social-oauth-auth.css?v=20260908-google1';

let client = null;
let installed = false;

const id = (value) => document.getElementById(value);

function setMessage(node, message, type = 'error') {
  if (!node) return;
  node.textContent = message || '';
  node.className = `form-message${type === 'success' ? ' success' : ''}`;
  node.hidden = !message;
}

function googleOAuthError(error) {
  const code = String(error?.code || '').trim().toLowerCase();
  const status = Number(error?.status || 0);

  if (code === 'provider_disabled') return 'Google sign-in is temporarily unavailable.';
  if (status === 429 || code === 'over_request_rate_limit') {
    return 'Too many sign-in attempts. Wait a moment and try again.';
  }

  return 'We could not start Google sign-in. Please try again.';
}

function ensureStylesheet() {
  if (id('social-oauth-auth-styles')) return;
  const link = document.createElement('link');
  link.id = 'social-oauth-auth-styles';
  link.rel = 'stylesheet';
  link.href = SOCIAL_OAUTH_STYLESHEET;
  document.head.append(link);
}

function googleIconMarkup() {
  return `
    <svg class="social-oauth-google-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.39a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.97-4.33 2.97-7.39Z"></path>
      <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.38l-3.24-2.53c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.6-4.12H3.05v2.6A10 10 0 0 0 12 22Z"></path>
      <path fill="#FBBC05" d="M6.4 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.32-1.93v-2.6H3.05A10 10 0 0 0 2 12c0 1.61.38 3.14 1.05 4.53l3.35-2.6Z"></path>
      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2 10 10 0 0 0 3.05 7.47l3.35 2.6C7.2 7.71 9.4 5.95 12 5.95Z"></path>
    </svg>`;
}

function createBlock(panelId, formId, context) {
  const panel = id(panelId);
  const form = id(formId);
  if (!panel || !form || panel.querySelector(`[data-social-oauth-block="${context}"]`)) return;

  const block = document.createElement('div');
  block.className = 'social-oauth-block';
  block.dataset.socialOauthBlock = context;

  const button = document.createElement('button');
  button.className = 'social-oauth-button';
  button.type = 'button';
  button.dataset.socialOauthProvider = 'google';
  button.dataset.socialOauthContext = context;
  button.innerHTML = `${googleIconMarkup()}<span class="social-oauth-label">Continue with Google</span>`;

  const message = document.createElement('div');
  message.className = 'form-message';
  message.id = `social-oauth-${context}-message`;
  message.setAttribute('role', 'alert');
  message.hidden = true;

  block.append(button, message);

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
  button.addEventListener('click', startGoogleOAuth);
}

async function startGoogleOAuth(event) {
  if (!client) return;
  const button = event.currentTarget;
  const context = button.dataset.socialOauthContext || 'login';
  const message = id(`social-oauth-${context}-message`);
  setMessage(message, '');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');

  try {
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: SOCIAL_OAUTH_REDIRECT,
      },
    });
    if (error) throw error;
  } catch (error) {
    setMessage(message, googleOAuthError(error));
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
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
