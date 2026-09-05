const PROFESSIONAL_CATEGORY_SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const PROFESSIONAL_CATEGORY_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const PROFESSIONAL_CATEGORY_AUTH_KEY = 'sautilink.auth.session';
const PROFESSIONAL_CATEGORY_STYLESHEET = '/app/assets/professional-profile-category.css';
const PROFESSIONAL_CATEGORY_RESULT_LIMIT = 25;
const PROFESSIONAL_CATEGORY_POPULAR_SLUGS = Object.freeze([
  'public-figure',
  'content-creator',
  'company',
  'artist',
  'government-official',
  'comedian',
  'entrepreneur',
  'musician',
  'actor',
  'athlete',
  'journalist',
  'media-company',
  'news-media-website',
  'organization',
  'nonprofit-organization',
  'software-company',
  'photographer',
  'fashion-model',
  'producer',
  'blogger',
  'politician',
  'business-service',
  'digital-marketing-agency',
  'restaurant',
  'brand',
]);
const PROFESSIONAL_CATEGORY_POPULAR_RANK = new Map(
  PROFESSIONAL_CATEGORY_POPULAR_SLUGS.map((slug, index) => [slug, index]),
);

let professionalCategoryCatalog = null;
let professionalCategoryCatalogPromise = null;
let professionalCategoryProfile = null;
let professionalCategoryProfileRequest = 0;
let professionalCategorySyncTimer = 0;

function professionalCategorySession() {
  try {
    const raw = window.localStorage.getItem(PROFESSIONAL_CATEGORY_AUTH_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value?.access_token && value?.user?.id) return value;
    if (value?.currentSession?.access_token && value?.currentSession?.user?.id) return value.currentSession;
  } catch {
    // A missing or malformed local session simply means owner editing is unavailable.
  }
  return null;
}

