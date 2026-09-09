const ROOM_INVITE_SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const ROOM_INVITE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const ROOM_INVITE_AUTH_KEY = 'sautilink.auth.session';
let roomInviteTimer = 0;
let roomInviteUserPromise = null;
let roomInviteListKey = '';
let roomInvitePanelKey = '';

function inviteToken() {
  try {
    const stored = JSON.parse(localStorage.getItem(ROOM_INVITE_AUTH_KEY) || 'null');
    return String(stored?.access_token || stored?.currentSession?.access_token || stored?.session?.access_token || '');
  } catch {
    return '';
  }
}

function inviteHeaders({ json = false, prefer = '' } = {}) {
  const headers = { apikey: ROOM_INVITE_KEY, Accept: 'application/json' };
  const token = inviteToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function inviteUrl(table, params = {}) {
  const url = new URL(`${ROOM_INVITE_SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

async function inviteSelect(table, params) {
  const response = await fetch(inviteUrl(table, params), { headers: inviteHeaders() }).catch(() => null);
  if (!response?.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function inviteWrite(table, method, params, body) {
  const response = await fetch(inviteUrl(table, params), {
    method,
    headers: inviteHeaders({ json: Boolean(body), prefer: 'return=representation' }),
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!response?.ok) {
    const payload = await response?.json().catch(() => null);
    throw new Error(payload?.message || payload?.details || 'The Room invitation could not be updated.');
  }
  return response.json().catch(() => []);
}

async function inviteUser() {
  if (roomInviteUserPromise) return roomInviteUserPromise;
  roomInviteUserPromise = (async () => {
    const token = inviteToken();
    if (!token) return null;
    const response = await fetch(`${ROOM_INVITE_SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ROOM_INVITE_KEY, Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!response?.ok) return null;
    const user = await response.json().catch(() => null);
    return user?.id ? user : null;
  })();
  return roomInviteUserPromise;
}

function inviteToast(message) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  window.clearTimeout(inviteToast.timer);
  inviteToast.timer = window.setTimeout(() => { node.hidden = true; }, 2600);
}

