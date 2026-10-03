import { normalizeOtpPhone, otpPhoneError } from './phone-number-validation.js';

const WHATSAPP_FUNCTION = 'sautilink-whatsapp-otp';
const LOGIN_PHONE_KEY = 'sautilink.auth.whatsapp_login_phone';
const PHONE_CHANGE_KEY = 'sautilink.auth.whatsapp_phone_change';

let client = null;
let enabled = false;
let installed = false;
let channels = { sms: false, whatsapp: false };
let loginPhone = sessionStorage.getItem(LOGIN_PHONE_KEY) || '';
let phoneChange = sessionStorage.getItem(PHONE_CHANGE_KEY) || '';

const id = (value) => document.getElementById(value);

function normalizePhone(value) {
  return normalizeOtpPhone(value);
}

function normalizeStoredPhone(value) {
  const raw = String(value || '').trim().replace(/[\s()-]/g, '');
  const digits = raw.startsWith('+') ? raw.slice(1) : raw;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}

function formatStoredPhone(value) {
  const digits = normalizeStoredPhone(value);
  return digits ? `+${digits}` : '';
}

function normalizeOtp(value) {
  const code = String(value || '').replace(/\D/g, '');
  return /^\d{6,10}$/.test(code) ? code : '';
}

function setFormMessage(node, message, type = 'error') {
  if (!node) return;
  node.textContent = message || '';
  node.className = `form-message${type === 'success' ? ' success' : ''}`;
  node.hidden = !message;
}

