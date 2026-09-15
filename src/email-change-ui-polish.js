const EMAIL_CHANGE_STYLE_HREF = '/app/assets/auth-flow-hardening.css?v=20260915-authflow2';
const LEGACY_CONFIRMATION_COPY = /confirmation email sent|confirmation link/i;

function ensureLatestEmailChangeStyles() {
  if (document.querySelector(`link[href="${EMAIL_CHANGE_STYLE_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = EMAIL_CHANGE_STYLE_HREF;
  document.head.append(link);
}

function rewriteLegacyEmailChangeMessage() {
  const message = document.getElementById('change-email-message');
  if (!message || !LEGACY_CONFIRMATION_COPY.test(message.textContent || '')) return;
  message.textContent = 'Verification code sent. Enter the 8-digit code below to finish changing your email address.';
}

function polishEmailChangeRequest() {
  const form = document.getElementById('change-email-form');
  if (!form) return;

  form.dataset.emailChangeMode = 'otp';

  const hint = form.querySelector('.field-hint');
  if (hint) {
    hint.textContent = 'We will send an 8-digit verification code before the address changes.';
  }

  const submit = form.querySelector('[type="submit"]');
  if (submit && !submit.disabled) {
    submit.textContent = 'Send verification code';
  }

  const message = document.getElementById('change-email-message');
  if (message && !message.dataset.emailChangeCopyGuard) {
    message.dataset.emailChangeCopyGuard = 'true';
    const observer = new MutationObserver(rewriteLegacyEmailChangeMessage);
    observer.observe(message, { childList: true, characterData: true, subtree: true });
  }

  rewriteLegacyEmailChangeMessage();
}

function installEmailChangeUiPolish() {
  ensureLatestEmailChangeStyles();
  polishEmailChangeRequest();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installEmailChangeUiPolish, { once: true });
} else {
  queueMicrotask(installEmailChangeUiPolish);
}