function activeInviteRoomSlug() {
  const route = location.pathname.match(/^\/rooms\/([^/]+)\/?$/);
  if (route?.[1]) return decodeURIComponent(route[1]);
  return String(document.getElementById('circle-detail-slug')?.textContent || '').replace(/^\/(?:rooms|sautify)\//, '').trim();
}

async function activeInviteRoom() {
  const slug = activeInviteRoomSlug();
  if (!slug) return null;
  const rows = await inviteSelect('social_circles', {
    slug: `eq.${slug}`,
    select: 'id,slug,name,invite_permission',
    limit: 1,
  });
  return rows[0] || null;
}

async function inviteViewerRole(roomId, userId) {
  const rows = await inviteSelect('social_circle_members', {
    circle_id: `eq.${roomId}`,
    member_id: `eq.${userId}`,
    select: 'member_role',
    limit: 1,
  });
  return String(rows[0]?.member_role || '');
}

function canRoomInvite(room, role) {
  return Boolean(role) && (room.invite_permission === 'all_members' || ['owner', 'admin', 'moderator'].includes(role));
}

async function ensureRoomInvitePanel() {
  const detail = document.getElementById('circle-detail');
  if (!detail || detail.hidden) return;
  const [room, user] = await Promise.all([activeInviteRoom(), inviteUser()]);
  if (!room || !user) return;
  const role = await inviteViewerRole(room.id, user.id);
  if (!canRoomInvite(room, role)) {
    document.getElementById('room-invite-panel')?.remove();
    return;
  }
  const key = `${room.id}:${role}:${room.invite_permission}`;
  if (roomInvitePanelKey === key && document.getElementById('room-invite-panel')) return;
  roomInvitePanelKey = key;
  document.getElementById('room-invite-panel')?.remove();

  const panel = document.createElement('section');
  panel.id = 'room-invite-panel';
  panel.className = 'room-invite-panel';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'section-label';
  eyebrow.textContent = 'Grow this Room';
  const heading = document.createElement('h3');
  heading.textContent = 'Invite a member';
  const hint = document.createElement('p');
  hint.textContent = 'Invite someone using their SautiLink username.';
  copy.append(eyebrow, heading, hint);

  const form = document.createElement('form');
  form.className = 'room-invite-form';
  form.noValidate = true;
  const field = document.createElement('div');
  field.className = 'room-invite-input';
  const prefix = document.createElement('span');
  prefix.textContent = '@';
  const input = document.createElement('input');
  input.name = 'username';
  input.maxLength = 30;
  input.placeholder = 'username';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'SautiLink username');
  field.append(prefix, input);
  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'secondary-action';
  button.textContent = 'Invite';
  form.append(field, button);
  const message = document.createElement('p');
  message.className = 'room-admin-message';
  message.hidden = true;
  panel.append(copy, form, message);

  detail.insertBefore(panel, document.getElementById('circle-stream') || document.getElementById('room-admin-panel') || detail.lastChild);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.hidden = true;
    const username = String(input.value || '').trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9][a-z0-9._]{2,29}$/.test(username)) {
      message.textContent = 'Enter a valid SautiLink username.';
      message.hidden = false;
      return;
    }
    button.disabled = true;
    try {
      const profiles = await inviteSelect('social_profiles', { username: `eq.${username}`, select: 'id,username,display_name', limit: 1 });
      const profile = profiles[0];
      if (!profile) throw new Error('No SautiLink account was found with that username.');
      if (profile.id === user.id) throw new Error('Choose another member to invite.');
      const membership = await inviteSelect('social_circle_members', {
        circle_id: `eq.${room.id}`,
        member_id: `eq.${profile.id}`,
        select: 'member_id',
        limit: 1,
      });
      if (membership.length) throw new Error('That person is already a member of this Room.');

      const previous = await inviteSelect('social_room_invitations', {
        room_id: `eq.${room.id}`,
        invited_user_id: `eq.${profile.id}`,
        select: 'status',
        limit: 1,
      });
      if (previous[0]?.status === 'pending') throw new Error('That member already has a pending invitation.');
      if (previous[0]?.status === 'accepted') throw new Error('That member has already accepted a Room invitation.');
      if (previous[0]?.status === 'declined') {
        await inviteWrite('social_room_invitations', 'DELETE', {
          room_id: `eq.${room.id}`,
          invited_user_id: `eq.${profile.id}`,
          status: 'eq.declined',
        });
      }

      await inviteWrite('social_room_invitations', 'POST', {}, {
        room_id: room.id,
        invited_user_id: profile.id,
        invited_by: user.id,
        status: 'pending',
      });
      input.value = '';
      inviteToast(`Invitation sent to @${profile.username}.`);
    } catch (error) {
      message.textContent = error?.message || 'The invitation could not be sent.';
      message.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

async function renderIncomingRoomInvitations() {
  const surface = document.getElementById('circles-surface');
  if (!surface || surface.hidden) return;
  const user = await inviteUser();
  if (!user) return;
  const invitations = await inviteSelect('social_room_invitations', {
    invited_user_id: `eq.${user.id}`,
    status: 'eq.pending',
    select: 'room_id,invited_by,created_at',
    order: 'created_at.desc',
    limit: 30,
  });
  const key = invitations.map((row) => `${row.room_id}:${row.invited_by}:${row.created_at}`).join('|');
  if (key === roomInviteListKey && document.getElementById('room-incoming-invitations')) return;
  roomInviteListKey = key;
  document.getElementById('room-incoming-invitations')?.remove();
  if (!invitations.length) return;

  const roomIds = [...new Set(invitations.map((row) => row.room_id))];
  const rooms = await inviteSelect('social_circles', {
    id: `in.(${roomIds.join(',')})`,
    select: 'id,slug,name,privacy,member_count',
  });
  const roomMap = new Map(rooms.map((room) => [room.id, room]));
  const section = document.createElement('section');
  section.id = 'room-incoming-invitations';
  section.className = 'room-incoming-invitations';
  const heading = document.createElement('div');
  heading.className = 'room-invitation-heading';
  const headingCopy = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'section-label';
  eyebrow.textContent = 'Invitations';
  const title = document.createElement('h3');
  title.textContent = 'Rooms waiting for you';
  headingCopy.append(eyebrow, title);
  const count = document.createElement('span');
  count.textContent = String(invitations.length);
  heading.append(headingCopy, count);
  section.append(heading);

  invitations.forEach((invitation) => {
    const room = roomMap.get(invitation.room_id);
    if (!room) return;
    const row = document.createElement('article');
    row.className = 'room-invitation-row';
    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = room.name;
    const meta = document.createElement('span');
    meta.textContent = `${room.privacy === 'private' ? 'Private Room' : 'Public Room'} · ${Number(room.member_count || 0).toLocaleString()} members`;
    info.append(name, meta);
    const actions = document.createElement('div');
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'form-submit';
    accept.textContent = 'Accept';
    const decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'secondary-action';
    decline.textContent = 'Decline';
    actions.append(accept, decline);
    row.append(info, actions);
    section.append(row);

    const decide = async (status) => {
      accept.disabled = true;
      decline.disabled = true;
      try {
        await inviteWrite('social_room_invitations', 'PATCH', {
          room_id: `eq.${room.id}`,
          invited_user_id: `eq.${user.id}`,
          status: 'eq.pending',
        }, { status });
        row.remove();
        roomInviteListKey = '';
        inviteToast(status === 'accepted' ? `You joined ${room.name}.` : 'Invitation declined.');
        if (status === 'accepted') window.setTimeout(() => location.assign(`/rooms/${encodeURIComponent(room.slug)}`), 150);
        else scheduleRoomInvitations();
      } catch (error) {
        accept.disabled = false;
        decline.disabled = false;
        inviteToast(error?.message || 'The invitation could not be updated.');
      }
    };
    accept.addEventListener('click', () => decide('accepted'));
    decline.addEventListener('click', () => decide('declined'));
  });

  const controls = document.getElementById('room-discovery-controls');
  if (controls) controls.insertAdjacentElement('afterend', section);
  else document.getElementById('circles-list')?.insertAdjacentElement('beforebegin', section);
}

function scheduleRoomInvitations() {
  window.clearTimeout(roomInviteTimer);
  roomInviteTimer = window.setTimeout(() => {
    renderIncomingRoomInvitations();
    ensureRoomInvitePanel();
  }, 140);
}

const roomInviteObserver = new MutationObserver(scheduleRoomInvitations);
roomInviteObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
window.addEventListener('popstate', scheduleRoomInvitations);
scheduleRoomInvitations();
