const ROOMS_FACEBOOK_UI_CSS = '/app/assets/rooms-facebook.css?v=20260909-fbgroups1';
let roomsFacebookTimer = 0;
let roomsFacebookFilter = 'discover';

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
  if (document.querySelector(`link[href^="/app/assets/rooms-facebook.css"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = ROOMS_FACEBOOK_UI_CSS;
  document.head.append(link);
}

function roomFbSurfaceOpen() {
  const surface = roomFbById('circles-surface');
  return roomFbVisible(surface);
}

function roomFbDetailOpen() {
  return roomFbVisible(roomFbById('circle-detail'));
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
    ['discussion', 'Discussion'],
    ['about', 'About'],
    ['people', 'People'],
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
    if (key === 'discussion') target = roomFbById('circle-stream');
    if (key === 'about') target = roomFbById('room-fb-about-card');
    if (key === 'people') {
      target = roomFbById('circle-members')
        || document.querySelector('[data-room-member-list]')
        || roomFbById('room-admin-panel');
    }
    tabs.querySelectorAll('[data-room-fb-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return tabs;
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
    const count = String(roomFbById('circle-detail-membership')?.textContent || '').trim();
    members.replaceChildren(
      roomFbIcon('<circle cx="9" cy="9" r="3"></circle><circle cx="17" cy="10" r="2.5"></circle><path d="M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6M14 15c3.4-.7 5.5.9 6 4"></path>'),
    );
    const copyNode = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = 'Members';
    const small = document.createElement('small');
    small.textContent = count || 'Room membership';
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

  let tabs = roomFbById('room-fb-detail-tabs');
  if (!tabs) {
    tabs = createRoomDetailTabs();
    card.insertAdjacentElement('afterend', tabs);
  }
  ensureRoomDetailActions();
  ensureRoomFacebookAside();

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
const roomsFacebookObserver = new MutationObserver(scheduleRoomsFacebookUi);
roomsFacebookObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['hidden', 'class'],
});
window.addEventListener('popstate', scheduleRoomsFacebookUi);
window.addEventListener('resize', scheduleRoomsFacebookUi);
scheduleRoomsFacebookUi();
