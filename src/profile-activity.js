const PROFILE_ACTIVITY_STYLESHEET = '/app/assets/profile-activity.css';
const PROFILE_ACTIVITY_SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const PROFILE_ACTIVITY_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const PROFILE_ACTIVITY_SESSION_KEY = 'sautilink.auth.session';
const PROFILE_ACTIVITY_TABS = Object.freeze(['posts', 'replies', 'likes', 'saves', 'hashtags']);
const PROFILE_ACTIVITY_LABELS = Object.freeze({
  posts: 'Posts',
  replies: 'Replies',
  likes: 'Likes',
  saves: 'Saves',
  hashtags: 'Hashtags',
});
const PROFILE_ACTIVITY_BADGES = Object.freeze({
  team: '/app/assets/verification/verified-team.png',
  primary: '/app/assets/verification/verified-user-primary.png',
  secondary: '/app/assets/verification/verified-user-secondary.png',
});

let profileActivityState = null;
let profileActivityUsername = '';
let profileActivityTab = 'posts';
let profileActivitySyncRequest = 0;
let profileActivityFeedRequest = 0;
let profileActivitySyncTimer = 0;
let profileActivityStatusTimer = 0;
let profileActivityObjectUrls = new Set();
let profileActivityPinnedIds = new Set();
let profileActivityPinCount = 0;