function setSubmitBusy(button, busy, busyLabel) {
  if (!button) return;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent.trim();
  button.textContent = busy ? busyLabel : button.dataset.defaultLabel;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

function whatsappLoginRequestError(error) {
  const code = String(error?.code || '').trim().toLowerCase();
  const status = Number(error?.status || 0);

  if (code === 'over_sms_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    return 'Too many verification requests. Wait a moment and try again.';
  }
  if (code === 'captcha_failed') {
    return 'Security verification could not be completed. Refresh the page and try again.';
  }
  if (code === 'phone_provider_disabled') {
    return 'Phone code sign-in is temporarily unavailable.';
  }
  if (code === 'otp_disabled') {
    return 'We could not find a SautiLink account for this phone number.';
  }
  if (code === 'sms_send_failed' || code === 'hook_timeout') {
    return 'We could not deliver a phone code right now. Try again shortly.';
  }

  const reference = /^[a-z0-9_:-]{1,64}$/.test(code)
    ? code
    : status
      ? `http_${status}`
      : 'auth_request_failed';
  return `We could not send a phone code right now. Reference: ${reference}.`;
}

function setLoginPhone(value) {
  loginPhone = value;
  if (value) sessionStorage.setItem(LOGIN_PHONE_KEY, value);
  else sessionStorage.removeItem(LOGIN_PHONE_KEY);
}

function setPhoneChange(value) {
  phoneChange = value;
  if (value) sessionStorage.setItem(PHONE_CHANGE_KEY, value);
  else sessionStorage.removeItem(PHONE_CHANGE_KEY);
}

function authPanels() {
  return ['login-panel', 'signup-panel', 'verify-panel', 'passwordless-panel', 'recovery-panel', 'password-panel', 'onboarding-panel']
    .map(id)
    .filter(Boolean);
}

function showWhatsAppLoginPanel() {
  authPanels().forEach((panel) => { panel.hidden = true; });
  const tabs = id('auth-tabs');
  if (tabs) tabs.hidden = true;
  id('whatsapp-login-panel').hidden = false;
  window.setTimeout(() => id(loginPhone ? 'whatsapp-login-code' : 'whatsapp-login-phone')?.focus(), 0);
}

function showBaseLoginPanel() {
  id('whatsapp-login-panel').hidden = true;
  const tabs = id('auth-tabs');
  if (tabs) tabs.hidden = false;
  authPanels().forEach((panel) => { panel.hidden = panel.id !== 'login-panel'; });
  id('login-tab')?.setAttribute('aria-selected', 'true');
  id('signup-tab')?.setAttribute('aria-selected', 'false');
}

function createWhatsAppLoginPanel() {
  if (id('whatsapp-login-panel')) return;
  const authCard = document.querySelector('.auth-card');
  const emailCodeButton = id('show-passwordless');
  if (!authCard || !emailCodeButton) return;

  const entry = document.createElement('button');
  entry.className = 'text-action auth-code-action';
  entry.id = 'show-whatsapp-passwordless';
  entry.type = 'button';
  entry.textContent = 'Log in with phone code';
  entry.hidden = true;
  emailCodeButton.insertAdjacentElement('afterend', entry);

  const panel = document.createElement('section');
  panel.id = 'whatsapp-login-panel';
  panel.hidden = true;

  const back = document.createElement('button');
  back.className = 'back-action';
  back.type = 'button';
  back.textContent = 'Back to sign in';

  const heading = document.createElement('div');
  heading.className = 'form-heading';
  const label = document.createElement('p');
  label.className = 'section-label';
  label.textContent = 'Passwordless access';
  const title = document.createElement('h2');
  title.textContent = 'Sign in by phone';
  const copy = document.createElement('p');
  copy.textContent = 'Enter a verified phone number linked to your SautiLink account.';
  heading.append(label, title, copy);

  const requestForm = document.createElement('form');
  requestForm.className = 'auth-form';
  requestForm.id = 'whatsapp-login-request-form';
  requestForm.noValidate = true;
  requestForm.innerHTML = `
    <label for="whatsapp-login-phone">Phone number</label>
    <input id="whatsapp-login-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+2557XXXXXXXX" required>
    <small class="field-hint">Use international format, including the + country code.</small>
    <div class="form-message" id="whatsapp-login-request-message" role="alert" hidden></div>
    <button class="form-submit" type="submit">Send phone code</button>
  `;

  const verifyForm = document.createElement('form');
  verifyForm.className = 'auth-form auth-secondary-form';
  verifyForm.id = 'whatsapp-login-verify-form';
  verifyForm.noValidate = true;
  verifyForm.hidden = !loginPhone;
  verifyForm.innerHTML = `
    <label for="whatsapp-login-code">Verification code</label>
    <input class="otp-input" id="whatsapp-login-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="10" required placeholder="••••••">
    <small class="field-hint">Check the SMS or WhatsApp channel saved on your account.</small>
    <div class="form-message" id="whatsapp-login-verify-message" role="alert" hidden></div>
    <button class="form-submit" type="submit">Verify and sign in</button>
  `;

  panel.append(back, heading, requestForm, verifyForm);
  authCard.append(panel);

  entry.addEventListener('click', showWhatsAppLoginPanel);
  back.addEventListener('click', showBaseLoginPanel);
  requestForm.addEventListener('submit', requestWhatsAppLoginCode);
  verifyForm.addEventListener('submit', verifyWhatsAppLoginCode);
}

async function requestWhatsAppLoginCode(event) {
  event.preventDefault();
  if (!client || !enabled) return;
  const form = event.currentTarget;
  const phone = normalizePhone(form.phone.value);
  const message = id('whatsapp-login-request-message');
  const submit = form.querySelector('[type="submit"]');
  setFormMessage(message, '');
  if (!phone) return setFormMessage(message, otpPhoneError(form.phone.value));

  setSubmitBusy(submit, true, 'Sending code…');
  try {
    const { error } = await client.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
    setLoginPhone(phone);
    id('whatsapp-login-verify-form').hidden = false;
    setFormMessage(message, 'A sign-in code was requested for your linked number. Check SMS or WhatsApp.', 'success');
    id('whatsapp-login-code')?.focus();
  } catch (error) {
    setFormMessage(message, whatsappLoginRequestError(error));
  } finally {
    setSubmitBusy(submit, false, 'Sending code…');
  }
}

async function verifyWhatsAppLoginCode(event) {
  event.preventDefault();
  if (!client || !enabled) return;
  const form = event.currentTarget;
  const code = normalizeOtp(form.code.value);
  const message = id('whatsapp-login-verify-message');
  const submit = form.querySelector('[type="submit"]');
  setFormMessage(message, '');
  if (!loginPhone) return setFormMessage(message, 'Request a fresh phone sign-in code first.');
  if (!code) return setFormMessage(message, 'Enter the complete phone verification code.');

  setSubmitBusy(submit, true, 'Verifying…');
  try {
    const { error } = await client.auth.verifyOtp({ phone: loginPhone, token: code, type: 'sms' });
    if (error) throw error;
    setLoginPhone('');
    form.reset();
    setFormMessage(message, 'Phone number verified. Signing you in…', 'success');
  } catch {
    setFormMessage(message, 'That verification code is invalid or has expired. Request a new code and try again.');
  } finally {
    setSubmitBusy(submit, false, 'Verifying…');
  }
}

function createSettingsCard() {
  if (id('settings-whatsapp-card')) return;
  const accountPanel = document.querySelector('[data-settings-panel="account"]');
  if (!accountPanel) return;

  const card = document.createElement('article');
  card.className = 'settings-card';
  card.id = 'settings-whatsapp-card';
  card.hidden = true;
  card.innerHTML = `
    <div class="settings-card-title"><strong>Phone code sign-in</strong><small>Link one verified number to this account</small></div>
    <p class="settings-card-copy" id="settings-whatsapp-status" aria-live="polite">No phone number linked yet.</p>
    <label class="settings-select" for="settings-phone-otp-channel">
      <span>Send codes by</span>
      <select id="settings-phone-otp-channel" aria-label="Phone code delivery channel">
        <option value="whatsapp">WhatsApp</option>
        <option value="sms">SMS</option>
      </select>
    </label>
    <form class="auth-form" id="settings-whatsapp-link-form" novalidate>
      <label for="settings-whatsapp-phone">Phone number</label>
      <input id="settings-whatsapp-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+2557XXXXXXXX" required>
      <small class="field-hint">Use international format. We will send a code through your selected channel.</small>
      <div class="form-message" id="settings-whatsapp-link-message" role="alert" hidden></div>
      <button class="secondary-action" type="submit">Link phone number</button>
    </form>
    <form class="auth-form auth-secondary-form" id="settings-whatsapp-verify-form" novalidate hidden>
      <label for="settings-whatsapp-code">Verification code</label>
      <input class="otp-input" id="settings-whatsapp-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="10" required placeholder="••••••">
      <div class="form-message" id="settings-whatsapp-verify-message" role="alert" hidden></div>
      <button class="secondary-action" type="submit">Verify phone number</button>
    </form>
  `;

  const identityCard = accountPanel.querySelector('.settings-card');
  identityCard?.insertAdjacentElement('afterend', card);
  if (!identityCard) accountPanel.append(card);

  id('settings-whatsapp-link-form').addEventListener('submit', requestPhoneLinkCode);
  id('settings-whatsapp-verify-form').addEventListener('submit', verifyPhoneLinkCode);
  id('settings-phone-otp-channel').addEventListener('change', savePhoneChannelPreference);
}

function selectedPhoneChannel() {
  const channel = id('settings-phone-otp-channel')?.value;
  return channel === 'whatsapp' ? 'whatsapp' : 'sms';
}

async function savePhoneChannelPreference() {
  if (!client || !enabled) return;
  const channel = selectedPhoneChannel();
  if (!channels[channel]) return;
  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data?.user) return;
  const { error } = await client.auth.updateUser({
    data: { ...data.user.user_metadata, sautilink_phone_otp_channel: channel },
  });
  if (error) setFormMessage(id('settings-whatsapp-link-message'), 'Your phone code choice could not be saved.');
  else setFormMessage(id('settings-whatsapp-link-message'), `Phone codes will be sent by ${channel === 'sms' ? 'SMS' : 'WhatsApp'}.`, 'success');
}

