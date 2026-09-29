const ROOMS_FACEBOOK_UI_CSS = '/app/assets/rooms-facebook.css?v=20260929-room-detail2';
const ROOMS_MOBILE_PREVIEW_CSS = '/app/assets/rooms-mobile-preview.css?v=20260914-mobile1';
let roomsFacebookTimer = 0;
let roomsFacebookFilter = 'discover';
let roomDetailMediaMode = 'discussion';
let roomDetailSlug = '';

function roomFbById(id) {
  return document.getElementById(id);
}

function roomFbVisible(node) {
  return Boolean(node && !node.hidden);
}

function roomFbIcon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = path;
  return svg;
}

function ensureRoomsFacebookStyles() {
  if (!document.querySelector(`link[href^="/app/assets/rooms-facebook.css"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ROOMS_FACEBOOK_UI_CSS;
    document.head.append(link);
  }
  if (!document.querySelector(`link[href^="/app/assets/rooms-mobile-preview.css"]`)) {
    const mobilePreview = document.createElement('link');
    mobilePreview.rel = 'stylesheet';
    mobilePreview.href = ROOMS_MOBILE_PREVIEW_CSS;
    document.head.append(mobilePreview);
  }
}

function roomFbSurfaceOpen() {
  const surface = roomFbById('circles-surface');
  return roomFbVisible(surface);
}

function roomFbDetailOpen() {
  return roomFbVisible(roomFbById('circle-detail'));
}

function syncRoomRouteFeedback() {
  const routeState = roomFbById('circle-route-state');
  const loading = roomFbById('circles-loading');
  const error = roomFbById('circles-error');
  if (!routeState || !loading || !error) return;

  // The old dedicated route card is intentionally never rendered. Deep Room
  // routes use the same lightweight loading/error states as the rest of the app.
  routeState.style.display = 'none';
  routeState.setAttribute('aria-hidden', 'true');

  const routeActive = !routeState.hidden;
  const state = routeActive ? String(routeState.dataset.state || '') : '';
  const loadingCopy = loading.querySelector('p');
  if (loadingCopy) loadingCopy.textContent = routeActive ? 'Loading Room…' : 'Loading Rooms…';

  const errorTitle = error.querySelector('h2');
  const errorCopy = error.querySelector('p');
  const retry = roomFbById('circles-retry');

  if (!routeActive) {
    if (error.dataset.roomRouteMode === 'true') {
      error.dataset.roomRouteMode = '';
      if (errorTitle) errorTitle.textContent = 'Rooms could not load.';
      if (errorCopy) errorCopy.textContent = 'Try again without losing your place.';
      if (retry) {
        retry.textContent = 'Try again';
        delete retry.dataset.roomRouteAction;
      }
    }
    return;
  }

  if (state === 'loading') {
    error.hidden = true;
    loading.hidden = Boolean(roomFbById('circle-detail')?.dataset.loading);
    return;
  }

  loading.hidden = true;
  error.hidden = false;
  error.dataset.roomRouteMode = 'true';

  if (state === 'unavailable') {
    if (errorTitle) errorTitle.textContent = 'Room unavailable';
    if (errorCopy) errorCopy.textContent = 'This Room does not exist, is private, or is unavailable to your account.';
    if (retry) {
      retry.textContent = 'Back to Rooms';
      retry.dataset.roomRouteAction = 'back';
    }
    return;
  }

  if (errorTitle) errorTitle.textContent = 'Room could not be opened';
  if (errorCopy) errorCopy.textContent = 'Something went wrong while loading this Room.';
  if (retry) {
    retry.textContent = 'Try again';
    retry.dataset.roomRouteAction = 'retry';
  }
}

function handleRoomRouteFeedbackAction(event) {
  const retry = event.target.closest?.('#circles-retry');
  const action = retry?.dataset.roomRouteAction || '';
  if (!action) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (action === 'back') {
    const routeHome = roomFbById('circle-route-home');
    routeHome?.click();
    return;
  }

  window.location.reload();
}

function ensureRoomLandingSidebar() {
  const surface = roomFbById('circles-surface');
  if (!surface) return null;
  let sidebar = roomFbById('room-fb-landing-sidebar');
  if (!sidebar) {
    sidebar = document.createElement('aside');
    sidebar.id = 'room-fb-landing-sidebar';
    sidebar.className = 'room-fb-landing-sidebar';
    sidebar.setAttribute('aria-label', 'Rooms navigation');

    const heading = document.createElement('div');
    heading.className = 'room-fb-sidebar-heading';
    const title = document.createElement('h2');
    title.textContent = 'Rooms';
    heading.append(title);

    const nav = document.createElement('nav');
    nav.className = 'room-fb-sidebar-nav';

    const discover = document.createElement('button');
    discover.type = 'button';
    discover.dataset.roomFbFilter = 'discover';
    discover.append(
      roomFbIcon('<path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Z"></path><path d="m14.8 9.2-2 5.6-5.6 2 2-5.6 5.6-2Z"></path>'),
      document.createTextNode('Discover'),
    );

    const joined = document.createElement('button');
    joined.type = 'button';
    joined.dataset.roomFbFilter = 'joined';
    joined.append(
      roomFbIcon('<circle cx="9" cy="9" r="3"></circle><circle cx="17" cy="10" r="2.5"></circle><path d="M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6M14 15c3.4-.7 5.5.9 6 4"></path>'),
      document.createTextNode('Your Rooms'),
    );

    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'room-fb-create-shortcut';
    create.append(
      roomFbIcon('<path d="M12 5v14M5 12h14"></path>'),
      document.createTextNode('Create new Room'),
    );
    create.addEventListener('click', () => roomFbById('circles-create-toggle')?.click());

    nav.append(discover, joined, create);
    sidebar.append(heading, nav);
    surface.prepend(sidebar);

    sidebar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-room-fb-filter]');
      if (!button) return;
      roomsFacebookFilter = button.dataset.roomFbFilter || 'discover';
      syncRoomLandingFilter();
    });
  }

  const controls = roomFbById('room-discovery-controls');
  if (controls && controls.parentElement !== sidebar) {
    sidebar.querySelector('.room-fb-sidebar-heading')?.insertAdjacentElement('afterend', controls);
  }
  return sidebar;
}

function syncRoomLandingFilter() {
  const sidebar = roomFbById('room-fb-landing-sidebar');
  sidebar?.querySelectorAll('[data-room-fb-filter]').forEach((button) => {
    const active = button.dataset.roomFbFilter === roomsFacebookFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });

  document.querySelectorAll('#circles-list .circle-card').forEach((card) => {
    if (roomsFacebookFilter !== 'joined') return;
    const state = String(card.querySelector('.circle-card-state')?.textContent || '').toLowerCase();
    if (!/(owner|joined|member|requested)/.test(state)) card.hidden = true;
  });
}

function createRoomDetailTabs() {
  const tabs = document.createElement('nav');
  tabs.id = 'room-fb-detail-tabs';
  tabs.className = 'room-fb-detail-tabs';
  tabs.setAttribute('aria-label', 'Room sections');

  const items = [
    ['discussion', 'Posts'],
    ['photos', 'Photos'],
    ['videos', 'Videos'],
    ['about', 'About'],
    ['people', 'Members'],
  ];
  items.forEach(([key, label], index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.roomFbTab = key;
    button.textContent = label;
    button.classList.toggle('active', index === 0);
    tabs.append(button);
  });

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-room-fb-tab]');
    if (!button) return;
    const key = button.dataset.roomFbTab;
    let target = null;
    if (['discussion', 'photos', 'videos'].includes(key)) {
      roomDetailMediaMode = key;
      syncRoomDetailFeedFilter();
      target = roomFbById('circle-stream');
    }
    if (key === 'about') target = roomFbById('room-fb-about-card');
    if (key === 'people') {
      const memberList = roomFbById('circle-members');
      target = memberList && !memberList.hidden ? memberList
        : roomFbById('room-fb-about-card')?.querySelector('[data-room-fb-members]');
    }
    tabs.querySelectorAll('[data-room-fb-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return tabs;
}

function syncRoomDetailFeedFilter() {
  const feed = roomFbById('circle-stream-feed');
  const stream = roomFbById('circle-stream');
  const status = roomFbById('room-detail-filter-empty');
  if (!feed || !stream || !status) return;
  const search = String(roomFbById('room-detail-search-input')?.value || '').trim().toLocaleLowerCase();
  const cards = [...feed.children];
  let matched = 0;
  cards.forEach((card) => {
    const media = roomDetailMediaMode === 'photos' ? 'img' : 'video';
    const hasMedia = roomDetailMediaMode === 'discussion' || Boolean(card.querySelector(`.sauti-media-gallery ${media}`));
    const matches = hasMedia && (!search || String(card.textContent || '').toLocaleLowerCase().includes(search));
    if (card.hidden === matches) card.hidden = !matches;
    if (matches) matched += 1;
  });
  const filtering = roomDetailMediaMode !== 'discussion' || Boolean(search);
  const ready = !stream.hidden && Boolean(roomFbById('circle-stream-loading')?.hidden);
  const unavailable = !roomFbById('circle-stream-locked')?.hidden || !roomFbById('circle-stream-error')?.hidden;
  const mediaPending = roomDetailMediaMode !== 'discussion'
    && cards.some((card) => card.querySelector('.sauti-media-gallery.loading'));
  const showEmpty = filtering && ready && !unavailable && !mediaPending && matched === 0;
  if (status.hidden === showEmpty) status.hidden = !showEmpty;
  if (showEmpty) status.textContent = search
    ? 'No matching posts among the recent Room posts loaded here.'
    : `No ${roomDetailMediaMode === 'photos' ? 'photos' : 'videos'} among the recent Room posts loaded here.`;
  const originalEmpty = roomFbById('circle-stream-empty');
  if (originalEmpty && filtering && !originalEmpty.hidden) originalEmpty.hidden = true;
  if (originalEmpty && !filtering && originalEmpty.hidden && ready && !unavailable && cards.length === 0) originalEmpty.hidden = false;
}

function ensureRoomDetailToolbar(detail, card) {
  let toolbar = roomFbById('room-detail-toolbar');
  if (toolbar) return;
  toolbar = document.createElement('div');
  toolbar.id = 'room-detail-toolbar';
  toolbar.className = 'room-detail-toolbar';
  toolbar.setAttribute('aria-label', 'Room controls');
  const back = roomFbById('circle-back');
  back.textContent = 'Back to Rooms';
  toolbar.append(back);

  const searchButton = document.createElement('button');
  searchButton.type = 'button';
  searchButton.className = 'room-detail-icon-button';
  searchButton.setAttribute('aria-label', 'Search recent Room posts');
  searchButton.setAttribute('aria-controls', 'room-detail-search');
  searchButton.setAttribute('aria-expanded', 'false');
  searchButton.append(roomFbIcon('<circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m15.5 15.5 5 5"></path>'));

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'room-detail-icon-button';
  menuButton.setAttribute('aria-label', 'Room options');
  menuButton.setAttribute('aria-controls', 'room-detail-menu');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.append(roomFbIcon('<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>'));
  toolbar.append(searchButton, menuButton);

  const search = document.createElement('div');
  search.id = 'room-detail-search';
  search.className = 'room-detail-search';
  search.hidden = true;
  const input = document.createElement('input');
  input.id = 'room-detail-search-input';
  input.type = 'search';
  input.placeholder = 'Search recent Room posts';
  input.setAttribute('aria-label', 'Search recent Room posts');
  input.addEventListener('input', syncRoomDetailFeedFilter);
  search.append(input);

  const menu = document.createElement('div');
  menu.id = 'room-detail-menu';
  menu.className = 'room-detail-menu';
  menu.hidden = true;
  [['share', 'Share Room'], ['invite', 'Invite members']].forEach(([key, label]) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.dataset.roomDetailOption = key;
    option.textContent = label;
    option.addEventListener('click', () => {
      menu.hidden = true;
      menuButton.setAttribute('aria-expanded', 'false');
      roomFbById('circle-detail')?.querySelector(`[data-room-fb-${key}]`)?.click();
    });
    menu.append(option);
  });
  searchButton.addEventListener('click', () => {
    search.hidden = !search.hidden;
    searchButton.setAttribute('aria-expanded', String(!search.hidden));
    if (!search.hidden) input.focus();
    else { input.value = ''; syncRoomDetailFeedFilter(); }
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  });
  menuButton.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    menuButton.setAttribute('aria-expanded', String(!menu.hidden));
  });
  detail.insertBefore(toolbar, card);
  detail.insertBefore(search, card);
  detail.insertBefore(menu, card);

  const empty = document.createElement('p');
  empty.id = 'room-detail-filter-empty';
  empty.className = 'room-detail-filter-empty';
  empty.setAttribute('role', 'status');
  empty.hidden = true;
  roomFbById('circle-stream-feed')?.insertAdjacentElement('afterend', empty);
}

function roomFbPrivacyCopy() {
  const badgeText = String(roomFbById('circle-detail-policy')?.textContent || 'Room').trim();
  const privateRoom = /private|invite/i.test(badgeText);
  return privateRoom
    ? ['Private', 'Only members can see who is in the Room and what they post.']
    : ['Public', 'Anyone can find this Room and see its public information.'];
}

function ensureRoomAboutCard() {
  let card = roomFbById('room-fb-about-card');
  if (!card) {
    card = document.createElement('section');
    card.id = 'room-fb-about-card';
    card.className = 'room-fb-about-card';
    const title = document.createElement('h3');
    title.textContent = 'About';
    const description = document.createElement('p');
    description.dataset.roomFbAboutDescription = 'true';
    const privacy = document.createElement('div');
    privacy.className = 'room-fb-about-row';
    privacy.dataset.roomFbPrivacy = 'true';
    const members = document.createElement('div');
    members.className = 'room-fb-about-row';
    members.dataset.roomFbMembers = 'true';
    card.append(title, description, privacy, members);
  }

  const description = String(roomFbById('circle-detail-description')?.textContent || '').trim();
  const aboutDescription = card.querySelector('[data-room-fb-about-description]');
  if (aboutDescription) aboutDescription.textContent = description || 'No description yet.';

  const privacy = card.querySelector('[data-room-fb-privacy]');
  if (privacy) {
    const [label, copy] = roomFbPrivacyCopy();
    privacy.replaceChildren(
      roomFbIcon('<path d="M12 3a7 7 0 0 0-7 7v3H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-1v-3a7 7 0 0 0-7-7Zm-4 10v-3a4 4 0 0 1 8 0v3"></path>'),
    );
    const copyNode = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = label;
    const small = document.createElement('small');
    small.textContent = copy;
    copyNode.append(strong, small);
    privacy.append(copyNode);
  }

  const members = card.querySelector('[data-room-fb-members]');
  if (members) {
    const count = String(document.querySelector('#circle-detail .room-detail-badges span:last-child')?.textContent || '').trim();
    const membership = String(roomFbById('circle-detail-membership')?.textContent || '').trim();
    members.replaceChildren(
      roomFbIcon('<circle cx="9" cy="9" r="3"></circle><circle cx="17" cy="10" r="2.5"></circle><path d="M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6M14 15c3.4-.7 5.5.9 6 4"></path>'),
    );
    const copyNode = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = 'Members';
    const small = document.createElement('small');
    small.textContent = [count, membership].filter(Boolean).join(' · ') || 'Room membership';
    copyNode.append(strong, small);
    members.append(copyNode);
  }
  return card;
}

function ensureRoomDetailActions() {
  const actions = document.querySelector('#circle-detail .circle-detail-actions');
  if (!actions) return;
  if (!actions.querySelector('[data-room-fb-share]')) {
    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'secondary-action room-fb-share';
    share.dataset.roomFbShare = 'true';
    share.append(
      roomFbIcon('<circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="m8.2 10.9 7.5-4.5M8.2 13.1l7.5 4.5"></path>'),
      document.createTextNode('Share'),
    );
    share.addEventListener('click', async () => {
      const url = location.href;
      const title = String(roomFbById('circle-detail-name')?.textContent || 'SautiLink Room');
      try {
        if (navigator.share) await navigator.share({ title, url });
        else {
          await navigator.clipboard.writeText(url);
          roomFbById('toast')?.removeAttribute('hidden');
          if (roomFbById('toast')) roomFbById('toast').textContent = 'Room link copied.';
        }
      } catch {
        // Cancelling a native share sheet should not surface an error.
      }
    });
    actions.append(share);
  }

  let invite = actions.querySelector('[data-room-fb-invite]');
  if (!invite) {
    invite = document.createElement('button');
    invite.type = 'button';
    invite.className = 'secondary-action room-fb-invite';
    invite.dataset.roomFbInvite = 'true';
    invite.append(
      roomFbIcon('<circle cx="9" cy="8" r="3"></circle><path d="M3.5 19c.4-3.8 2.2-5.7 5.5-5.7 1.2 0 2.2.2 3 .7M17 8v6M14 11h6"></path>'),
      document.createTextNode('Invite'),
    );
    invite.addEventListener('click', () => roomFbById('room-invite-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    actions.append(invite);
  }
  invite.hidden = !roomFbById('room-invite-panel');
}

function ensureRoomFacebookAside() {
  const detail = roomFbById('circle-detail');
  if (!detail) return null;
  let aside = roomFbById('room-fb-detail-aside');
  if (!aside) {
    aside = document.createElement('aside');
    aside.id = 'room-fb-detail-aside';
    aside.className = 'room-fb-detail-aside';
    aside.setAttribute('aria-label', 'Room information and management');
    detail.append(aside);
  }

  const about = ensureRoomAboutCard();
  if (about.parentElement !== aside) aside.prepend(about);

  [
    roomFbById('room-invite-panel'),
    roomFbById('room-admin-panel'),
    roomFbById('circle-members'),
    roomFbById('circle-requests'),
  ].forEach((node) => {
    if (node && node.parentElement !== aside) aside.append(node);
  });
  return aside;
}

function ensureRoomDetailLayout() {
  const detail = roomFbById('circle-detail');
  const card = detail?.querySelector('.circle-detail-card');
  if (!detail || !card) return;
  detail.classList.add('room-fb-detail');
  ensureRoomDetailToolbar(detail, card);

  const slug = String(roomFbById('circle-detail-slug')?.textContent || '');
  if (roomDetailSlug !== slug) {
    roomDetailSlug = slug;
    roomDetailMediaMode = 'discussion';
    const input = roomFbById('room-detail-search-input');
    if (input) input.value = '';
    const search = roomFbById('room-detail-search');
    if (search) search.hidden = true;
    const menu = roomFbById('room-detail-menu');
    if (menu) menu.hidden = true;
    roomFbById('room-detail-toolbar')?.querySelectorAll('[aria-expanded]')
      .forEach((button) => button.setAttribute('aria-expanded', 'false'));
    roomFbById('room-fb-detail-tabs')?.querySelectorAll('[data-room-fb-tab]')
      .forEach((tab) => tab.classList.toggle('active', tab.dataset.roomFbTab === 'discussion'));
  }

  let tabs = roomFbById('room-fb-detail-tabs');
  if (!tabs) {
    tabs = createRoomDetailTabs();
    card.insertAdjacentElement('afterend', tabs);
  }
  ensureRoomDetailActions();
  ensureRoomFacebookAside();
  const inviteOption = detail.querySelector('[data-room-detail-option="invite"]');
  if (inviteOption) inviteOption.hidden = !detail.querySelector('[data-room-fb-invite]:not([hidden])');
  syncRoomDetailFeedFilter();

  const primary = roomFbById('circle-primary-action');
  if (primary) {
    const text = String(primary.textContent || '').toLowerCase();
    primary.classList.toggle('room-fb-secondary-primary', /leave|requested|cancel/.test(text));
  }
}

function syncRoomFacebookShell() {
  const surface = roomFbById('circles-surface');
  if (!surface) return;
  const visible = roomFbSurfaceOpen();
  document.body.classList.toggle('rooms-facebook-view', visible);
  surface.classList.toggle('room-fb-detail-open', roomFbDetailOpen());
  if (!visible) return;

  const sidebar = ensureRoomLandingSidebar();
  if (sidebar) sidebar.hidden = roomFbDetailOpen();
  syncRoomLandingFilter();
  if (roomFbDetailOpen()) ensureRoomDetailLayout();
}

function scheduleRoomsFacebookUi() {
  window.clearTimeout(roomsFacebookTimer);
  roomsFacebookTimer = window.setTimeout(syncRoomFacebookShell, 90);
}

ensureRoomsFacebookStyles();
syncRoomRouteFeedback();
document.addEventListener('click', handleRoomRouteFeedbackAction, true);
const roomsFacebookObserver = new MutationObserver(() => {
  syncRoomRouteFeedback();
  scheduleRoomsFacebookUi();
});
roomsFacebookObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['hidden', 'class', 'data-state'],
});
window.addEventListener('popstate', () => {
  syncRoomRouteFeedback();
  scheduleRoomsFacebookUi();
});
window.addEventListener('resize', scheduleRoomsFacebookUi);
scheduleRoomsFacebookUi();