function ensureProfileActivityStylesheet() {
  if (document.querySelector(`link[href="${PROFILE_ACTIVITY_STYLESHEET}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = PROFILE_ACTIVITY_STYLESHEET;
  document.head.append(link);
}

function profileActivityAccessToken() {
  try {
    const raw = window.localStorage.getItem(PROFILE_ACTIVITY_SESSION_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    if (typeof parsed?.access_token === 'string') return parsed.access_token;
    if (typeof parsed?.currentSession?.access_token === 'string') return parsed.currentSession.access_token;
    if (Array.isArray(parsed)) {
      const match = parsed.find((item) => typeof item?.access_token === 'string');
      return match?.access_token || '';
    }
  } catch {
    // The profile activity surface simply stays unavailable until a valid session is restored.
  }
  return '';
}

async function profileActivityRpc(name, body = {}) {
  const token = profileActivityAccessToken();
  if (!token) throw new Error('AUTH_REQUIRED');
  const response = await fetch(`${PROFILE_ACTIVITY_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: PROFILE_ACTIVITY_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = String(payload?.message || payload?.details || payload?.hint || 'PROFILE_ACTIVITY_REQUEST_FAILED');
    throw new Error(message);
  }
  return payload;
}

function profileActivityNodes() {
  return {
    shell: document.getElementById('profile-activity-shell'),
    tools: document.getElementById('profile-activity-tools'),
    status: document.getElementById('profile-activity-status'),
    privacyToggle: document.getElementById('profile-activity-privacy-toggle'),
    privacyPanel: document.getElementById('profile-activity-privacy'),
    privacyForm: document.getElementById('profile-activity-privacy-form'),
    likesVisibility: document.getElementById('profile-activity-likes-visibility'),
    savesVisibility: document.getElementById('profile-activity-saves-visibility'),
    hashtagsVisibility: document.getElementById('profile-activity-hashtags-visibility'),
    tabs: document.getElementById('profile-activity-tabs'),
    pinned: document.getElementById('profile-activity-pinned'),
    pinnedList: document.getElementById('profile-activity-pinned-list'),
    loading: document.getElementById('profile-activity-loading'),
    error: document.getElementById('profile-activity-error'),
    errorCopy: document.getElementById('profile-activity-error-copy'),
    feed: document.getElementById('profile-activity-feed'),
    hashtags: document.getElementById('profile-activity-hashtags'),
    empty: document.getElementById('profile-activity-empty'),
    emptyTitle: document.getElementById('profile-activity-empty-title'),
    emptyCopy: document.getElementById('profile-activity-empty-copy'),
    emptyAction: document.getElementById('profile-activity-empty-action'),
  };
}

function ensureProfileActivityShell() {
  const profileCard = document.getElementById('profile-card');
  if (!profileCard) return null;
  const existing = document.getElementById('profile-activity-shell');
  if (existing) return existing;

  const shell = document.createElement('section');
  shell.className = 'profile-activity-shell';
  shell.id = 'profile-activity-shell';
  shell.setAttribute('aria-label', 'Profile activity');
  shell.hidden = true;
  shell.innerHTML = `
    <div class="profile-activity-tools" id="profile-activity-tools" hidden>
      <span class="profile-activity-status" id="profile-activity-status" role="status" aria-live="polite"></span>
      <button class="profile-activity-privacy-toggle" id="profile-activity-privacy-toggle" type="button" aria-expanded="false">Activity privacy</button>
    </div>
    <section class="profile-activity-privacy" id="profile-activity-privacy" aria-labelledby="profile-activity-privacy-title" hidden>
      <div class="profile-activity-privacy-heading">
        <h3 id="profile-activity-privacy-title">Activity privacy</h3>
        <p>Choose who can see your Likes, Saves and Hashtags on your profile. Posts and Replies still follow each post’s own audience settings.</p>
      </div>
      <form id="profile-activity-privacy-form">
        <div class="profile-activity-privacy-grid">
          <label>Likes
            <select id="profile-activity-likes-visibility">
              <option value="public">Public</option>
              <option value="followers">Followers</option>
              <option value="private">Only you</option>
            </select>
          </label>
          <label>Saves
            <select id="profile-activity-saves-visibility">
              <option value="public">Public</option>
              <option value="followers">Followers</option>
              <option value="private">Only you</option>
            </select>
          </label>
          <label>Hashtags
            <select id="profile-activity-hashtags-visibility">
              <option value="public">Public</option>
              <option value="followers">Followers</option>
              <option value="private">Only you</option>
            </select>
          </label>
        </div>
        <div class="profile-activity-privacy-actions">
          <button class="profile-activity-privacy-save" type="submit">Save privacy</button>
        </div>
      </form>
    </section>
    <nav class="profile-activity-tabs" id="profile-activity-tabs" role="tablist" aria-label="Profile content">
      ${PROFILE_ACTIVITY_TABS.map((tab) => `<button class="profile-activity-tab" type="button" role="tab" data-profile-activity-tab="${tab}" aria-selected="${tab === 'posts'}">${PROFILE_ACTIVITY_LABELS[tab]}</button>`).join('')}
    </nav>
    <section class="profile-activity-pinned" id="profile-activity-pinned" aria-label="Pinned posts" hidden>
      <div class="profile-activity-pinned-heading">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 8 8M14 3l7 7-4 2-5 5-1 4-2-2 1-4 5-5-1-7Z"></path></svg>
        <span>Pinned</span>
      </div>
      <div class="profile-activity-pinned-list" id="profile-activity-pinned-list"></div>
    </section>
    <section class="profile-activity-loading" id="profile-activity-loading" role="status" aria-live="polite" hidden>
      <span class="loading-mark"></span>
      <p>Loading profile activity…</p>
    </section>
    <section class="profile-activity-error" id="profile-activity-error" role="alert" hidden>
      <h3>Profile activity could not load</h3>
      <p id="profile-activity-error-copy">Try again without leaving this profile.</p>
      <button class="profile-activity-retry" id="profile-activity-retry" type="button">Try again</button>
    </section>
    <section class="profile-activity-feed" id="profile-activity-feed" aria-live="polite"></section>
    <section class="profile-activity-hashtags" id="profile-activity-hashtags" aria-live="polite" hidden></section>
    <section class="profile-activity-empty" id="profile-activity-empty" hidden>
      <h3 id="profile-activity-empty-title">No posts yet.</h3>
      <p id="profile-activity-empty-copy"></p>
      <a class="profile-activity-empty-cta primary" id="profile-activity-empty-action" href="/home" hidden>Create your first post</a>
    </section>
  `;
  profileCard.insertAdjacentElement('afterend', shell);
  return shell;
}

function setProfileActivityStatus(message = '', type = '') {
  const node = profileActivityNodes().status;
  if (!node) return;
  window.clearTimeout(profileActivityStatusTimer);
  node.textContent = message;
  node.className = `profile-activity-status${type ? ` ${type}` : ''}`;
  if (message) {
    profileActivityStatusTimer = window.setTimeout(() => {
      node.textContent = '';
      node.className = 'profile-activity-status';
    }, 4200);
  }
}

function clearProfileActivityObjectUrls() {
  profileActivityObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  profileActivityObjectUrls.clear();
}

function currentProfileActivityBadgeAsset(type) {
  if (String(type || '').toLowerCase() === 'team') return PROFILE_ACTIVITY_BADGES.team;
  return document.documentElement.dataset.theme === 'light'
    ? PROFILE_ACTIVITY_BADGES.primary
    : PROFILE_ACTIVITY_BADGES.secondary;
}

function syncProfileActivityBadges() {
  document.querySelectorAll('[data-profile-activity-badge-type]').forEach((badge) => {
    const image = badge.querySelector('img');
    if (image) image.src = currentProfileActivityBadgeAsset(badge.dataset.profileActivityBadgeType);
  });
}

function createProfileActivityBadge(profile = {}) {
  if (!profile?.is_verified) return null;
  const type = String(profile.verification_badge_type || '').toLowerCase() === 'team' ? 'team' : 'standard';
  const badge = document.createElement('span');
  badge.className = 'verification-badge';
  badge.dataset.profileActivityBadgeType = type;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', type === 'team' ? 'Verified SautiLink Team account' : 'Verified account');
  badge.title = type === 'team' ? 'Verified SautiLink Team account' : 'Verified account';
  const image = document.createElement('img');
  image.alt = '';
  image.width = 64;
  image.height = 64;
  image.decoding = 'async';
  image.src = currentProfileActivityBadgeAsset(type);
  badge.append(image);
  return badge;
}

function profileActivityTime(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '';
  const diff = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'now';
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

function profileActivityUsernameValue() {
  const value = String(document.getElementById('profile-username')?.textContent || '').trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9._]{2,29}$/.test(value) ? value : '';
}

function profileActivityPostPath(postId) {
  return `/post/${encodeURIComponent(postId)}`;
}

function createProfileActivityMetric(kind, count, active = false) {
  const metric = document.createElement('span');
  metric.className = `profile-activity-metric${active ? ' active' : ''}${kind === 'save' ? ' saved' : ''}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const paths = {
    reply: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z"></path>',
    like: '<path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"></path>',
    repost: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"></path>',
    save: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"></path>',
  };
  svg.innerHTML = paths[kind] || '';
  const value = document.createElement('span');
  value.textContent = kind === 'save' ? (active ? 'Saved' : '') : String(Number(count) || 0);
  metric.append(svg, value);
  if (kind === 'save' && !active) metric.hidden = true;
  return metric;
}

function appendProfileActivityBody(body, text) {
  const source = String(text || '');
  const pattern = /(https?:\/\/[^\s]+|@[a-z0-9][a-z0-9._]{2,29}|#[\p{L}\p{N}_]{1,64})/giu;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) body.append(document.createTextNode(source.slice(cursor, index)));
    const token = match[0];
    const link = document.createElement('a');
    link.textContent = token;
    if (token.startsWith('@')) {
      link.href = `/u/${encodeURIComponent(token.slice(1).toLowerCase())}`;
    } else if (token.startsWith('#')) {
      link.href = `/discover?q=${encodeURIComponent(token)}`;
    } else {
      link.href = token;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    body.append(link);
    cursor = index + token.length;
  }
  if (cursor < source.length) body.append(document.createTextNode(source.slice(cursor)));
}

async function loadProtectedProfileActivityMedia(url, element, placeholder, requestId) {
  try {
    const token = profileActivityAccessToken();
    if (!token) throw new Error('AUTH_REQUIRED');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('MEDIA_UNAVAILABLE');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (requestId !== profileActivityFeedRequest) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    profileActivityObjectUrls.add(objectUrl);
    element.src = objectUrl;
    element.hidden = false;
    placeholder?.remove();
  } catch {
    if (placeholder) placeholder.textContent = 'Media unavailable';
  }
}

function createProfileActivityAvatar(author, requestId) {
  const avatar = document.createElement('span');
  avatar.className = 'profile-activity-card-avatar';
  const display = String(author?.display_name || author?.username || 'S');
  avatar.textContent = display.slice(0, 1).toUpperCase();
  if (!author?.avatar_key || !author?.username) return avatar;

  const image = document.createElement('img');
  image.alt = '';
  image.hidden = true;
  avatar.append(image);
  const version = encodeURIComponent(String(author.updated_at || author.avatar_key || '1'));
  void loadProtectedProfileActivityMedia(
    `/api/profile-media/${encodeURIComponent(author.username)}/avatar?v=${version}`,
    image,
    null,
    requestId,
  );
  return avatar;
}

function createProfileActivityMedia(mediaRows, requestId) {
  const rows = Array.isArray(mediaRows) ? mediaRows.slice(0, 4) : [];
  if (!rows.length) return null;
  const grid = document.createElement('div');
  grid.className = `profile-activity-media${rows.length === 1 ? ' single' : ''}`;

  rows.forEach((media) => {
    const item = document.createElement('div');
    item.className = 'profile-activity-media-item';
    const placeholder = document.createElement('span');
    placeholder.className = 'profile-activity-media-placeholder';
    placeholder.textContent = 'Loading media…';
    let element;
    if (media.kind === 'video') {
      element = document.createElement('video');
      element.controls = true;
      element.preload = 'metadata';
      element.setAttribute('playsinline', '');
      element.setAttribute('aria-label', media.alt_text || 'Post video');
    } else {
      element = document.createElement('img');
      element.alt = media.alt_text || 'Post image';
      element.loading = 'lazy';
      element.decoding = 'async';
    }
    element.hidden = true;
    item.append(placeholder, element);
    grid.append(item);
    void loadProtectedProfileActivityMedia(`/api/sauti-media/${encodeURIComponent(media.id)}`, element, placeholder, requestId);
  });
  return grid;
}

function createProfileActivityCard(item, { pinned = false, allowPin = false, requestId = profileActivityFeedRequest } = {}) {
  const author = item?.author || {};
  const username = String(author.username || 'member');
  const displayName = String(author.display_name || username || 'SautiLink member');
  const card = document.createElement('article');
  card.className = 'profile-activity-card';
  card.dataset.postId = String(item.id || '');
  card.setAttribute('role', 'link');
  card.tabIndex = 0;
  card.setAttribute('aria-label', `Open post by @${username}`);

  const avatar = createProfileActivityAvatar(author, requestId);
  const main = document.createElement('div');
  main.className = 'profile-activity-card-main';

  const head = document.createElement('div');
  head.className = 'profile-activity-card-head';
  const authorName = document.createElement('span');
  authorName.className = 'profile-activity-author';
  const authorText = document.createElement('span');
  authorText.className = 'profile-activity-author-name';
  authorText.textContent = displayName;
  authorName.append(authorText);
  const badge = createProfileActivityBadge(author);
  if (badge) authorName.append(badge);
  const handle = document.createElement('span');
  handle.className = 'profile-activity-handle';
  handle.textContent = `@${username}`;
  const dot = document.createElement('span');
  dot.className = 'profile-activity-dot';
  dot.textContent = '·';
  const time = document.createElement('time');
  time.className = 'profile-activity-time';
  time.dateTime = String(item.created_at || '');
  time.textContent = profileActivityTime(item.created_at);
  head.append(authorName, handle, dot, time);

  if (profileActivityState?.owner && allowPin && item.author_id === profileActivityState?.profile?.id) {
    const isPinned = pinned || Boolean(item.is_pinned) || profileActivityPinnedIds.has(item.id);
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'profile-activity-pin-action';
    pin.dataset.profilePin = String(item.id || '');
    pin.dataset.pinned = String(isPinned);
    pin.textContent = isPinned ? 'Unpin' : 'Pin';
    if (!isPinned && profileActivityPinCount >= 3) {
      pin.disabled = true;
      pin.title = 'You can pin up to 3 posts or replies.';
    } else {
      pin.title = isPinned ? 'Remove from pinned posts' : 'Pin to profile';
    }
    head.append(pin);
  }

  main.append(head);

  if (item.replying_to?.username) {
    const replying = document.createElement('p');
    replying.className = 'profile-activity-replying';
    replying.append(document.createTextNode('Replying to '));
    const link = document.createElement('a');
    link.href = `/u/${encodeURIComponent(item.replying_to.username)}`;
    link.textContent = `@${item.replying_to.username}`;
    replying.append(link);
    main.append(replying);
  }

  const body = document.createElement('p');
  body.className = 'profile-activity-body';
  appendProfileActivityBody(body, item.body || '');
  main.append(body);

  if (item.quote_post_id) {
    const quote = document.createElement('a');
    quote.className = 'profile-activity-quote-link';
    quote.href = profileActivityPostPath(item.quote_post_id);
    quote.textContent = 'View quoted post';
    main.append(quote);
  }

  const media = createProfileActivityMedia(item.media, requestId);
  if (media) main.append(media);

  const metrics = document.createElement('div');
  metrics.className = 'profile-activity-metrics';
  metrics.append(
    createProfileActivityMetric('reply', item.comment_count),
    createProfileActivityMetric('repost', item.repost_count, Boolean(item.viewer_reposted)),
    createProfileActivityMetric('like', item.like_count, Boolean(item.viewer_liked)),
    createProfileActivityMetric('save', 0, Boolean(item.viewer_saved)),
  );
  main.append(metrics);
  card.append(avatar, main);
  return card;
}

function profileActivityEmptyCopy(tab, owner) {
  const copy = {
    posts: owner
      ? ['You haven’t posted yet.', 'Share your first post and it’ll appear on your profile.']
      : ['No posts yet.', 'When this account posts, you’ll see it here.'],
    replies: owner
      ? ['You haven’t replied yet.', 'Join a conversation and your replies will appear here.']
      : ['No replies yet.', 'This account hasn’t replied to any conversations yet.'],
    likes: owner
      ? ['No liked posts yet.', 'Posts you like will appear here based on your Activity privacy setting.']
      : ['No liked posts to show.', 'There aren’t any visible liked posts from this account.'],
    saves: owner
      ? ['Nothing saved yet.', 'Save useful posts and choose who can see them from Activity privacy.']
      : ['No saved posts to show.', 'There aren’t any visible saved posts from this account.'],
    hashtags: owner
      ? ['No hashtags yet.', 'Hashtags you use in your posts will appear here.']
      : ['No hashtags to show.', 'This account hasn’t used any visible hashtags yet.'],
  };
  return copy[tab] || copy.posts;
}

function showProfileActivityEmpty(tab) {
  const nodes = profileActivityNodes();
  const [title, copy] = profileActivityEmptyCopy(tab, Boolean(profileActivityState?.owner));
  nodes.emptyTitle.textContent = title;
  nodes.emptyCopy.textContent = copy;
  nodes.empty.hidden = false;
  nodes.emptyAction.hidden = !(profileActivityState?.owner && tab === 'posts');
  nodes.emptyAction.textContent = 'Create your first post';
}

function setProfileActivityLoading(loading) {
  const nodes = profileActivityNodes();
  nodes.loading.hidden = !loading;
  if (loading) {
    nodes.error.hidden = true;
    nodes.empty.hidden = true;
    nodes.feed.replaceChildren();
    nodes.hashtags.replaceChildren();
    nodes.hashtags.hidden = true;
    nodes.pinned.hidden = true;
    nodes.pinnedList.replaceChildren();
  }
}

function renderProfileActivityTabs() {
  const nodes = profileActivityNodes();
  nodes.tabs.querySelectorAll('[data-profile-activity-tab]').forEach((button) => {
    const tab = button.dataset.profileActivityTab;
    const allowed = Boolean(profileActivityState?.tabs?.[tab]);
    button.hidden = !allowed;
    button.setAttribute('aria-selected', String(tab === profileActivityTab));
    button.tabIndex = tab === profileActivityTab ? 0 : -1;
  });
}

function syncProfileActivityPrivacyControls() {
  const nodes = profileActivityNodes();
  const owner = Boolean(profileActivityState?.owner);
  nodes.tools.hidden = !owner;
  if (!owner) {
    nodes.privacyPanel.hidden = true;
    nodes.privacyToggle.setAttribute('aria-expanded', 'false');
    return;
  }
  const preferences = profileActivityState?.preferences || {};
  nodes.likesVisibility.value = preferences.likes || 'private';
  nodes.savesVisibility.value = preferences.saves || 'private';
  nodes.hashtagsVisibility.value = preferences.hashtags || 'private';
}

function renderProfileActivityPinned(items, requestId) {
  const nodes = profileActivityNodes();
  const rows = Array.isArray(items) ? items : [];
  profileActivityPinnedIds = new Set(rows.map((item) => item.id));
  profileActivityPinCount = profileActivityPinnedIds.size;
  nodes.pinnedList.replaceChildren();
  rows.forEach((item) => {
    nodes.pinnedList.append(createProfileActivityCard(item, { pinned: true, allowPin: true, requestId }));
  });
  nodes.pinned.hidden = rows.length === 0;
}

function renderProfileActivityFeed(items, { tab, requestId, exclude = new Set() } = {}) {
  const nodes = profileActivityNodes();
  const rows = (Array.isArray(items) ? items : []).filter((item) => !exclude.has(item.id));
  nodes.feed.replaceChildren();
  rows.forEach((item) => {
    nodes.feed.append(createProfileActivityCard(item, {
      allowPin: tab === 'posts' || tab === 'replies',
      requestId,
    }));
  });
  return rows.length;
}

function renderProfileActivityHashtags(items) {
  const nodes = profileActivityNodes();
  const rows = Array.isArray(items) ? items : [];
  nodes.hashtags.replaceChildren();
  rows.forEach((item) => {
    const tag = String(item.tag || '').replace(/^#/, '');
    if (!tag) return;
    const link = document.createElement('a');
    link.className = 'profile-activity-hashtag';
    link.href = `/discover?q=${encodeURIComponent(`#${tag}`)}`;
    const copy = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = `#${tag}`;
    const small = document.createElement('small');
    small.textContent = item.last_used_at ? `Last used ${profileActivityTime(item.last_used_at)}` : 'Used in posts';
    copy.append(strong, small);
    const count = document.createElement('span');
    count.className = 'profile-activity-hashtag-count';
    const uses = Number(item.count) || 0;
    count.textContent = `${uses} ${uses === 1 ? 'use' : 'uses'}`;
    link.append(copy, count);
    nodes.hashtags.append(link);
  });
  nodes.hashtags.hidden = rows.length === 0;
  return rows.length;
}

