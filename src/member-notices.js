const MEMBER_NOTICE_SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const MEMBER_NOTICE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const MEMBER_NOTICE_STORAGE_KEY = 'sautilink.auth.session';
const MEMBER_NOTICE_EVENTS = new Set([
  'post_removed_author',
  'post_removed_reporter',
  'comment_removed_author',
  'comment_removed_reporter',
  'visibility_limited_author',
  'appeal_upheld',
  'appeal_reversed',
  'verification_approved',
  'verification_action_required',
  'verification_rejected',
]);

const noticeCache = new Map();
let noticeDecorationTimer = 0;
let appealDetailRequest = 0;

function accessToken() {
  try {
    const value = JSON.parse(localStorage.getItem(MEMBER_NOTICE_STORAGE_KEY) || 'null');
    if (typeof value?.access_token === 'string') return value.access_token;
    if (typeof value?.currentSession?.access_token === 'string') return value.currentSession.access_token;
    if (Array.isArray(value) && typeof value[0]?.access_token === 'string') return value[0].access_token;
  } catch {
    // The main application owns authentication; this enhancement simply waits for it.
  }
  return '';
}

function authenticatedHeaders(extra = {}) {
  const token = accessToken();
  if (!token) return null;
  return {
    apikey: MEMBER_NOTICE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...extra,
  };
}

function noticeText(event) {
  switch (event) {
    case 'post_removed_author':
      return 'Your post was removed for violating SautiLink rules. Tap to review the removal reason and appeal this decision. Repeated violations may result in your account being permanently banned from SautiLink.';
    case 'comment_removed_author':
      return 'Your comment was removed for violating SautiLink rules. Tap to review the removal reason and appeal this decision. Repeated violations may result in your account being permanently banned from SautiLink.';
    case 'post_removed_reporter':
      return 'The post you reported was removed after review. Thank you for helping SautiLink. We did not tell the post author that you submitted this report.';
    case 'comment_removed_reporter':
      return 'The comment you reported was removed after review. Thank you for helping SautiLink. We did not tell the content author that you submitted this report.';
    case 'visibility_limited_author':
      return 'SautiLink limited the visibility of your content after a safety review. Tap to review the reason and your appeal options.';
    case 'appeal_upheld':
      return 'Your moderation appeal was reviewed. The original decision remains in place. Tap to review the outcome.';
    case 'appeal_reversed':
      return 'Your moderation appeal was successful. SautiLink reversed the original moderation decision.';
    case 'verification_approved':
      return 'SautiLink verified your account information. Your verification checkmark is now visible on your profile. You must continue to follow SautiLink rules; verification may be removed if you violate them.';
    case 'verification_action_required':
      return 'Your verification request needs more information. Open your verification settings to review the message from the SautiLink team and respond.';
    case 'verification_rejected':
      return 'Your verification request was not approved. Open your verification settings to review the reason and next steps.';
    default:
      return '';
  }
}

function noticeRoute(notification) {
  const event = String(notification?.notification_event || '');
  const actionId = String(notification?.moderation_action_id || '');
  if (['post_removed_author', 'comment_removed_author', 'visibility_limited_author', 'appeal_upheld', 'appeal_reversed'].includes(event) && /^\d+$/.test(actionId)) {
    return `/appeals?action=${encodeURIComponent(actionId)}`;
  }
  if (event.startsWith('verification_')) return '/settings';
  return '';
}

