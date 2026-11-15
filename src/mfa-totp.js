/**
 * Optional SautiLink TOTP MFA for signed-in web members.
 *
 * Critical: this module never stores or logs a TOTP secret or verification code.
 * It guards member UI, but server-side RLS/Edge Function AAL checks are needed
 * separately for sensitive operations and for clients outside the Web app.
 */
export function validTotpCode(value) {
  return /^\d{6}$/.test(String(value || '').trim());
}

export function mfaGateDecision(level) {
  if (!level || typeof level !== 'object') return 'unavailable';
  const { currentLevel, nextLevel } = level;
  if (currentLevel === 'aal2') return 'allowed';
  if (currentLevel === 'aal1' && nextLevel === 'aal1') return 'allowed';
  if (currentLevel === 'aal1' && nextLevel === 'aal2') return 'challenge';
  return 'unavailable';
}

export function createTotpMfaController({ auth, doc = document, onUnlocked = () => {} } = {}) {
  if (!auth?.mfa) throw new Error('Supabase MFA API is required');

  const byId = (id) => doc.getElementById(id);
  let unlockedUserId = '';
  let unlockedSessionToken = '';
  let gateEpoch = 0;
  let gateUserId = '';
  let gatePromise = null;
  let pendingEnrollment = null;
  let busy = false;
  let active = false;

  function message(node, text, error = false) {
    if (!node) return;
    node.textContent = String(text || '');
    node.hidden = !text;
    node.dataset.error = error ? 'true' : 'false';
  }
  function toggleGate(show) {
    const gate = byId('sautilink-mfa-gate');
    if (!gate) return;
    gate.hidden = !show;
    active = show;
    const member = byId('member-view');
    if (member) member.inert = show;
    const authView = byId('auth-view');
    if (authView) authView.inert = show;
    if (show) {
      doc.body.classList.add('sautilink-mfa-locked');
      byId('sautilink-mfa-login-code')?.focus();
    } else {
      doc.body.classList.remove('sautilink-mfa-locked');
      if (member) member.inert = false;
      if (authView) authView.inert = false;
      if (byId('sautilink-mfa-login-code')) byId('sautilink-mfa-login-code').value = '';
      message(byId('sautilink-mfa-login-message'), '');
    }
  }
  async function refreshLoginFactors() {
    const select = byId('sautilink-mfa-login-factor');
    if (!select) return;
    try {
      const { data, error } = await auth.mfa.listFactors();
      if (error) throw error;
      const verified = (data?.totp || data?.all?.filter((f) => f.factor_type === 'totp') || [])
        .filter((factor) => factor.status === 'verified');
      select.replaceChildren(...verified.map((factor, index) => {
        const option = doc.createElement('option');
        option.value = factor.id;
        option.textContent = factor.friendly_name || 'Authenticator ' + (index + 1);
        return option;
      }));
      select.hidden = verified.length < 2;
      const label = byId('sautilink-mfa-factor-label');
      if (label) label.hidden = select.hidden;
    } catch {
      // Keep the code input available; challenge verification will re-check factors.
      select.hidden = true;
      const label = byId('sautilink-mfa-factor-label');
      if (label) label.hidden = true;
    }
  }
  function block(reason = 'Enter the code from your authenticator app to continue.') {
    toggleGate(true);
    message(byId('sautilink-mfa-login-message'), reason);
    void refreshLoginFactors();
  }
  function reset() {
    gateEpoch += 1;
    unlockedUserId = '';
    unlockedSessionToken = '';
    gateUserId = '';
    pendingEnrollment = null;
    gatePromise = null;
    toggleGate(false);
    const setup = byId('sautilink-mfa-enrollment');
    if (setup) setup.hidden = true;
    const qr = byId('sautilink-mfa-qr');
    if (qr) qr.removeAttribute('src');
    const secret = byId('sautilink-mfa-secret');
    if (secret) secret.textContent = '';
  }

  function isUnlockedFor(userId) {
    return Boolean(userId) && unlockedUserId === String(userId) && Boolean(unlockedSessionToken);
  }

  function onAuthEvent(event, session) {
    if (event === 'SIGNED_OUT') {
      reset();
      return;
    }
    if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED') return;
    if (!unlockedUserId) return;
    const sameSession = session?.user?.id === unlockedUserId
      && Boolean(session?.access_token)
      && session.access_token === unlockedSessionToken;
    if (sameSession) return;

    // An old member shell must never remain authorized when the token changes,
    // including a fresh login to the same account on this browser.
    gateEpoch += 1;
    unlockedUserId = '';
    unlockedSessionToken = '';
    gatePromise = null;
    gateUserId = '';
    block('Checking your account security again…');
    if (session?.user?.id && session?.access_token) {
      void guard(session.user, { resumeOnSuccess: true });
    }
  }

  async function guard(user, { resumeOnSuccess = false } = {}) {
    const userId = String(user?.id || '');
    if (!userId) return false;
    if (gatePromise && gateUserId === userId) return gatePromise;

    const epoch = ++gateEpoch;
    gateUserId = userId;
    gatePromise = (async () => {
      let outcome = 'unavailable';
      let checkedToken = '';
      try {
        const { data: first, error: firstError } = await auth.getSession();
        const session = first?.session;
        if (firstError || session?.user?.id !== userId || !session.access_token) {
          throw new Error('MFA_SESSION_ID_MISMATCH');
        }
        checkedToken = session.access_token;
        if (isUnlockedFor(userId) && unlockedSessionToken === checkedToken) {
          outcome = 'allowed';
        } else {
          const { data, error } = await auth.mfa.getAuthenticatorAssuranceLevel();
          if (error) throw error;
          outcome = mfaGateDecision(data);
        }

        // Stop a sign-out, account switch or refreshed session racing with the
        // assurance-level check. The next attempt can re-check the new token.
        const { data: second, error: secondError } = await auth.getSession();
        if (secondError || second?.session?.user?.id !== userId
          || second.session.access_token !== checkedToken) {
          throw new Error('MFA_SESSION_CHANGED');
        }
      } catch {
        outcome = 'unavailable';
      }
      if (epoch !== gateEpoch || gateUserId !== userId) return false;
      if (outcome === 'allowed') {
        unlockedUserId = userId;
        unlockedSessionToken = checkedToken;
        toggleGate(false);
        if (resumeOnSuccess) onUnlocked();
        return true;
      }
      unlockedUserId = '';
      unlockedSessionToken = '';
      if (outcome === 'challenge') block();
      else block('We could not confirm your account security level. Retry or sign out.');
      return false;
    })().finally(() => {
      if (epoch === gateEpoch && gateUserId === userId) gatePromise = null;
    });
    return gatePromise;
  }

  async function verifyChallenge(event) {
    event.preventDefault();
    if (busy || !gateUserId) return;
    const input = byId('sautilink-mfa-login-code');
    const code = String(input?.value || '').trim();
    if (!validTotpCode(code)) return message(byId('sautilink-mfa-login-message'), 'Enter the 6-digit authenticator code.', true);
    busy = true;
    const expectedUserId = gateUserId;
    const epoch = gateEpoch;
    const submit = byId('sautilink-mfa-login-submit');
    if (submit) submit.disabled = true;
    message(byId('sautilink-mfa-login-message'), 'Verifying your code…');
    try {
      const { data: first, error: firstError } = await auth.getSession();
      if (firstError || first?.session?.user?.id !== expectedUserId || !first.session.access_token) {
        throw new Error('MFA_SESSION_CHANGED');
      }
      const { data: factors, error: listError } = await auth.mfa.listFactors();
      if (listError) throw listError;
      const verified = (factors?.totp || factors?.all?.filter((f) => f.factor_type === 'totp') || [])
        .filter((item) => item.status === 'verified');
      const selectedId = byId('sautilink-mfa-login-factor')?.value || '';
      const factor = verified.find((item) => item.id === selectedId) || verified[0];
      if (!factor?.id) throw new Error('MFA_FACTOR_MISSING');
      const { error } = await auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (error) throw error;
      const { data: level, error: levelError } = await auth.mfa.getAuthenticatorAssuranceLevel();
      if (levelError || mfaGateDecision(level) !== 'allowed') throw new Error('MFA_AAL2_REQUIRED');
      const { data: final, error: finalError } = await auth.getSession();
      if (finalError || final?.session?.user?.id !== expectedUserId
        || !final.session.access_token || epoch !== gateEpoch || gateUserId !== expectedUserId) {
        throw new Error('MFA_SESSION_CHANGED');
      }
      unlockedUserId = expectedUserId;
      unlockedSessionToken = final.session.access_token;
      toggleGate(false);
      onUnlocked();
    } catch {
      if (input) input.value = '';
      message(byId('sautilink-mfa-login-message'), 'That code could not be verified. Check the time on your phone and try again.', true);
      input?.focus();
    } finally {
      busy = false;
      if (submit) submit.disabled = false;
    }
  }

  function hideEnrollment() {
    const section = byId('sautilink-mfa-enrollment');
    if (section) section.hidden = true;
    const img = byId('sautilink-mfa-qr');
    if (img) img.removeAttribute('src');
    const secret = byId('sautilink-mfa-secret');
    if (secret) secret.textContent = '';
    const code = byId('sautilink-mfa-setup-code');
    if (code) code.value = '';
    pendingEnrollment = null;
  }

  async function refreshSettings() {
    const status = byId('sautilink-mfa-status');
    if (!status) return;
    try {
      const { data, error } = await auth.mfa.listFactors();
      if (error) throw error;
      const verified = (data?.totp || data?.all?.filter((f) => f.factor_type === 'totp') || [])
        .filter((f) => f.status === 'verified');
      status.textContent = verified.length
        ? 'On — ' + verified.length + ' authenticator' + (verified.length === 1 ? '' : 's') + ' connected.'
        : 'Off — Add an authenticator to protect your sign-ins.';
      byId('sautilink-mfa-enable').textContent = verified.length ? 'Add backup authenticator' : 'Enable two-factor authentication';
      const remove = byId('sautilink-mfa-remove');
      if (remove) remove.hidden = !verified.length;
      const select = byId('sautilink-mfa-remove-factor');
      if (select) {
        select.replaceChildren(...verified.map((factor, index) => {
          const option = doc.createElement('option');
          option.value = factor.id;
          option.textContent = factor.friendly_name || 'Authenticator ' + (index + 1);
          return option;
        }));
        select.hidden = !verified.length;
      }
    } catch {
      status.textContent = 'Security status unavailable. Try again.';
    }
  }

  async function startEnrollment() {
    if (busy || pendingEnrollment) return;
    busy = true;
    const button = byId('sautilink-mfa-enable');
    if (button) button.disabled = true;
    message(byId('sautilink-mfa-setup-message'), 'Preparing authenticator setup…');
    try {
      const { data, error } = await auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'SautiLink Authenticator',
      });
      if (error || !data?.id || !data?.totp?.secret) throw error || new Error('INVALID_ENROLLMENT');
      pendingEnrollment = { id: data.id };
      const qr = byId('sautilink-mfa-qr');
      // Supabase returns a data:image/svg+xml QR code. Do not inject raw SVG into HTML.
      if (qr && /^data:image\/svg\+xml[;,]/i.test(data.totp.qr_code || '')) {
        qr.src = data.totp.qr_code;
        qr.hidden = false;
      } else if (qr) qr.hidden = true;
      byId('sautilink-mfa-secret').textContent = data.totp.secret;
      byId('sautilink-mfa-enrollment').hidden = false;
      message(byId('sautilink-mfa-setup-message'), 'Scan the QR code or enter the key in your authenticator app. Then enter its 6-digit code.');
      byId('sautilink-mfa-setup-code')?.focus();
    } catch {
      message(byId('sautilink-mfa-setup-message'), 'Could not start setup. Try again.', true);
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  async function finishEnrollment(event) {
    event.preventDefault();
    if (busy || !pendingEnrollment?.id) return;
    const code = String(byId('sautilink-mfa-setup-code')?.value || '').trim();
    if (!validTotpCode(code)) return message(byId('sautilink-mfa-setup-message'), 'Enter the 6-digit code.', true);
    busy = true;
    const submit = byId('sautilink-mfa-setup-submit');
    if (submit) submit.disabled = true;
    try {
      const { error } = await auth.mfa.challengeAndVerify({
        factorId: pendingEnrollment.id, code,
      });
      if (error) throw error;
      hideEnrollment();
      message(byId('sautilink-mfa-setup-message'), 'Two-factor authentication is enabled.');
      await refreshSettings();
    } catch {
      message(byId('sautilink-mfa-setup-message'), 'That code was not accepted. Try a fresh authenticator code.', true);
    } finally {
      busy = false;
      if (submit) submit.disabled = false;
    }
  }

  async function cancelEnrollment() {
    const enrollment = pendingEnrollment;
    hideEnrollment();
    message(byId('sautilink-mfa-setup-message'), '');
    if (enrollment?.id) {
      try { await auth.mfa.unenroll({ factorId: enrollment.id }); } catch { /* Unverified factor is left for server cleanup. */ }
    }
  }

  async function removeFactor() {
    if (busy) return;
    const factorId = byId('sautilink-mfa-remove-factor')?.value;
    if (!factorId) return;
    if (!globalThis.confirm('Remove this authenticator? If it is your last factor, two-factor authentication will be disabled.')) return;
    busy = true;
    try {
      const { data: level, error: aalError } = await auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError || level?.currentLevel !== 'aal2') {
        throw new Error('MFA_REAUTH_REQUIRED');
      }
      const { error } = await auth.mfa.unenroll({ factorId });
      if (error) throw error;
      message(byId('sautilink-mfa-setup-message'), 'Authenticator removed.');
      await refreshSettings();
    } catch {
      message(byId('sautilink-mfa-setup-message'), 'Could not remove authenticator. Verify your identity again and retry.', true);
    } finally { busy = false; }
  }

  function mount() {
    if (byId('sautilink-mfa-login-form')) {
      byId('sautilink-mfa-login-form').addEventListener('submit', verifyChallenge);
      byId('sautilink-mfa-retry')?.addEventListener('click', async () => {
        gatePromise = null;
        const userId = gateUserId;
        if (!userId) return;
        await guard({ id: userId }, { resumeOnSuccess: true });
      });
      byId('sautilink-mfa-signout')?.addEventListener('click', async () => {
        try {
          const { error } = await auth.signOut({ scope: 'local' });
          if (error) throw error;
          reset();
          globalThis.location.assign('/login');
        } catch {
          block('Sign-out could not be completed. Please retry.');
        }
      });
    }
    byId('sautilink-mfa-enable')?.addEventListener('click', startEnrollment);
    byId('sautilink-mfa-setup-form')?.addEventListener('submit', finishEnrollment);
    byId('sautilink-mfa-cancel')?.addEventListener('click', cancelEnrollment);
    byId('sautilink-mfa-remove')?.addEventListener('click', removeFactor);
  }

  mount();
  return { guard, isUnlockedFor, onAuthEvent, refreshSettings, reset, active: () => active };
}