async function loadProfileActivityTab(tab = profileActivityTab) {
  if (!profileActivityState?.available || !profileActivityUsername) return;
  const safeTab = PROFILE_ACTIVITY_TABS.includes(tab) && profileActivityState?.tabs?.[tab] ? tab : 'posts';
  profileActivityTab = safeTab;
  renderProfileActivityTabs();
  const requestId = ++profileActivityFeedRequest;
  clearProfileActivityObjectUrls();
  setProfileActivityLoading(true);
  const nodes = profileActivityNodes();

  try {
    if (safeTab === 'hashtags') {
      const result = await profileActivityRpc('profile_hashtags_phase33', { p_username: profileActivityUsername });
      if (requestId !== profileActivityFeedRequest) return;
      setProfileActivityLoading(false);
      if (!result?.allowed) throw new Error('PROFILE_ACTIVITY_NOT_ALLOWED');
      const count = renderProfileActivityHashtags(result.items || []);
      if (!count) showProfileActivityEmpty('hashtags');
      return;
    }

    let feedResult;
    let pinsResult = null;
    if (safeTab === 'posts') {
      [feedResult, pinsResult] = await Promise.all([
        profileActivityRpc('profile_activity_feed_phase33', { p_username: profileActivityUsername, p_tab: 'posts', p_limit: 40, p_offset: 0 }),
        profileActivityRpc('profile_activity_feed_phase33', { p_username: profileActivityUsername, p_tab: 'pins', p_limit: 3, p_offset: 0 }),
      ]);
    } else if (safeTab === 'replies' && profileActivityState.owner) {
      [feedResult, pinsResult] = await Promise.all([
        profileActivityRpc('profile_activity_feed_phase33', { p_username: profileActivityUsername, p_tab: 'replies', p_limit: 40, p_offset: 0 }),
        profileActivityRpc('profile_activity_feed_phase33', { p_username: profileActivityUsername, p_tab: 'pins', p_limit: 3, p_offset: 0 }),
      ]);
    } else {
      feedResult = await profileActivityRpc('profile_activity_feed_phase33', { p_username: profileActivityUsername, p_tab: safeTab, p_limit: 40, p_offset: 0 });
    }

    if (requestId !== profileActivityFeedRequest) return;
    setProfileActivityLoading(false);
    if (!feedResult?.allowed) throw new Error('PROFILE_ACTIVITY_NOT_ALLOWED');

    if (pinsResult?.allowed) {
      profileActivityPinnedIds = new Set((pinsResult.items || []).map((item) => item.id));
      profileActivityPinCount = profileActivityPinnedIds.size;
      if (safeTab === 'posts') renderProfileActivityPinned(pinsResult.items || [], requestId);
    } else if (safeTab === 'posts') {
      profileActivityPinnedIds = new Set();
      profileActivityPinCount = 0;
      nodes.pinned.hidden = true;
    }

    const exclude = safeTab === 'posts' ? profileActivityPinnedIds : new Set();
    const feedCount = renderProfileActivityFeed(feedResult.items || [], { tab: safeTab, requestId, exclude });
    const pinnedCount = safeTab === 'posts' ? profileActivityPinCount : 0;
    if (feedCount + pinnedCount === 0) showProfileActivityEmpty(safeTab);
  } catch (error) {
    if (requestId !== profileActivityFeedRequest) return;
    setProfileActivityLoading(false);
    nodes.feed.replaceChildren();
    nodes.pinned.hidden = true;
    nodes.hashtags.hidden = true;
    nodes.empty.hidden = true;
    nodes.errorCopy.textContent = String(error?.message || '').includes('NOT_ALLOWED')
      ? 'This profile activity is private.'
      : 'Try again without leaving this profile.';
    nodes.error.hidden = false;
  }
}

