const PROFESSIONAL_CATEGORY_SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const PROFESSIONAL_CATEGORY_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const PROFESSIONAL_CATEGORY_AUTH_KEY = 'sautilink.auth.session';
const PROFESSIONAL_CATEGORY_STYLESHEET = '/app/assets/professional-profile-category.css';

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
      <input id="professional-category-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search categories" aria-autocomplete="list" aria-controls="professional-category-options" aria-expanded="false">
      <div class="professional-category-options" id="professional-category-options" role="listbox" hidden></div>
    </div>
    <p class="professional-category-editor-status" id="professional-category-editor-status" role="status" aria-live="polite"></p>
  `;
  form.insertBefore(editor, form.firstElementChild);

  const search = editor.querySelector('#professional-category-search');
  const options = editor.querySelector('#professional-category-options');
  const clear = editor.querySelector('#professional-category-clear');

  const showOptions = () => renderProfessionalCategoryOptions(search.value);
  search.addEventListener('focus', showOptions);
  search.addEventListener('input', showOptions);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideProfessionalCategoryOptions();
  });
  clear.addEventListener('click', () => saveProfessionalCategory(null));
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

  const normalized = String(query || '').trim().toLowerCase();
  const matches = professionalCategoryCatalog
    .filter((category) => !normalized
      || category.label.toLowerCase().includes(normalized)
      || category.group_name.toLowerCase().includes(normalized))
    .sort((a, b) => {
      if (!normalized) return a.sort_order - b.sort_order;
      const aStarts = a.label.toLowerCase().startsWith(normalized) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(normalized) ? 0 : 1;
      return aStarts - bStarts || a.label.localeCompare(b.label);
    })
    .slice(0, 14);

  options.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'professional-category-options-empty';
    empty.textContent = 'No matching category.';
    options.append(empty);
  } else {
    for (const category of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'option';
      button.dataset.professionalCategoryOption = category.slug;
      button.innerHTML = `<strong></strong><small></small>`;
      button.querySelector('strong').textContent = category.label;
      button.querySelector('small').textContent = category.group_name;
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
  const status = editor.querySelector('#professional-category-editor-status');
  if (search && document.activeElement !== search) search.value = category?.label || '';
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
  if (!session?.user?.id || !status) return;

  const category = slug ? professionalCategoryBySlug(slug) : null;
  if (slug && !category) return;

  status.dataset.busy = 'true';
  status.textContent = 'Saving category…';
  if (search) search.disabled = true;
  if (clear) clear.disabled = true;

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
    if (search) search.value = category?.label || '';
    if (clear) clear.hidden = !category;
    status.textContent = category ? `${category.label} saved.` : 'Professional category removed.';
    hideProfessionalCategoryOptions();
  } catch (error) {
    status.textContent = error?.message || 'Category could not be saved.';
  } finally {
    delete status.dataset.busy;
    if (search) search.disabled = false;
    if (clear) clear.disabled = false;
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
