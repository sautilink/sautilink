import {
  BIRTH_DATE_MIN_YEAR,
  daysInBirthMonth,
  normalizeBirthDateParts,
  splitBirthDate,
} from './birth-date.js';

const PENDING_BIRTH_DATE_KEY = 'sautilink.auth.pending_birth_date';
const MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

let client = null;
let signupDraft = null;
let installed = false;
let syncingPending = false;
let settingsLoadedForUser = '';

const id = (value) => document.getElementById(value);

function setFormMessage(node, message, type = 'error') {
  if (!node) return;
  node.textContent = message || '';
  node.className = `form-message${type === 'success' ? ' success' : ''}`;
  node.hidden = !message;
}

function createOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function fillMonthOptions(select) {
  select.replaceChildren(createOption('', 'Month'));
  MONTHS.forEach((month, index) => select.append(createOption(String(index + 1), month)));
}

function fillYearOptions(select) {
  select.replaceChildren(createOption('', 'Year'));
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= BIRTH_DATE_MIN_YEAR; year -= 1) {
    select.append(createOption(String(year), String(year)));
  }
}

function fillDayOptions(select, year, month, preferred = '') {
  const max = year && month ? daysInBirthMonth(year, month) : 31;
  const previous = String(preferred || select.value || '');
  select.replaceChildren(createOption('', 'Day'));
  for (let day = 1; day <= max; day += 1) {
    select.append(createOption(String(day), String(day)));
  }
  if (previous && Number(previous) <= max) select.value = String(Number(previous));
}

function configureBirthDateFields(root, prefix) {
  const day = root.querySelector(`#${prefix}-birth-day`);
  const month = root.querySelector(`#${prefix}-birth-month`);
  const year = root.querySelector(`#${prefix}-birth-year`);
  if (!day || !month || !year) return null;

  fillMonthOptions(month);
  fillYearOptions(year);
  fillDayOptions(day, year.value, month.value);

  const refreshDays = () => fillDayOptions(day, year.value, month.value);
  month.addEventListener('change', refreshDays);
  year.addEventListener('change', refreshDays);

  return { day, month, year };
}

function fieldParts(fields) {
  return {
    year: fields?.year?.value || '',
    month: fields?.month?.value || '',
    day: fields?.day?.value || '',
  };
}

function setFieldValue(fields, value) {
  if (!fields) return;
  const parts = splitBirthDate(value);
  fields.year.value = parts.year ? String(Number(parts.year)) : '';
  fields.month.value = parts.month ? String(Number(parts.month)) : '';
  fillDayOptions(fields.day, fields.year.value, fields.month.value, parts.day);
}

function focusFirstMissing(fields) {
  if (!fields) return;
  const target = [fields.day, fields.month, fields.year].find((field) => !field.value) || fields.day;
  target?.focus();
}

function readBirthDate(fields) {
  return normalizeBirthDateParts(fieldParts(fields));
}

function injectStyles() {
  if (id('sautilink-birth-date-styles')) return;
  const style = document.createElement('style');
  style.id = 'sautilink-birth-date-styles';
  style.textContent = `
    .birth-date-fieldset { min-width: 0; margin: 0; padding: 0; border: 0; display: grid; gap: 8px; }
    .birth-date-fieldset legend { margin: 0 0 2px; padding: 0; color: var(--app-text); font: inherit; font-weight: 650; }
    .birth-date-fields { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.35fr) minmax(0, 1fr); gap: 8px; }
    .birth-date-control { min-width: 0; display: grid; gap: 5px; }
    .birth-date-control > label { color: var(--app-muted); font-size: 10px; }
    .birth-date-control > select { width: 100%; min-width: 0; min-height: 43px; padding: 0 10px; border: 1px solid var(--app-line); border-radius: 10px; background: var(--app-panel); color: var(--app-text); font: inherit; }
    .birth-date-control > select:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    .birth-date-settings-copy { margin: 0; color: var(--app-muted); font-size: 10px; line-height: 1.55; }
    .birth-date-settings-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .birth-date-settings-actions .form-message { flex: 1 1 180px; margin: 0; }
    @media (max-width: 420px) {
      .birth-date-fields { grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr) minmax(0, 1fr); gap: 6px; }
      .birth-date-control > select { padding-inline: 7px; }
    }
  `;
  document.head.append(style);
}