async function syncProfileActivity(force = false) {
  const shell = ensureProfileActivityShell();
  const profileSurface = document.getElementById('profile-surface');
  const profileCard = document.getElementById('profile-card');
  if (!shell || !profileSurface || !profileCard) return;

  const username = profileActivityUsernameValue();
  const token = profileActivityAccessToken();
  if (profileSurface.hidden || profileCard.hidden || !username || !token) {
    shell.hidden = true;
    if (!username || profileCard.hidden) profileActivityUsername = '';
    profileActivitySyncRequest += 1;
    profileActivityFeedRequest += 1;
    clearProfileActivityObjectUrls();
    return;
  }

  if (!force && profileActivityUsername === username && profileActivityState?.available) {
    shell.hidden = false;
    return;
  }

  const requestId = ++profileActivitySyncRequest;
  if (profileActivityUsername !== username) profileActivityTab = 'posts';
  profileActivityUsername = username;
  shell.hidden = false;
  setProfileActivityLoading(true);

  try {
    const state = await profileActivityRpc('profile_activity_state_phase33', { p_username: username });
    if (requestId !== profileActivitySyncRequest || profileActivityUsername !== username) return;
    if (!state?.available) {
      shell.hidden = true;
      return;
    }
    profileActivityState = state;
    if (!state.tabs?.[profileActivityTab]) profileActivityTab = 'posts';
    renderProfileActivityTabs();
    syncProfileActivityPrivacyControls();
    await loadProfileActivityTab(profileActivityTab);
  } catch {
    if (requestId !== profileActivitySyncRequest) return;
    profileActivityState = null;
    setProfileActivityLoading(false);
    const nodes = profileActivityNodes();
    nodes.errorCopy.textContent = 'Try again without leaving this profile.';
    nodes.error.hidden = false;
  }
}