function professionalCategoryHeaders({ authenticated = false, json = false } = {}) {
  const headers = {
    apikey: PROFESSIONAL_CATEGORY_PUBLISHABLE_KEY,
    Accept: 'application/json',
  };
  if (authenticated) {
    const token = professionalCategorySession()?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function ensureProfessionalCategoryStylesheet() {
  if (document.querySelector(`link[href="${PROFESSIONAL_CATEGORY_STYLESHEET}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = PROFESSIONAL_CATEGORY_STYLESHEET;
  link.dataset.sautilinkProfessionalCategory = 'true';
  document.head.append(link);
}

function profileUsernameFromScreen() {
  const node = document.getElementById('profile-username');
  const username = String(node?.textContent || '').trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9._]{2,29}$/.test(username) ? username : '';
}

async function readProfessionalCategoryCatalog() {
  if (professionalCategoryCatalog) return professionalCategoryCatalog;
  if (professionalCategoryCatalogPromise) return professionalCategoryCatalogPromise;

  professionalCategoryCatalogPromise = fetch(
    `${PROFESSIONAL_CATEGORY_SUPABASE_URL}/rest/v1/profile_categories?select=slug,label,group_name,description,sort_order&order=group_name.asc,label.asc&limit=1000`,
    { headers: professionalCategoryHeaders({ authenticated: Boolean(professionalCategorySession()) }) },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error('Professional categories could not be loaded.');
      const rows = await response.json();
      professionalCategoryCatalog = Array.isArray(rows) ? rows : [];
      return professionalCategoryCatalog;
    })
    .finally(() => {
      professionalCategoryCatalogPromise = null;
    });

  return professionalCategoryCatalogPromise;
}

function professionalCategoryBySlug(slug) {
  return (professionalCategoryCatalog || []).find((category) => category.slug === slug) || null;
}

function normalizeProfessionalCategorySearch(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function professionalCategoryEditDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previousPrevious = new Array(b.length + 1).fill(0);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
      if (
        i > 1
        && j > 1
        && a[i - 1] === b[j - 2]
        && a[i - 2] === b[j - 1]
      ) {
        value = Math.min(value, previousPrevious[j - 2] + 1);
      }
      current[j] = value;
    }
    for (let j = 0; j <= b.length; j += 1) previousPrevious[j] = previous[j];
    previous = current;
  }

  return previous[b.length];
}

function professionalCategorySearchScore(category, query) {
  const normalizedQuery = normalizeProfessionalCategorySearch(query);
  if (!normalizedQuery) return Number.POSITIVE_INFINITY;

  const label = normalizeProfessionalCategorySearch(category.label);
  const group = normalizeProfessionalCategorySearch(category.group_name);
  if (label === normalizedQuery) return 0;
  if (label.startsWith(normalizedQuery)) return 1;
  if (label.includes(normalizedQuery)) return 2;
  if (group.includes(normalizedQuery)) return 4;

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const labelTokens = label.split(' ').filter(Boolean);
  if (queryTokens.length && labelTokens.length) {
    let totalDistance = 0;
    let tokenMatch = true;
    for (const queryToken of queryTokens) {
      const best = Math.min(...labelTokens.map((labelToken) => professionalCategoryEditDistance(queryToken, labelToken)));
      const threshold = queryToken.length <= 4 ? 1 : Math.max(1, Math.ceil(queryToken.length * 0.3));
      if (best > threshold) {
        tokenMatch = false;
        break;
      }
      totalDistance += best;
    }
    if (tokenMatch) return 10 + totalDistance;
  }

  const fullDistance = professionalCategoryEditDistance(normalizedQuery, label);
  const fullThreshold = Math.max(2, Math.ceil(Math.max(normalizedQuery.length, label.length) * 0.24));
  if (fullDistance <= fullThreshold) return 20 + fullDistance;
  return Number.POSITIVE_INFINITY;
}

function professionalCategoryDefaultMatches() {
  const catalog = professionalCategoryCatalog || [];
  const bySlug = new Map(catalog.map((category) => [category.slug, category]));
  const popular = PROFESSIONAL_CATEGORY_POPULAR_SLUGS.map((slug) => bySlug.get(slug)).filter(Boolean);
  if (popular.length >= PROFESSIONAL_CATEGORY_RESULT_LIMIT) return popular.slice(0, PROFESSIONAL_CATEGORY_RESULT_LIMIT);

  const used = new Set(popular.map((category) => category.slug));
  const fallback = catalog
    .filter((category) => !used.has(category.slug))
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.label.localeCompare(b.label));
  return [...popular, ...fallback].slice(0, PROFESSIONAL_CATEGORY_RESULT_LIMIT);
}

function professionalCategorySearchMatches(query = '') {
  const normalized = normalizeProfessionalCategorySearch(query);
  if (!normalized) return { matches: professionalCategoryDefaultMatches(), mode: 'popular' };

  const scored = (professionalCategoryCatalog || [])
    .map((category) => ({ category, score: professionalCategorySearchScore(category, normalized) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const aPopular = PROFESSIONAL_CATEGORY_POPULAR_RANK.get(a.category.slug) ?? 999;
      const bPopular = PROFESSIONAL_CATEGORY_POPULAR_RANK.get(b.category.slug) ?? 999;
      return aPopular - bPopular
        || Number(a.category.sort_order || 0) - Number(b.category.sort_order || 0)
        || a.category.label.localeCompare(b.category.label);
    })
    .slice(0, PROFESSIONAL_CATEGORY_RESULT_LIMIT);

  return {
    matches: scored.map((entry) => entry.category),
    mode: scored.length && scored[0].score >= 10 ? 'closest' : 'results',
  };
}

async function readProfileProfessionalCategory(username) {
  const params = new URLSearchParams({
    select: 'id,username,professional_category_slug',
    username: `eq.${username}`,
    limit: '1',
  });
  const response = await fetch(`${PROFESSIONAL_CATEGORY_SUPABASE_URL}/rest/v1/social_profiles?${params}`, {
    headers: professionalCategoryHeaders({ authenticated: true }),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function ensureProfessionalCategoryButton() {
  const username = document.getElementById('profile-username');
  if (!username) return null;

  let button = document.getElementById('profile-professional-category');
  if (!button) {
    button = document.createElement('button');
    button.id = 'profile-professional-category';
    button.className = 'profile-professional-category';
    button.type = 'button';
    button.hidden = true;
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', openProfessionalCategoryDialog);
    username.insertAdjacentElement('afterend', button);
  }
  return button;
}

function renderProfessionalCategoryButton(category) {
  const button = ensureProfessionalCategoryButton();
  if (!button) return;
  if (!category) {
    button.hidden = true;
    button.replaceChildren();
    button.removeAttribute('data-category-slug');
    return;
  }

  button.dataset.categorySlug = category.slug;
  button.setAttribute('aria-label', `About the ${category.label} professional category`);
  button.title = `About ${category.label}`;
  button.replaceChildren();

  const text = document.createElement('span');
  text.textContent = category.label;
  const info = document.createElement('span');
  info.className = 'profile-professional-category-info';
  info.setAttribute('aria-hidden', 'true');
  info.textContent = 'i';
  button.append(text, info);
  button.hidden = false;
}

function ensureProfessionalCategoryDialog() {
  let dialog = document.getElementById('professional-category-dialog');
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.id = 'professional-category-dialog';
  dialog.className = 'professional-category-dialog';
  dialog.setAttribute('aria-labelledby', 'professional-category-dialog-title');

  const card = document.createElement('div');
  card.className = 'professional-category-dialog-card';

  const header = document.createElement('header');
  const heading = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'section-label';
  eyebrow.textContent = 'Professional category';
  const title = document.createElement('h2');
  title.id = 'professional-category-dialog-title';
  heading.append(eyebrow, title);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'professional-category-dialog-close';
  close.setAttribute('aria-label', 'Close professional category information');
  close.title = 'Close';
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>';
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);

  const group = document.createElement('p');
  group.id = 'professional-category-dialog-group';
  group.className = 'professional-category-dialog-group';
  const message = document.createElement('p');
  message.id = 'professional-category-dialog-message';
  message.className = 'professional-category-dialog-message';
  const note = document.createElement('p');
  note.className = 'professional-category-dialog-note';
  note.textContent = 'This label is chosen by the profile owner to describe their public professional identity.';

  card.append(header, group, message, note);
  dialog.append(card);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

function openProfessionalCategoryDialog() {
  const slug = document.getElementById('profile-professional-category')?.dataset.categorySlug || '';
  const category = professionalCategoryBySlug(slug) || professionalCategoryProfile?.category;
  if (!category) return;

  const dialog = ensureProfessionalCategoryDialog();
  document.getElementById('professional-category-dialog-title').textContent = category.label;
  document.getElementById('professional-category-dialog-group').textContent = category.group_name;
  document.getElementById('professional-category-dialog-message').textContent = category.description;

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function ensureProfessionalCategoryEditor() {
  const form = document.getElementById('profile-form');
  if (!form) return null;
  let editor = document.getElementById('professional-category-editor');
  if (editor) return editor;

  editor = document.createElement('section');
  editor.id = 'professional-category-editor';
  editor.className = 'professional-category-editor';
  editor.innerHTML = `
    <div class="professional-category-editor-heading">
      <div>
        <label for="professional-category-search">Professional category <span>Optional</span></label>
        <small>Choose one public title that best describes what you do.</small>
      </div>
      <button type="button" class="professional-category-clear" id="professional-category-clear" hidden>Remove</button>
    </div>
    <div class="professional-category-search-wrap">
      <div class="professional-category-search-shell">
        <span class="professional-category-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg></span>
        <input id="professional-category-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search professional categories" aria-autocomplete="list" aria-controls="professional-category-options" aria-expanded="false">
        <button class="professional-category-query-clear" id="professional-category-query-clear" type="button" aria-label="Clear category search" title="Clear search" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg></button>
      </div>
      <div class="professional-category-options" id="professional-category-options" role="listbox" hidden></div>
    </div>
    <p class="professional-category-editor-status" id="professional-category-editor-status" role="status" aria-live="polite"></p>
  `;
  form.insertBefore(editor, form.firstElementChild);

  const search = editor.querySelector('#professional-category-search');
  const options = editor.querySelector('#professional-category-options');
  const clear = editor.querySelector('#professional-category-clear');
  const queryClear = editor.querySelector('#professional-category-query-clear');

  const currentQuery = () => {
    const value = String(search.value || '');
    return value === String(search.dataset.selectedLabel || '') ? '' : value;
  };
  const showOptions = () => {
    const query = currentQuery();
    if (queryClear) queryClear.hidden = !String(query).trim();
    renderProfessionalCategoryOptions(query);
  };
  search.addEventListener('focus', showOptions);
  search.addEventListener('input', showOptions);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideProfessionalCategoryOptions();
  });
  clear.addEventListener('click', () => saveProfessionalCategory(null));
  queryClear?.addEventListener('click', () => {
    search.value = '';
    search.dataset.selectedLabel = '';
    queryClear.hidden = true;
    search.focus();
    renderProfessionalCategoryOptions('');
  });
  document.addEventListener('pointerdown', (event) => {
    if (!editor.contains(event.target)) hideProfessionalCategoryOptions();
  });
  options.addEventListener('click', (event) => {
    const button = event.target.closest('[data-professional-category-option]');
    if (button) saveProfessionalCategory(button.dataset.professionalCategoryOption || null);
  });

  return editor;
}

function hideProfessionalCategoryOptions() {
  const options = document.getElementById('professional-category-options');
  const search = document.getElementById('professional-category-search');
  if (options) options.hidden = true;
  if (search) search.setAttribute('aria-expanded', 'false');
}

function renderProfessionalCategoryOptions(query = '') {
  const options = document.getElementById('professional-category-options');
  const search = document.getElementById('professional-category-search');
  if (!options || !search || !professionalCategoryCatalog) return;

  const { matches, mode } = professionalCategorySearchMatches(query);
  options.replaceChildren();

  const heading = document.createElement('p');
  heading.className = 'professional-category-options-label';
  heading.textContent = mode === 'popular'
    ? 'Popular categories'
    : mode === 'closest'
      ? 'Closest matches'
      : 'Results';
  options.append(heading);

  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'professional-category-options-empty';
    empty.textContent = 'No close category found. Try a shorter word or another spelling.';
    options.append(empty);
  } else {
    for (const category of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'option';
      button.dataset.professionalCategoryOption = category.slug;
      button.innerHTML = '<strong></strong><small></small>';
      button.querySelector('strong').textContent = category.label;
      button.querySelector('small').textContent = mode === 'closest'
        ? `Suggested · ${category.group_name}`
        : category.group_name;
      options.append(button);
    }
  }

  options.hidden = false;
  search.setAttribute('aria-expanded', 'true');
}

function renderProfessionalCategoryEditor(category) {
  const editor = ensureProfessionalCategoryEditor();
  if (!editor) return;
  const search = editor.querySelector('#professional-category-search');
  const clear = editor.querySelector('#professional-category-clear');
  const queryClear = editor.querySelector('#professional-category-query-clear');
  const status = editor.querySelector('#professional-category-editor-status');
  if (search && document.activeElement !== search) {
    search.value = category?.label || '';
    search.dataset.selectedLabel = category?.label || '';
  }
  if (queryClear && document.activeElement !== search) queryClear.hidden = true;
  if (clear) clear.hidden = !category;
  if (status && !status.dataset.busy) {
    status.textContent = category ? `Shown publicly as ${category.label}.` : 'No professional category selected.';
  }
}

async function saveProfessionalCategory(slug) {
  const session = professionalCategorySession();
  const editor = ensureProfessionalCategoryEditor();
  const status = editor?.querySelector('#professional-category-editor-status');
  const search = editor?.querySelector('#professional-category-search');
  const clear = editor?.querySelector('#professional-category-clear');
  const queryClear = editor?.querySelector('#professional-category-query-clear');
  if (!session?.user?.id || !status) return;

  const category = slug ? professionalCategoryBySlug(slug) : null;
  if (slug && !category) return;

  status.dataset.busy = 'true';
  status.textContent = 'Saving category…';
  if (search) search.disabled = true;
  if (clear) clear.disabled = true;
  if (queryClear) queryClear.disabled = true;

  try {
    const response = await fetch(
      `${PROFESSIONAL_CATEGORY_SUPABASE_URL}/rest/v1/social_profiles?id=eq.${encodeURIComponent(session.user.id)}`,
      {
        method: 'PATCH',
        headers: {
          ...professionalCategoryHeaders({ authenticated: true, json: true }),
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ professional_category_slug: category?.slug || null }),
      },
    );
    if (!response.ok) throw new Error('Category could not be saved.');
    const rows = await response.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) throw new Error('Category could not be saved.');

    if (professionalCategoryProfile?.id === session.user.id) {
      professionalCategoryProfile.professional_category_slug = category?.slug || null;
      professionalCategoryProfile.category = category;
    }
    renderProfessionalCategoryButton(category);
    if (search) {
      search.value = category?.label || '';
      search.dataset.selectedLabel = category?.label || '';
    }
    if (queryClear) queryClear.hidden = true;
    if (clear) clear.hidden = !category;
    status.textContent = category ? `${category.label} saved.` : 'Professional category removed.';
    hideProfessionalCategoryOptions();
  } catch (error) {
    status.textContent = error?.message || 'Category could not be saved.';
  } finally {
    delete status.dataset.busy;
    if (search) search.disabled = false;
    if (clear) clear.disabled = false;
    if (queryClear) queryClear.disabled = false;
  }
}

async function syncProfessionalCategory() {
  window.clearTimeout(professionalCategorySyncTimer);
  const profileCard = document.getElementById('profile-card');
  const username = profileUsernameFromScreen();
  if (!profileCard || profileCard.hidden || !username) {
    renderProfessionalCategoryButton(null);
    return;
  }

  const requestId = ++professionalCategoryProfileRequest;
  try {
    const [catalog, profile] = await Promise.all([
      readProfessionalCategoryCatalog(),
      readProfileProfessionalCategory(username),
    ]);
    if (requestId !== professionalCategoryProfileRequest || profileUsernameFromScreen() !== username) return;

    const category = profile?.professional_category_slug
      ? catalog.find((item) => item.slug === profile.professional_category_slug) || null
      : null;
    professionalCategoryProfile = profile ? { ...profile, category } : null;
    renderProfessionalCategoryButton(category);

    const editor = document.getElementById('profile-editor');
    if (editor && !editor.hidden && profile?.id === professionalCategorySession()?.user?.id) {
      renderProfessionalCategoryEditor(category);
    }
  } catch {
    if (requestId === professionalCategoryProfileRequest) renderProfessionalCategoryButton(null);
  }
}

function scheduleProfessionalCategorySync() {
  window.clearTimeout(professionalCategorySyncTimer);
  professionalCategorySyncTimer = window.setTimeout(syncProfessionalCategory, 0);
}

function installProfessionalProfileCategory() {
  if (window.__sautilinkProfessionalProfileCategoryInstalled) return;
  window.__sautilinkProfessionalProfileCategoryInstalled = true;
  ensureProfessionalCategoryStylesheet();
  ensureProfessionalCategoryButton();
  ensureProfessionalCategoryDialog();

  const profileUsername = document.getElementById('profile-username');
  const profileCard = document.getElementById('profile-card');
  const profileEditor = document.getElementById('profile-editor');

  if (profileUsername) new MutationObserver(scheduleProfessionalCategorySync).observe(profileUsername, { childList: true, characterData: true, subtree: true });
  if (profileCard) new MutationObserver(scheduleProfessionalCategorySync).observe(profileCard, { attributes: true, attributeFilter: ['hidden'] });
  if (profileEditor) {
    new MutationObserver(async () => {
      if (profileEditor.hidden) return;
      try {
        await readProfessionalCategoryCatalog();
        if (professionalCategoryProfile?.id === professionalCategorySession()?.user?.id) {
          renderProfessionalCategoryEditor(professionalCategoryProfile.category || null);
        } else {
          scheduleProfessionalCategorySync();
        }
      } catch {
        // The existing profile editor remains fully usable if categories fail to load.
      }
    }).observe(profileEditor, { attributes: true, attributeFilter: ['hidden'] });
  }

  scheduleProfessionalCategorySync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installProfessionalProfileCategory, { once: true });
} else {
  installProfessionalProfileCategory();
}