function createBirthDateFieldset(prefix, { required = false } = {}) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'birth-date-fieldset';
  fieldset.id = `${prefix}-birth-date-fieldset`;
  fieldset.innerHTML = `
    <legend>Date of birth</legend>
    <div class="birth-date-fields">
      <div class="birth-date-control">
        <label for="${prefix}-birth-day">Day</label>
        <select id="${prefix}-birth-day" name="birthDay" autocomplete="bday-day"${required ? ' required' : ''}></select>
      </div>
      <div class="birth-date-control">
        <label for="${prefix}-birth-month">Month</label>
        <select id="${prefix}-birth-month" name="birthMonth" autocomplete="bday-month"${required ? ' required' : ''}></select>
      </div>
      <div class="birth-date-control">
        <label for="${prefix}-birth-year">Year</label>
        <select id="${prefix}-birth-year" name="birthYear" autocomplete="bday-year"${required ? ' required' : ''}></select>
      </div>
    </div>
    <small class="field-hint">Your date of birth is private and is not shown on your public profile.</small>
  `;
  return fieldset;
}

function installSignupFields() {
  const form = id('signup-form');
  if (!form || id('signup-birth-date-fieldset')) return;

  const fieldset = createBirthDateFieldset('signup', { required: true });
  const emailLabel = form.querySelector('label[for="signup-email"]');
  if (emailLabel) emailLabel.insertAdjacentElement('beforebegin', fieldset);
  else form.prepend(fieldset);

  const fields = configureBirthDateFields(fieldset, 'signup');
  form.addEventListener('submit', (event) => {
    const message = id('signup-message');
    const result = readBirthDate(fields);
    if (result.error) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setFormMessage(message, result.error);
      focusFirstMissing(fields);
      return;
    }

    signupDraft = {
      email: String(form.email?.value || '').trim().toLowerCase(),
      birthDate: result.value,
      createdAt: Date.now(),
    };
  }, true);
}

function persistSignupDraft() {
  if (!signupDraft?.birthDate || !signupDraft?.email) return;
  try {
    sessionStorage.setItem(PENDING_BIRTH_DATE_KEY, JSON.stringify(signupDraft));
  } catch {
    // The same-tab flow can still save the in-memory draft after verification.
  }
}

function readPendingBirthDate() {
  if (signupDraft?.birthDate && signupDraft?.email) return signupDraft;
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_BIRTH_DATE_KEY) || 'null');
    if (!value?.birthDate || !value?.email) return null;
    if (value.createdAt && Date.now() - Number(value.createdAt) > 24 * 60 * 60 * 1000) {
      sessionStorage.removeItem(PENDING_BIRTH_DATE_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function clearPendingBirthDate() {
  signupDraft = null;
  try { sessionStorage.removeItem(PENDING_BIRTH_DATE_KEY); } catch {}
}

async function syncPendingBirthDate() {
  if (!client || syncingPending) return;
  const pending = readPendingBirthDate();
  if (!pending) return;

  syncingPending = true;
  try {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) return;
    const user = userData.user;
    if (String(user.email || '').trim().toLowerCase() !== String(pending.email || '').trim().toLowerCase()) return;

    const { data, error } = await client
      .from('account_profiles')
      .update({ birth_date: pending.birthDate })
      .eq('id', user.id)
      .select('birth_date')
      .maybeSingle();

    if (error || !data) return;
    if (data.birth_date === pending.birthDate) clearPendingBirthDate();
  } finally {
    syncingPending = false;
  }
}

function observeSignupCompletion() {
  const verifyPanel = id('verify-panel');
  if (verifyPanel) {
    new MutationObserver(() => {
      if (!verifyPanel.hidden) persistSignupDraft();
    }).observe(verifyPanel, { attributes: true, attributeFilter: ['hidden'] });
  }

  const memberView = id('member-view');
  if (memberView) {
    new MutationObserver(() => {
      if (!memberView.hidden) {
        persistSignupDraft();
        window.setTimeout(() => { void syncPendingBirthDate(); }, 0);
      }
    }).observe(memberView, { attributes: true, attributeFilter: ['hidden'] });
  }
}

function createSettingsCard() {
  if (id('settings-birth-date-card')) return;
  const accountPanel = document.querySelector('[data-settings-panel="account"]');
  if (!accountPanel) return;

  const card = document.createElement('article');
  card.className = 'settings-card';
  card.id = 'settings-birth-date-card';
  card.innerHTML = `
    <div class="settings-card-title"><strong>Date of birth</strong><small>Private account information</small></div>
    <p class="birth-date-settings-copy">Add the date you were born. This information stays private and is not displayed on your profile.</p>
    <form class="auth-form" id="settings-birth-date-form" novalidate>
      <div id="settings-birth-date-fields"></div>
      <div class="birth-date-settings-actions">
        <button class="secondary-action" type="submit">Save date of birth</button>
        <div class="form-message" id="settings-birth-date-message" role="status" aria-live="polite" hidden></div>
      </div>
    </form>
  `;

  const identityCard = accountPanel.querySelector('.settings-card');
  identityCard?.insertAdjacentElement('afterend', card);
  if (!identityCard) accountPanel.append(card);

  const holder = id('settings-birth-date-fields');
  const fieldset = createBirthDateFieldset('settings');
  holder.append(fieldset);
  configureBirthDateFields(fieldset, 'settings');
  id('settings-birth-date-form')?.addEventListener('submit', saveSettingsBirthDate);
}

function settingsFields() {
  const root = id('settings-birth-date-fieldset');
  if (!root) return null;
  return {
    day: id('settings-birth-day'),
    month: id('settings-birth-month'),
    year: id('settings-birth-year'),
  };
}

async function loadSettingsBirthDate({ force = false } = {}) {
  if (!client || !id('settings-birth-date-card')) return;
  try {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) return;
    const user = userData.user;
    if (!force && settingsLoadedForUser === user.id) return;

    const { data, error } = await client
      .from('account_profiles')
      .select('birth_date')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;

    setFieldValue(settingsFields(), data?.birth_date || '');
    settingsLoadedForUser = user.id;
    setFormMessage(id('settings-birth-date-message'), '');
  } catch {
    setFormMessage(id('settings-birth-date-message'), 'We could not load your date of birth. Try again.');
  }
}