function scheduleProfileActivitySync(force = false, delay = 70) {
  window.clearTimeout(profileActivitySyncTimer);
  profileActivitySyncTimer = window.setTimeout(() => void syncProfileActivity(force), delay);
}

async function saveProfileActivityPrivacy(form) {
  if (!profileActivityState?.owner) return;
  const nodes = profileActivityNodes();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await profileActivityRpc('update_profile_activity_preferences_phase33', {
      p_likes_visibility: nodes.likesVisibility.value,
      p_saves_visibility: nodes.savesVisibility.value,
      p_hashtags_visibility: nodes.hashtagsVisibility.value,
    });
    profileActivityState.preferences = result;
    setProfileActivityStatus('Activity privacy updated.', 'success');
    nodes.privacyPanel.hidden = true;
    nodes.privacyToggle.setAttribute('aria-expanded', 'false');
    await syncProfileActivity(true);
  } catch {
    setProfileActivityStatus('Activity privacy could not be updated.', 'error');
  } finally {
    submit.disabled = false;
  }
}

async function toggleProfileActivityPin(button) {
  if (!profileActivityState?.owner) return;
  const postId = String(button.dataset.profilePin || '');
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return;
  const pinned = button.dataset.pinned === 'true';
  button.disabled = true;
  try {
    await profileActivityRpc('set_profile_pin_phase33', {
      p_post_id: postId,
      p_pinned: !pinned,
    });
    setProfileActivityStatus(pinned ? 'Post unpinned.' : 'Post pinned to your profile.', 'success');
    await loadProfileActivityTab(profileActivityTab);
  } catch (error) {
    const provider = String(error?.message || '');
    setProfileActivityStatus(
      provider.includes('PROFILE_PIN_LIMIT')
        ? 'You can pin up to 3 posts or replies. Unpin one first.'
        : 'This post could not be pinned right now.',
      'error',
    );
    button.disabled = false;
  }
}