async function syncSettingsPhone() {
  if (!client || !enabled || !id('settings-whatsapp-card')) return;
  const { data } = await client.auth.getUser().catch(() => ({ data: { user: null } }));
  const user = data?.user || null;
  const storedPhone = normalizeStoredPhone(user?.phone);
  const displayPhone = formatStoredPhone(storedPhone);
  const confirmed = Boolean(storedPhone && user?.phone_confirmed_at);
  const selector = id('settings-phone-otp-channel');
  selector.querySelector('[value="sms"]').disabled = !channels.sms;
  selector.querySelector('[value="whatsapp"]').disabled = !channels.whatsapp;
  const preference = user?.user_metadata?.sautilink_phone_otp_channel;
  selector.value = (preference === 'sms' || preference === 'whatsapp') && channels[preference]
    ? preference : channels.whatsapp ? 'whatsapp' : 'sms';
  const status = id('settings-whatsapp-status');
  status.textContent = confirmed
    ? `Verified phone number: ${displayPhone}`
    : phoneChange
      ? `Verification pending for ${phoneChange}`
      : 'No verified phone number is linked to this account yet.';
  status.dataset.state = confirmed ? 'verified' : phoneChange ? 'pending' : 'unlinked';

  const phoneInput = id('settings-whatsapp-phone');
  if (displayPhone && !phoneInput.value) phoneInput.value = displayPhone;

  const linkSubmit = id('settings-whatsapp-link-form')?.querySelector('[type="submit"]');
  if (linkSubmit && linkSubmit.getAttribute('aria-busy') !== 'true') {
    const label = confirmed ? 'Change phone number' : 'Link phone number';
    linkSubmit.textContent = label;
    linkSubmit.dataset.defaultLabel = label;
  }

  id('settings-whatsapp-verify-form').hidden = !phoneChange;
}