async function saveSettingsBirthDate(event) {
  event.preventDefault();
  if (!client) return;

  const form = event.currentTarget;
  const fields = settingsFields();
  const result = readBirthDate(fields);
  const message = id('settings-birth-date-message');
  const submit = form.querySelector('[type="submit"]');
  setFormMessage(message, '');
  if (result.error) {
    setFormMessage(message, result.error);
    focusFirstMissing(fields);
    return;
  }

  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  const original = submit.textContent;
  submit.textContent = 'Saving…';
  try {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) throw userError || new Error('AUTH_REQUIRED');

    const { data, error } = await client
      .from('account_profiles')
      .update({ birth_date: result.value })
      .eq('id', userData.user.id)
      .select('birth_date')
      .maybeSingle();
    if (error || !data) throw error || new Error('PROFILE_UNAVAILABLE');

    setFieldValue(fields, data.birth_date || result.value);
    settingsLoadedForUser = userData.user.id;
    setFormMessage(message, 'Date of birth saved.', 'success');
  } catch {
    setFormMessage(message, 'We could not save your date of birth. Try again.');
  } finally {
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
    submit.textContent = original;
  }
}

function observeSettings() {
  const surface = id('settings-surface');
  if (!surface) return;
  new MutationObserver(() => {
    if (!surface.hidden) void loadSettingsBirthDate();
  }).observe(surface, { attributes: true, attributeFilter: ['hidden'] });
}

function installUi() {
  if (installed) return;
  installed = true;
  injectStyles();
  installSignupFields();
  createSettingsCard();
  observeSignupCompletion();
  observeSettings();
}

function attachClient(value) {
  client = value || null;
  if (!client) return;
  window.setTimeout(() => {
    void syncPendingBirthDate();
    if (!id('settings-surface')?.hidden) void loadSettingsBirthDate({ force: true });
  }, 0);

  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      if (!session?.user) {
        settingsLoadedForUser = '';
        return;
      }
      void syncPendingBirthDate();
      if (!id('settings-surface')?.hidden) void loadSettingsBirthDate({ force: true });
    }, 0);
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installUi();
  window.addEventListener('sautilink:auth-client-ready', (event) => attachClient(event.detail), { once: true });
  if (window.__sautilinkSupabaseAuthClient) attachClient(window.__sautilinkSupabaseAuthClient);
}