async function fetchNoticeRows(ids) {
  const headers = authenticatedHeaders();
  if (!headers || !ids.length) return [];
  const cleanIds = ids.filter((id) => /^\d+$/.test(id));
  if (!cleanIds.length) return [];
  const params = new URLSearchParams({
    id: `in.(${cleanIds.join(',')})`,
    select: 'id,notification_type,notification_event,moderation_action_id,verification_case_id,read_at',
  });
  const response = await fetch(`${MEMBER_NOTICE_SUPABASE_URL}/rest/v1/social_notifications?${params}`, { headers });
  if (!response.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function markNoticeRead(id, item) {
  const headers = authenticatedHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' });
  if (!headers || !/^\d+$/.test(String(id || ''))) return;
  await fetch(`${MEMBER_NOTICE_SUPABASE_URL}/rest/v1/social_notifications?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ read_at: new Date().toISOString() }),
  }).catch(() => null);
  item?.classList.remove('unread');
}

function decorateNotificationItem(item, notification) {
  const event = String(notification?.notification_event || '');
  if (!MEMBER_NOTICE_EVENTS.has(event)) return;
  item.dataset.memberNoticeEvent = event;
  item.dataset.memberNoticeRoute = noticeRoute(notification);
  item.dataset.memberNoticeReady = 'true';
  item.removeAttribute('data-sauti-id');
  item.removeAttribute('data-circle-slug');

  const message = item.querySelector('.notification-copy p');
  const copy = noticeText(event);
  if (message && copy) {
    message.replaceChildren();
    const brand = document.createElement('strong');
    brand.textContent = 'SautiLink';
    message.append(brand, document.createTextNode(` ${copy}`));
  }
}

async function decorateVisibleNotices() {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  const items = [...list.querySelectorAll('[data-notification-id]')];
  const missingIds = [...new Set(items
    .map((item) => String(item.dataset.notificationId || ''))
    .filter((id) => /^\d+$/.test(id) && !noticeCache.has(id)))];

  if (missingIds.length) {
    const rows = await fetchNoticeRows(missingIds);
    for (const row of rows) noticeCache.set(String(row.id), row);
    for (const id of missingIds) if (!noticeCache.has(id)) noticeCache.set(id, null);
  }

  for (const item of items) {
    const id = String(item.dataset.notificationId || '');
    const notification = noticeCache.get(id);
    if (notification) decorateNotificationItem(item, notification);
  }
}

function scheduleNoticeDecoration() {
  window.clearTimeout(noticeDecorationTimer);
  noticeDecorationTimer = window.setTimeout(() => void decorateVisibleNotices(), 40);
}

function installNotificationObserver() {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  const observer = new MutationObserver(scheduleNoticeDecoration);
  observer.observe(list, { childList: true, subtree: true });
  scheduleNoticeDecoration();
}

async function memberAppealData() {
  const headers = authenticatedHeaders();
  if (!headers) return null;
  const response = await fetch('/api/appeals', { headers: { Authorization: headers.Authorization } });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.ok === false ? null : payload?.data || null;
}

function removalKind(action) {
  if (action?.target_type === 'comment') return 'Comment removed';
  if (action?.action_type === 'visibility_limited') return 'Content visibility limited';
  return 'Post removed';
}

function createAppealNoticeDetail(action, appeal) {
  const existing = document.getElementById('member-notice-appeal-detail');
  if (existing) existing.remove();

  const surface = document.getElementById('appeals-surface');
  if (!surface || !action) return;

  const panel = document.createElement('section');
  panel.id = 'member-notice-appeal-detail';
  panel.className = 'member-notice-detail';
  panel.setAttribute('aria-labelledby', 'member-notice-detail-title');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'member-notice-eyebrow';
  eyebrow.textContent = 'SautiLink safety notice';

  const title = document.createElement('h2');
  title.id = 'member-notice-detail-title';
  title.textContent = removalKind(action);

  const reasonTitle = document.createElement('strong');
  reasonTitle.textContent = 'Why this action was taken';
  const reason = document.createElement('p');
  reason.className = 'member-notice-reason';
  reason.textContent = String(action.reason || 'SautiLink applied this moderation decision after reviewing the reported content.');

  const warning = document.createElement('p');
  warning.className = 'member-notice-warning';
  warning.textContent = 'Please follow SautiLink rules going forward. Repeated violations may result in additional restrictions, including your account being permanently banned from SautiLink.';

  panel.append(eyebrow, title, reasonTitle, reason, warning);

  if (appeal) {
    const status = document.createElement('p');
    status.className = 'member-notice-appeal-status';
    status.textContent = `Appeal status: ${String(appeal.appeal_status || 'submitted').replaceAll('_', ' ')}`;
    panel.append(status);
  } else if (['content_removed', 'visibility_limited'].includes(action.action_type)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-action member-notice-appeal-button';
    button.textContent = 'Appeal this decision';
    button.addEventListener('click', () => {
      const existingButton = document.querySelector(`[data-appeal-action-id="${CSS.escape(String(action.id))}"]`);
      if (existingButton) {
        existingButton.click();
        return;
      }
      document.getElementById('appeals-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    panel.append(button);
  }

  const heading = surface.querySelector('.surface-heading, .settings-heading, h1, h2');
  if (heading?.parentElement === surface) heading.insertAdjacentElement('afterend', panel);
  else surface.prepend(panel);
}

async function renderAppealDeepLink() {
  if (window.location.pathname !== '/appeals') return;
  const actionId = new URL(window.location.href).searchParams.get('action') || '';
  if (!/^\d+$/.test(actionId)) return;
  const requestId = ++appealDetailRequest;
  const data = await memberAppealData();
  if (requestId !== appealDetailRequest || !data) return;
  const action = (data.actions || []).find((row) => String(row.id) === actionId);
  if (!action) return;
  const appeal = (data.appeals || []).find((row) => String(row.action_id) === actionId) || null;
  createAppealNoticeDetail(action, appeal);
}

function installAppealObserver() {
  const list = document.getElementById('appeals-list');
  if (!list) return;
  const observer = new MutationObserver(() => {
    if (window.location.pathname === '/appeals') void renderAppealDeepLink();
  });
  observer.observe(list, { childList: true, subtree: true });
}

document.addEventListener('click', (event) => {
  const item = event.target.closest?.('#notifications-list [data-member-notice-ready="true"]');
  if (!item) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const route = String(item.dataset.memberNoticeRoute || '');
  void (async () => {
    await markNoticeRead(item.dataset.notificationId, item);
    if (route) window.location.assign(route);
  })();
}, true);

const style = document.createElement('style');
style.id = 'member-notice-styles';
style.textContent = `
  .member-notice-detail { margin: 12px 16px 18px; padding: 18px; border: 1px solid var(--border, rgba(127,127,127,.25)); border-radius: 16px; background: var(--surface, rgba(127,127,127,.06)); }
  .member-notice-detail h2 { margin: 3px 0 14px; font-size: 20px; }
  .member-notice-eyebrow { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; opacity: .7; }
  .member-notice-reason, .member-notice-warning, .member-notice-appeal-status { line-height: 1.55; }
  .member-notice-warning { padding: 12px 14px; border-radius: 12px; background: rgba(127,127,127,.08); }
  .member-notice-appeal-button { margin-top: 4px; }
`;
document.head.append(style);

function installMemberNotices() {
  installNotificationObserver();
  installAppealObserver();
  void renderAppealDeepLink();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMemberNotices, { once: true });
else installMemberNotices();
