const ROOMS_FACEBOOK_UI_CSS = '/app/assets/rooms-chat.css?v=20261117-chat2';
let roomsFacebookTimer = 0;
let roomsFacebookFilter = 'joined';
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

function roomFbNamedIcon(iconName, path) {
  const svg = roomFbIcon(path);
  svg.dataset.slIconName = iconName;
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('focusable', 'false');
  return svg;
}

function ensureRoomsFacebookStyles() {
  if (!document.querySelector(`link[href^="/app/assets/rooms-chat.css"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ROOMS_FACEBOOK_UI_CSS;
    document.head.append(link);
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
  const loadingCopy = loading.querySelector('.sr-only');
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
    const siteMenu = document.createElement('button');
    siteMenu.type = 'button';
    siteMenu.className = 'room-chat-site-menu';
    siteMenu.setAttribute('aria-label', 'SautiLink menu');
    siteMenu.setAttribute('aria-expanded', 'false');
    siteMenu.append(roomFbIcon('<path d="M4 6h16M4 12h16M4 18h16"/>'));
    siteMenu.addEventListener('click', () => {
      const open = document.body.classList.toggle('rooms-site-menu-open');
      siteMenu.setAttribute('aria-expanded', String(open));
    });
    heading.append(siteMenu);
    heading.append(title);
    const rail = document.querySelector('.primary-rail');
    if (rail && !rail.querySelector('.room-chat-site-close')) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'room-chat-site-close';
      close.textContent = 'Close menu';
      const closeMenu = () => {
        document.body.classList.remove('rooms-site-menu-open');
        siteMenu.setAttribute('aria-expanded', 'false');
      };
      close.addEventListener('click', () => { closeMenu(); siteMenu.focus(); });
      rail.prepend(close);
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.body.classList.contains('rooms-site-menu-open')) { closeMenu(); siteMenu.focus(); }
      });
      document.addEventListener('click', event => {
        if (!rail.contains(event.target) && !siteMenu.contains(event.target)) closeMenu();
      });
      rail.addEventListener('click', event => { if (event.target.closest('[data-member-view], a')) closeMenu(); });
    }

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
      document.createTextNode('New'),
    );
    create.setAttribute('aria-label', 'Create Room');
    create.addEventListener('click', () => roomFbById('circles-create-toggle')?.click());

    const empty = document.createElement('p');
    empty.id = 'room-directory-empty';
    empty.className = 'room-directory-empty';
    empty.setAttribute('role', 'status');
    empty.hidden = true;
    heading.append(create);
    nav.append(joined, discover);
    sidebar.append(heading, nav, roomFbById('circles-list'), empty);
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

  const query = String(roomFbById('room-search')?.value || '').trim().toLowerCase();
  const category = String(roomFbById('room-category-filter')?.value || 'all');
  const activeSlug = roomFbDetailOpen() ? String(roomFbById('circle-detail-slug')?.textContent || '').split('/').at(-1) : '';
  let visibleCount = 0;
  document.querySelectorAll('#circles-list .circle-card').forEach((card) => {
    const avatar = card.querySelector('.room-card-cover');
    if (avatar && !avatar.querySelector('img') && !avatar.textContent.trim()) avatar.textContent = (card.querySelector('h3')?.textContent || 'R').trim().slice(0, 1).toUpperCase();
    const state = String(card.querySelector('.circle-card-state')?.textContent || '').toLowerCase();
    const membership = roomsFacebookFilter !== 'joined' || /(owner|joined|member|requested)/.test(state);
    const matchesQuery = !query || String(card.dataset.roomSearch || card.textContent).toLowerCase().includes(query);
    const matchesCategory = category === 'all' || card.dataset.roomCategory === category;
    const current = Boolean(activeSlug) && card.dataset.circleSlug === activeSlug;
    if (current && !card.hasAttribute('aria-current')) card.setAttribute('aria-current', 'page');
    if (!current && card.hasAttribute('aria-current')) card.removeAttribute('aria-current');
    const hidden = !((membership || current) && matchesQuery && matchesCategory);
    if (card.hidden !== hidden) card.hidden = hidden;
    if (!hidden) visibleCount += 1;
  });
  const empty = roomFbById('room-directory-empty');
  if (empty) {
    const copy = query || category !== 'all' ? 'No matching Rooms.'
      : roomsFacebookFilter === 'joined' ? 'Your Rooms will appear here. Use Discover to find one.' : 'No Rooms to show yet.';
    if (empty.textContent !== copy) empty.textContent = copy;
    const hideEmpty = visibleCount > 0 || Boolean(roomFbById('circles-list')?.hidden);
    if (empty.hidden !== hideEmpty) empty.hidden = hideEmpty;
  }
}

function selectRoomDetailSection(tabs, key) {
  tabs.querySelectorAll('[data-room-fb-tab]').forEach((button) => {
    const selected = button.dataset.roomFbTab === key;
    button.classList.toggle('active', selected);
    if (button.getAttribute('aria-pressed') !== String(selected)) {
      button.setAttribute('aria-pressed', String(selected));
    }
  });
}

function createRoomDetailTabs() {
  const tabs = document.createElement('nav');
  tabs.id = 'room-fb-detail-tabs';
  tabs.className = 'room-fb-detail-tabs';
  tabs.setAttribute('aria-label', 'Room sections');

  const items = [
    ['discussion', 'All messages'],
    ['photos', 'Photos'],
    ['videos', 'Videos'],
  ];
  const icons = {
    discussion: ['file-0-1', '<path d="M6 3h9l3 3v15H6Z"></path><path d="M14 3v5h4M9 12h6M9 16h4"></path>'],
    photos: ['image-0-1', '<rect x="3" y="3" width="18" height="18" rx="3"></rect><circle cx="8" cy="8" r="2"></circle><path d="m3 17 5-5 4 4 4-6 5 7"></path>'],
    videos: ['video-0-1', '<rect x="3" y="5" width="13" height="14" rx="3"></rect><path d="m16 10 5-3v10l-5-3"></path>'],
    about: ['help-circle', '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v6M12 7h.01"></path>'],
    people: ['user-group', '<circle cx="9" cy="9" r="3"></circle><circle cx="17" cy="10" r="2.5"></circle><path d="M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6M14 15c3.4-.7 5.5.9 6 4"></path>'],
  };
  items.forEach(([key, label], index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.roomFbTab = key;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(index === 0));
    button.title = label;
    const caption = document.createElement('span');
    caption.dataset.roomTabLabel = 'true';
    caption.textContent = label;
    const [iconName, paths] = icons[key];
    button.append(roomFbNamedIcon(iconName, paths), caption);
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
    }
    if (key === 'about') target = roomFbById('room-fb-about-card');
    if (key === 'people') {
      const memberList = roomFbById('circle-members');
      target = memberList && !memberList.hidden ? memberList
        : roomFbById('room-fb-about-card')?.querySelector('[data-room-fb-members]');
    }
    selectRoomDetailSection(tabs, key);
    if (key === 'about' || key === 'people') setRoomInfoVisible(true);
    if (target) target.scrollIntoView({ block: 'nearest' });
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
    if (!card.matches('.sauti-card')) return;
    const media = roomDetailMediaMode === 'photos' ? 'img' : 'video, [data-media-kind="video"]';
    const hasMedia = roomDetailMediaMode === 'discussion' || Boolean(card.querySelector('.sauti-media-gallery')?.querySelector(media));
    const matches = hasMedia && (!search || String(card.textContent || '').toLocaleLowerCase().includes(search));
    if (card.hidden === matches) card.hidden = !matches;
    if (matches) matched += 1;
  });
  const filtering = roomDetailMediaMode !== 'discussion' || Boolean(search);
  feed.querySelectorAll('.room-chat-date').forEach((date) => { if (date.hidden !== filtering) date.hidden = filtering; });
  const reset = roomFbById('room-chat-filter-reset');
  if (reset) reset.hidden = !filtering;
  const ready = !stream.hidden && Boolean(roomFbById('circle-stream-loading')?.hidden);
  const unavailable = !roomFbById('circle-stream-locked')?.hidden || !roomFbById('circle-stream-error')?.hidden;
  const mediaPending = roomDetailMediaMode !== 'discussion'
    && cards.some((card) => card.querySelector('.sauti-media-gallery.loading'));
  const showEmpty = filtering && ready && !unavailable && !mediaPending && matched === 0;
  if (status.hidden === showEmpty) status.hidden = !showEmpty;
  if (showEmpty) status.textContent = search
    ? 'No matching messages in the loaded history.'
    : `No ${roomDetailMediaMode === 'photos' ? 'photos' : 'videos'} in the loaded history.`;
  const originalEmpty = roomFbById('circle-stream-empty');
  if (originalEmpty && filtering && !originalEmpty.hidden) originalEmpty.hidden = true;
  if (originalEmpty && !filtering && originalEmpty.hidden && ready && !unavailable && matched === 0) originalEmpty.hidden = false;
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
  back.setAttribute('aria-label', 'Back to Rooms');
  back.title = 'Back to Rooms';
  const backCaption = document.createElement('span');
  backCaption.className = 'sr-only';
  backCaption.textContent = 'Back to Rooms';
  back.replaceChildren(
    roomFbNamedIcon('arrow-left-0-2', '<path d="M19 12H5M11 6l-6 6 6 6"></path>'),
    backCaption,
  );
  const title = document.createElement('h2');
  title.className = 'room-detail-toolbar-title';
  title.textContent = 'Room';
  const meta = document.createElement('span');
  meta.className = 'room-detail-toolbar-meta';
  const heading = document.createElement('div');
  heading.className = 'room-chat-heading';
  heading.append(title, meta);
  heading.setAttribute('role', 'button');
  heading.setAttribute('tabindex', '0');
  heading.setAttribute('aria-label', 'Open group information');
  heading.addEventListener('click', () => openRoomInfoView('overview'));
  heading.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRoomInfoView('overview'); }
  });
  const roomAvatar = document.createElement('span');
  roomAvatar.className = 'room-chat-avatar';
  roomAvatar.setAttribute('aria-hidden', 'true');
  heading.prepend(roomAvatar);
  toolbar.append(back, heading);

  const searchButton = document.createElement('button');
  searchButton.type = 'button';
  searchButton.className = 'room-detail-icon-button';
  searchButton.setAttribute('aria-label', 'Search messages');
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
  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'room-detail-icon-button room-info-toggle';
  info.setAttribute('aria-label', 'Room information');
  info.setAttribute('aria-controls', 'room-fb-detail-aside');
  info.append(roomFbIcon('<circle cx="12" cy="12" r="9"></circle><path d="M12 11v6M12 7h.01"></path>'));
  info.addEventListener('click', () => setRoomInfoVisible(info.getAttribute('aria-expanded') !== 'true'));
  toolbar.append(searchButton, menuButton, info);

  const search = document.createElement('div');
  search.id = 'room-detail-search';
  search.className = 'room-detail-search';
  search.hidden = true;
  const input = document.createElement('input');
  input.id = 'room-detail-search-input';
  input.type = 'search';
  input.placeholder = 'Search messages';
  input.setAttribute('aria-label', 'Search messages');
  input.addEventListener('input', syncRoomDetailFeedFilter);
  search.append(input);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.id = 'room-chat-filter-reset';
  reset.textContent = 'Show all messages';
  reset.hidden = true;
  reset.addEventListener('click', () => {
    roomDetailMediaMode = 'discussion';
    input.value = '';
    syncRoomDetailFeedFilter();
    const tabs = roomFbById('room-fb-detail-tabs');
    if (tabs) selectRoomDetailSection(tabs, 'discussion');
  });
  toolbar.append(reset);

  const menu = document.createElement('div');
  menu.id = 'room-detail-menu';
  menu.className = 'room-detail-menu';
  menu.hidden = true;
  [
    ['info', 'Group info', 'M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
    ['edit', 'Edit group', 'm4 20 4-1 11-11-3-3L5 16l-1 4Zm9-13 3 3'],
    ['share', 'Share Room', 'M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7'],
    ['invite', 'Invite members', 'M16 13h6m-3-3v6M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2'],
  ].forEach(([key, label, path]) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.dataset.roomDetailOption = key;
    option.append(roomFbIcon(`<path d="${path}"/>`), document.createTextNode(label));
    option.addEventListener('click', () => {
      menu.hidden = true;
      menuButton.setAttribute('aria-expanded', 'false');
      if (key === 'info' || key === 'edit' || key === 'invite') openRoomInfoView(key === 'info' ? 'overview' : key);
      else roomFbById('circle-detail')?.querySelector(`[data-room-fb-${key}]`)?.click();
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
  detail.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!menu.hidden) {
      menu.hidden = true;
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.focus();
    } else if (!search.hidden) searchButton.click();
    else if (detail.classList.contains('room-info-open')) { setRoomInfoVisible(false); info.focus(); }
  });
  document.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !menuButton.contains(event.target)) {
      menu.hidden = true;
      menuButton.setAttribute('aria-expanded', 'false');
    }
  });
  detail.insertBefore(toolbar, card);
  detail.insertBefore(search, card);
  detail.insertBefore(menu, card);
  setRoomInfoVisible(false);

  const empty = document.createElement('p');
  empty.id = 'room-detail-filter-empty';
  empty.className = 'room-detail-filter-empty';
  empty.setAttribute('role', 'status');
  empty.hidden = true;
  roomFbById('circle-stream-feed')?.insertAdjacentElement('afterend', empty);
}

function setRoomInfoVisible(visible) {
  const detail = roomFbById('circle-detail');
  if (!detail) return;
  detail.classList.toggle('room-info-open', visible);
  detail.querySelector('.room-info-toggle')?.setAttribute('aria-expanded', String(visible));
}

function openRoomInfoView(view) {
  const aside = roomFbById('room-fb-detail-aside');
  if (!aside) return;
  aside.dataset.view = view;
  const title = aside.querySelector('.room-chat-info-title');
  const copy = { overview: 'Group info', edit: 'Edit group', members: 'Members', invite: 'Invite members' }[view] || 'Group info';
  if (title && title.textContent !== copy) title.textContent = copy;
  const settings = aside.querySelector('.room-chat-settings');
  if (settings) settings.open = view === 'edit';
  setRoomInfoVisible(true);
  aside.scrollTop = 0;
}

function enhanceRoomChatControls() {
  const aside = roomFbById('room-fb-detail-aside');
  if (aside && !aside.querySelector('.room-chat-info-header')) {
    aside.dataset.view = 'overview';
    const header = document.createElement('header');
    header.className = 'room-chat-info-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.setAttribute('aria-label', 'Back to group info');
    back.append(roomFbIcon('<path d="M19 12H5m6-6-6 6 6 6"/>'));
    back.addEventListener('click', () => openRoomInfoView('overview'));
    const title = document.createElement('h3');
    title.className = 'room-chat-info-title';
    title.textContent = 'Group info';
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close group info');
    close.append(roomFbIcon('<path d="m6 6 12 12M18 6 6 18"/>'));
    close.addEventListener('click', () => {
      setRoomInfoVisible(false);
      roomFbById('room-detail-toolbar')?.querySelector('.room-info-toggle')?.focus();
    });
    const save = document.createElement('button');
    save.type = 'submit';
    save.setAttribute('form', 'room-edit-settings-form');
    save.setAttribute('aria-label', 'Save Room settings');
    save.className = 'room-info-save';
    save.textContent = 'Save';
    save.hidden = true;
    header.append(back, title, save, close);
    const navigation = document.createElement('nav');
    navigation.className = 'room-chat-info-nav';
    for (const [view, label, icon] of [
      ['edit', 'Edit group', '<path d="m4 20 4-1 11-11-3-3L5 16l-1 4Zm9-13 3 3"/>'],
      ['members', 'Members & requests', '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 5a3 3 0 0 1 0 6m5 9v-2a4 4 0 0 0-3-4"/>'],
      ['invite', 'Invite members', '<path d="M16 13h6m-3-3v6M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/><circle cx="9" cy="7" r="4"/>'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.roomInfoView = view;
      button.append(roomFbIcon(icon), document.createTextNode(label));
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => openRoomInfoView(view));
      navigation.append(button);
    }
    aside.prepend(header);
    aside.append(navigation);
  }
  if (aside) {
    const canEdit = Boolean(aside.querySelector('.room-chat-settings'));
    const canInvite = Boolean(roomFbById('room-invite-panel'));
    const settings = aside.querySelector('.room-chat-settings');
    if (settings) settings.open = aside.dataset.view === 'edit';
    aside.querySelector('.room-info-save').hidden = !settings?.open;
    const avatar = aside.querySelector('.room-detail-cover > span');
    const initial = (roomFbById('circle-detail-name')?.textContent || 'R').trim().slice(0, 1).toUpperCase();
    if (avatar && avatar.textContent !== initial) avatar.textContent = initial;
    aside.querySelector('[data-room-info-view="edit"]').hidden = !canEdit;
    aside.querySelector('[data-room-info-view="invite"]').hidden = !canInvite;
    const editOption = roomFbById('room-detail-menu')?.querySelector('[data-room-detail-option="edit"]');
    if (editOption) editOption.hidden = !canEdit;
    if ((aside.dataset.view === 'edit' && !canEdit) || (aside.dataset.view === 'invite' && !canInvite)) openRoomInfoView('overview');
    const tabs = roomFbById('room-fb-detail-tabs');
    if (tabs && tabs.parentElement !== aside) aside.append(tabs);
  }

  const composer = roomFbById('circle-sauti-composer');
  if (composer && !composer.dataset.chatControlsReady) {
    composer.dataset.chatControlsReady = 'true';
    const submit = roomFbById('circle-sauti-submit');
    submit.setAttribute('aria-label', 'Send message');
    submit.title = 'Send message';
    const drawSend = () => {
      if (submit.getAttribute('aria-busy') === 'true' || submit.querySelector('svg')) return;
      const sendCaption = document.createElement('span');
      sendCaption.className = 'sr-only';
      sendCaption.textContent = 'Send';
      submit.replaceChildren(roomFbIcon('<path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15"/>'), sendCaption);
    };
    drawSend();
    new MutationObserver(drawSend).observe(submit, { childList: true, attributes: true, attributeFilter: ['aria-busy'] });
    const textarea = roomFbById('circle-sauti-body');
    textarea.setAttribute('aria-label', 'Message');
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        if (!submit.disabled) composer.requestSubmit(submit);
      }
    });
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
    });
    const viewport = window.visualViewport;
    const fitKeyboard = () => {
      const surface = roomFbById('circles-surface');
      if (viewport?.scale === 1 && viewport.height < window.innerHeight && window.matchMedia('(max-width: 760px)').matches) {
        surface?.style.setProperty('--room-viewport-height', `${Math.round(viewport.height)}px`);
      } else {
        surface?.style.removeProperty('--room-viewport-height');
      }
    };
    viewport?.addEventListener('resize', fitKeyboard);
    fitKeyboard();
  }
  const feed = roomFbById('circle-stream-feed');
  feed?.querySelectorAll(':scope > .sauti-card').forEach((card) => {
    if (card.querySelector('.room-chat-message-menu')) return;
    const footer = card.querySelector('.sauti-card-footer');
    const meta = card.querySelector('.sauti-card-meta');
    if (!footer) return;
    const menu = document.createElement('details');
    menu.className = 'room-chat-message-menu';
    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', 'Message actions');
    summary.append(roomFbIcon('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'));
    menu.append(summary, footer);
    if (meta) menu.append(meta);
    (card.querySelector('.sauti-card-main') || card).append(menu);
    menu.addEventListener('toggle', () => {
      if (menu.open) feed.querySelectorAll('.room-chat-message-menu[open]').forEach((other) => { if (other !== menu) other.open = false; });
    });
    menu.addEventListener('keydown', (event) => { if (event.key === 'Escape') { menu.open = false; summary.focus(); } });
    menu.addEventListener('click', (event) => { if (event.target.closest('button')) menu.open = false; });
  });
}

function roomFbPrivacyCopy() {
  // Membership policy (open/approval/invitation) does not describe Room privacy.
  // Use the same rendered privacy metadata as the detail heading, wherever its
  // chip appears among the category and member count chips.
  const badges = roomFbById('circle-detail')?.querySelectorAll('.room-detail-badges > span') || [];
  const privacyText = Array.from(badges, (badge) => String(badge.textContent || '').trim())
    .find((text) => /^(private|public)(?:\s*room)?$/i.test(text));
  if (/^private/i.test(privacyText || '')) {
    return ['Private', 'Only members can see who is in the Room and what they post.'];
  }
  if (/^public/i.test(privacyText || '')) {
    return ['Public', 'Anyone can find this Room and see its public information.'];
  }
  return ['Room privacy', 'Privacy details are not available yet.'];
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
  const descriptionCopy = description || 'No description yet.';
  if (aboutDescription && aboutDescription.textContent !== descriptionCopy) {
    aboutDescription.textContent = descriptionCopy;
  }

  const privacy = card.querySelector('[data-room-fb-privacy]');
  if (privacy) {
    const [label, copy] = roomFbPrivacyCopy();
    const signature = JSON.stringify([label, copy]);
    if (privacy.dataset.roomFbAboutSignature !== signature) {
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
      privacy.dataset.roomFbAboutSignature = signature;
    }
  }

  const members = card.querySelector('[data-room-fb-members]');
  if (members) {
    const count = String(document.querySelector('#circle-detail .room-detail-badges span:last-child')?.textContent || '').trim();
    const membership = String(roomFbById('circle-detail-membership')?.textContent || '').trim();
    const signature = JSON.stringify([count, membership]);
    if (members.dataset.roomFbAboutSignature !== signature) {
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
      members.dataset.roomFbAboutSignature = signature;
    }
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
    invite.addEventListener('click', () => {
      openRoomInfoView('invite');
      roomFbById('room-invite-panel')?.scrollIntoView({ block: 'nearest' });
    });
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
  const card = detail.querySelector('.circle-detail-card');
  if (card && card.parentElement !== aside) aside.prepend(card);

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
      .forEach((button) => {
        if (!button.classList.contains('room-info-toggle')) button.setAttribute('aria-expanded', 'false');
      });
    setRoomInfoVisible(false);
    const aside = roomFbById('room-fb-detail-aside');
    if (aside) aside.dataset.view = 'overview';
    const existingTabs = roomFbById('room-fb-detail-tabs');
    if (existingTabs) selectRoomDetailSection(existingTabs, 'discussion');
  }

  let tabs = roomFbById('room-fb-detail-tabs');
  if (!tabs) {
    tabs = createRoomDetailTabs();
    detail.insertBefore(tabs, roomFbById('circle-stream'));
  }
  const toolbar = roomFbById('room-detail-toolbar');
  const title = toolbar?.querySelector('.room-detail-toolbar-title');
  const meta = toolbar?.querySelector('.room-detail-toolbar-meta');
  const roomAvatar = toolbar?.querySelector('.room-chat-avatar');
  const opening = detail.hasAttribute('data-loading');
  const name = opening ? 'Opening Room…' : roomFbById('circle-detail-name').textContent;
  const count = opening ? '' : card.querySelector('.room-detail-badges span:last-child')?.textContent || '';
  const activity = opening ? '' : detail.dataset.chatActivity;
  const presence = activity?.includes('typing') ? activity : [count, activity].filter(Boolean).join(' · ');
  if (title && title.textContent !== name) title.textContent = name;
  if (meta && meta.textContent !== presence) meta.textContent = presence;
  if (roomAvatar) {
    const cover = card.querySelector('.room-detail-cover img');
    const photo = cover?.getAttribute('src') || '';
    const initial = opening ? '·' : (name.trim().slice(0, 1).toUpperCase() || 'R');
    if (roomAvatar.dataset.photo !== photo || roomAvatar.dataset.initial !== initial) {
      roomAvatar.dataset.photo = photo;
      roomAvatar.dataset.initial = initial;
      roomAvatar.textContent = initial;
      if (photo) {
        const image = document.createElement('img');
        image.alt = '';
        image.src = photo;
        image.addEventListener('error', () => image.remove(), { once: true });
        roomAvatar.append(image);
      }
    }
  }
  ensureRoomDetailActions();
  ensureRoomFacebookAside();
  enhanceRoomChatControls();
  const inviteOption = detail.querySelector('[data-room-detail-option="invite"]');
  const inviteUnavailable = !detail.querySelector('[data-room-fb-invite]:not([hidden])');
  if (inviteOption && inviteOption.hidden !== inviteUnavailable) inviteOption.hidden = inviteUnavailable;
  syncRoomDetailFeedFilter();

  const primary = roomFbById('circle-primary-action');
  if (primary) {
    const text = String(primary.textContent || '').toLowerCase();
    primary.classList.toggle('room-fb-secondary-primary', /leave|requested|cancel/.test(text));
  }
  const locked = roomFbById('circle-stream-locked');
  if (locked && !locked.hidden && primary?.dataset.action && !primary.disabled) {
    let join = locked.querySelector('.room-chat-join');
    if (!join) {
      join = document.createElement('button');
      join.type = 'button';
      join.className = 'form-submit room-chat-join';
      join.addEventListener('click', () => primary.click());
      locked.append(join);
    }
    if (join.textContent !== primary.textContent) join.textContent = primary.textContent;
    if (join.hidden) join.hidden = false;
  } else {
    const join = locked?.querySelector('.room-chat-join');
    if (join && !join.hidden) join.hidden = true;
  }
}

function syncRoomFacebookShell() {
  const surface = roomFbById('circles-surface');
  if (!surface) return;
  const visible = roomFbSurfaceOpen();
  document.body.classList.toggle('rooms-facebook-view', visible);
  surface.classList.toggle('room-fb-detail-open', roomFbDetailOpen());
  if (!visible) { document.body.classList.remove('rooms-site-menu-open'); return; }

  const sidebar = ensureRoomLandingSidebar();
  if (sidebar?.hidden) sidebar.hidden = false;
  const composer = roomFbById('circle-sauti-composer');
  const stream = roomFbById('circle-stream');
  if (composer && stream && stream.lastElementChild !== composer) stream.append(composer);
  syncRoomLandingFilter();
  if (roomFbDetailOpen()) ensureRoomDetailLayout();
}

function syncRoomDirectoryInput(event) {
  if (event.target.matches('#room-search, #room-category-filter')) syncRoomLandingFilter();
}

function scheduleRoomsFacebookUi() {
  if (roomsFacebookTimer) return;
  roomsFacebookTimer = requestAnimationFrame(() => {
    roomsFacebookTimer = 0;
    syncRoomFacebookShell();
  });
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
  attributeFilter: ['hidden', 'class', 'data-state', 'data-chat-activity'],
});
window.addEventListener('popstate', () => {
  syncRoomRouteFeedback();
  scheduleRoomsFacebookUi();
});
window.addEventListener('resize', scheduleRoomsFacebookUi);
scheduleRoomsFacebookUi();