async function requestPhoneLinkCode(event) {
  event.preventDefault();
  if (!client || !enabled) return;
  const form = event.currentTarget;
  const phone = normalizePhone(form.phone.value);
  const message = id('settings-whatsapp-link-message');
  const submit = form.querySelector('[type="submit"]');
  setFormMessage(message, '');
  if (!phone) return setFormMessage(message, otpPhoneError(form.phone.value));

  setSubmitBusy(submit, true, 'Sending code…');
  try {
    const { data, error: userError } = await client.auth.getUser();
    if (userError || !data?.user || !channels[selectedPhoneChannel()]) throw new Error('Phone code channel unavailable.');
    const { error: choiceError } = await client.auth.updateUser({
      data: { ...data.user.user_metadata, sautilink_phone_otp_channel: selectedPhoneChannel() },
    });
    if (choiceError) throw choiceError;
    const { error } = await client.auth.updateUser({ phone });
    if (error) throw error;
    setPhoneChange(phone);
    id('settings-whatsapp-verify-form').hidden = false;
    setFormMessage(message, `A verification code was requested through ${selectedPhoneChannel() === 'sms' ? 'SMS' : 'WhatsApp'}.`, 'success');
    id('settings-whatsapp-code')?.focus();
    await syncSettingsPhone();
  } catch {
    setFormMessage(message, 'We could not send a verification code to this phone number.');
  } finally {
    setSubmitBusy(submit, false, 'Sending code…');
  }
}

async function verifyPhoneLinkCode(event) {
  event.preventDefault();
  if (!client || !enabled) return;
  const form = event.currentTarget;
  const code = normalizeOtp(form.code.value);
  const message = id('settings-whatsapp-verify-message');
  const submit = form.querySelector('[type="submit"]');
  setFormMessage(message, '');
  if (!phoneChange) return setFormMessage(message, 'Request a fresh phone verification code first.');
  if (!code) return setFormMessage(message, 'Enter the complete phone verification code.');

  setSubmitBusy(submit, true, 'Verifying…');
  try {
    const { error } = await client.auth.verifyOtp({ phone: phoneChange, token: code, type: 'phone_change' });
    if (error) throw error;
    setPhoneChange('');
    form.reset();
    form.hidden = true;
    setFormMessage(message, 'Phone code sign-in is now enabled for this account.', 'success');
    await syncSettingsPhone();
  } catch {
    setFormMessage(message, 'That verification code is invalid or has expired.');
  } finally {
    setSubmitBusy(submit, false, 'Verifying…');
  }
}

async function capabilityReady() {
  if (!client?.supabaseUrl) return null;
  try {
    const response = await fetch(`${client.supabaseUrl}/functions/v1/${WHATSAPP_FUNCTION}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return payload?.ok === true && payload?.data?.enabled === true ? payload.data.channels : null;
  } catch {
    return null;
  }
}

async function install() {
  if (installed || !client) return;
  installed = true;
  createWhatsAppLoginPanel();
  createSettingsCard();
  const available = await capabilityReady();
  enabled = Boolean(available?.sms || available?.whatsapp);
  if (!enabled) return;
  channels = available;

  id('show-whatsapp-passwordless').hidden = false;
  id('settings-whatsapp-card').hidden = false;
  await syncSettingsPhone();

  const settingsSurface = id('settings-surface');
  if (settingsSurface) {
    new MutationObserver(() => {
      if (!settingsSurface.hidden) void syncSettingsPhone();
    }).observe(settingsSurface, { attributes: true, attributeFilter: ['hidden'] });
  }
}

window.addEventListener('sautilink:auth-client-ready', (event) => {
  client = event.detail || null;
  void install();
}, { once: true });

if (window.__sautilinkSupabaseAuthClient) {
  client = window.__sautilinkSupabaseAuthClient;
  void install();
}