function updateSavedSurfaceCopy() {
  const toolbar = document.querySelector('#saved-surface .saved-toolbar');
  if (!toolbar) return;
  const paragraphs = toolbar.querySelectorAll('p:not(.section-label)');
  const copy = paragraphs[paragraphs.length - 1];
  if (copy) copy.textContent = 'Keep useful posts here and return to them later. Visibility on your profile follows your Activity privacy setting.';
}

function installProfileActivity() {
  if (window.__sautilinkProfileActivityInstalled) return;
  window.__sautilinkProfileActivityInstalled = true;
  ensureProfileActivityStylesheet();
  const shell = ensureProfileActivityShell();
  const profileSurface = document.getElementById('profile-surface');
  const profileCard = document.getElementById('profile-card');
  const profileUsernameNode = document.getElementById('profile-username');
  if (!shell || !profileSurface || !profileCard || !profileUsernameNode) return;

  updateSavedSurfaceCopy();

  const nodes = profileActivityNodes();
  nodes.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-profile-activity-tab]');
    if (!button || button.hidden) return;
    const tab = button.dataset.profileActivityTab;
    if (!PROFILE_ACTIVITY_TABS.includes(tab) || !profileActivityState?.tabs?.[tab]) return;
    void loadProfileActivityTab(tab);
  });

  nodes.privacyToggle.addEventListener('click', () => {
    if (!profileActivityState?.owner) return;
    const open = nodes.privacyPanel.hidden;
    nodes.privacyPanel.hidden = !open;
    nodes.privacyToggle.setAttribute('aria-expanded', String(open));
    if (open) syncProfileActivityPrivacyControls();
  });

  nodes.privacyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveProfileActivityPrivacy(nodes.privacyForm);
  });

  document.getElementById('profile-activity-retry')?.addEventListener('click', () => void syncProfileActivity(true));

  shell.addEventListener('click', (event) => {
    const pin = event.target.closest('[data-profile-pin]');
    if (pin) {
      event.preventDefault();
      event.stopPropagation();
      void toggleProfileActivityPin(pin);
      return;
    }
    const card = event.target.closest('.profile-activity-card');
    if (!card || event.target.closest('a, button, video')) return;
    const postId = card.dataset.postId;
    if (postId) window.location.assign(profileActivityPostPath(postId));
  });

  shell.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.profile-activity-card');
    if (!card || event.target.closest('a, button, video')) return;
    event.preventDefault();
    const postId = card.dataset.postId;
    if (postId) window.location.assign(profileActivityPostPath(postId));
  });

  new MutationObserver(() => scheduleProfileActivitySync(false))
    .observe(profileSurface, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => scheduleProfileActivitySync(false))
    .observe(profileCard, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => scheduleProfileActivitySync(true))
    .observe(profileUsernameNode, { childList: true, characterData: true, subtree: true });
  new MutationObserver(syncProfileActivityBadges)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  document.getElementById('profile-follow-button')?.addEventListener('click', () => {
    window.setTimeout(() => scheduleProfileActivitySync(true, 0), 700);
  });

  window.addEventListener('popstate', () => scheduleProfileActivitySync(true, 40));
  window.addEventListener('storage', (event) => {
    if (event.key === PROFILE_ACTIVITY_SESSION_KEY) scheduleProfileActivitySync(true, 0);
  });

  scheduleProfileActivitySync(true, 0);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installProfileActivity, { once: true });
} else {
  queueMicrotask(installProfileActivity);
}
