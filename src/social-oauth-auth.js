const SOCIAL_OAUTH_REDIRECT = 'https://sautilink.com/home';

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

function injectStyles() {
  if (id('social-oauth-auth-styles')) return;
  const style = document.createElement('style');
  style.id = 'social-oauth-auth-styles';
  style.textContent = `
    .social-oauth-block {
      display: grid;
      gap: 10px;
      margin: 0 0 15px;
    }
    .social-oauth-button {
      display: flex;
      width: 100%;
      min-height: 46px;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 0 16px;
      border: 1px solid var(--app-line-strong);
      border-radius: 12px;
      background: var(--app-panel-soft);
      color: var(--app-text);
      font-weight: 760;
      cursor: pointer;
      transition: border-color 150ms ease, background 150ms ease, transform 150ms ease, opacity 150ms ease;
    }
    .social-oauth-button:hover:not(:disabled) {
      border-color: var(--app-muted);
      transform: translateY(-1px);
    }
    .social-oauth-button:disabled {
      opacity: .62;
      cursor: wait;
      transform: none;
    }
    .social-oauth-mark {
      display: grid;
      width: 22px;
      height: 22px;
      flex: 0 0 22px;
      place-items: center;
      border: 1px solid #d9dde4;
      border-radius: 50%;
      background: #fff;
      color: #4285f4;
      font-size: 14px;
      font-weight: 850;
      line-height: 1;
    }
    .social-oauth-separator {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      color: var(--app-muted);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .social-oauth-separator::before,
    .social-oauth-separator::after {
      height: 1px;
      background: var(--app-line);
      content: '';
    }
    .social-oauth-legal {
      margin: -2px 0 0;
      color: var(--app-muted);
      font-size: 9px;
      line-height: 1.45;
      text-align: center;
    }
    .social-oauth-legal a {
      font-weight: 700;
    }
    body.auth-entry .social-oauth-button {
      min-height: 44px;
      border-color: #d9dee6;
      border-radius: 8px;
      background: #fff;
      color: #1d2430;
      box-shadow: 0 1px 2px rgba(16, 24, 40, .04);
    }
    body.auth-entry .social-oauth-separator {
      color: #7a8492;
    }
    body.auth-entry .social-oauth-separator::before,
    body.auth-entry .social-oauth-separator::after {
      background: #e4e7ec;
    }
    body.auth-entry .social-oauth-legal {
      color: #6b7482;
    }
  `;
  document.head.append(style);
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
  button.innerHTML = '<span class="social-oauth-mark" aria-hidden="true">G</span><span>Continue with Google</span>';

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
  injectStyles();
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
