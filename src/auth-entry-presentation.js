// Account-entry presentation only. The existing authentication modules own
// panel visibility, form values, validation, requests and navigation.
const PANELS = [
  ['login-panel', 'login', 'Welcome back to SautiLink', 'Sign in to continue to your account.'],
  ['signup-panel', 'signup', 'Create your SautiLink account', 'Join SautiLink and set up your account.', 'details'],
  ['verify-panel', 'verify', 'Verify your email.', 'Use the code in your SautiLink email to continue.', 'verification'],
  ['signup-phone-panel', 'signupPhone', 'Verify your phone.', 'Confirm your phone number to finish setting up your account.', 'verification'],
  ['passwordless-panel', 'passwordless', 'Sign in with a code.', 'Get back to your account with an email verification code.'],
  ['recovery-panel', 'recovery', 'Get back to your account.', 'A recovery link will help you choose a new password.'],
  ['password-panel', 'password', 'Set a new password.', 'Choose a password for your SautiLink account.'],
  ['onboarding-panel', 'onboarding', 'Make it yours.', 'Confirm the details people will see on your profile.', 'profile'],
  ['whatsapp-login-panel', 'phone', 'Sign in with your phone.', 'Use the verification code sent to your phone.'],
];

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

export function installAuthEntryPresentation(root = globalThis.document) {
  const view = root?.getElementById('auth-view');
  if (!view || view.dataset.authEntryPresentationBound === 'true') return;
  view.dataset.authEntryPresentationBound = 'true';

  const intro = view.querySelector('.auth-intro');
  const title = intro?.querySelector('h2');
  const copy = intro?.querySelector('p');
  const tabs = root.getElementById('auth-tabs');
  const tabButtons = ['login-tab', 'signup-tab'].map((name) => root.getElementById(name)).filter(Boolean);
  let previousPanel = null;

  const sync = () => {
    // This field is inserted after startup by the existing phone sign-in UI.
    // Keep its hint consistent with the other account phone fields.
    const phone = root.getElementById('whatsapp-login-phone');
    if (phone && view.contains(phone) && phone.getAttribute('placeholder') !== 'Include country code') {
      phone.setAttribute('placeholder', 'Include country code');
    }
    // Password visibility is still toggled by the original button handler.
    view.querySelectorAll('[data-password-toggle]').forEach((button) => {
      const input = root.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const fieldName = input.id === 'new-password' ? 'new password' : 'password';
      const label = `${input.type === 'password' ? 'Show' : 'Hide'} ${fieldName}`;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    });

    if (view.hidden) {
      previousPanel = null;
      return;
    }
    const current = PANELS.find(([panelId]) => {
      const panel = root.getElementById(panelId);
      return panel && view.contains(panel) && !panel.hidden;
    });
    if (!current) return;

    const [panelId, mode, heading, description, step] = current;
    const panel = root.getElementById(panelId);
    view.dataset.presentationMode = mode;
    setText(title, heading);
    setText(copy, description);
    setText(tabButtons[0], 'Log in');
    setText(tabButtons[1], 'Sign up');
    tabButtons.forEach((button) => {
      button.tabIndex = button.getAttribute('aria-selected') === 'true' ? 0 : -1;
    });
    view.querySelectorAll('[data-auth-step]').forEach((item) => {
      if (step && item.dataset.authStep === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });

    // Restore a useful reading position after an in-page panel change. Keep
    // focus set by the existing flow (for example, an OTP field), and leave
    // keyboard tab navigation on the selected tab. Initial page load never
    // moves focus or opens the mobile keyboard.
    const active = root.activeElement;
    if (previousPanel && previousPanel !== panel && !panel.contains(active)
      && (!active || active === root.body || previousPanel.contains(active))) {
      const panelHeading = panel.querySelector('.form-heading h2');
      if (panelHeading) {
        panelHeading.tabIndex = -1;
        panelHeading.focus();
      }
    }
    previousPanel = panel;
  };

  tabs?.addEventListener('keydown', (event) => {
    const currentIndex = tabButtons.indexOf(event.target);
    if (currentIndex < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabButtons.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabButtons.length - 1;
    else return;
    event.preventDefault();
    const next = tabButtons[nextIndex];
    if (next.disabled) return;
    next.focus();
    next.click();
  });

  const Observer = root.defaultView?.MutationObserver || globalThis.MutationObserver;
  if (Observer) {
    new Observer(sync).observe(view, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-selected', 'aria-pressed', 'type'],
    });
  }
  sync();
}
