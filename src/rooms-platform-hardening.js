const roomCoverUrls = new Map();
let roomCoverScanTimer = 0;

function roomAccessToken() {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
    try {
      const stored = JSON.parse(localStorage.getItem(key) || 'null');
      const value = stored?.access_token || stored?.currentSession?.access_token || stored?.session?.access_token;
      if (value) return String(value);
    } catch {
      // Ignore unrelated malformed browser state.
    }
  }
  return '';
}

async function roomCoverUrl(slug) {
  if (!slug) return '';
  if (roomCoverUrls.has(slug)) return roomCoverUrls.get(slug);
  const accessToken = roomAccessToken();
  if (!accessToken) return '';
  const response = await fetch(`/api/room-media/${encodeURIComponent(slug)}/cover`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!response?.ok) return '';
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  roomCoverUrls.set(slug, objectUrl);
  return objectUrl;
}

function cardSlug(card) {
  return String(card?.dataset?.circleSlug || '').trim();
}

function detailSlug() {
  const path = location.pathname.match(/^\/rooms\/([^/]+)\/?$/);
  if (path?.[1]) return decodeURIComponent(path[1]);
  return String(document.getElementById('circle-detail-slug')?.textContent || '')
    .replace(/^\/(?:rooms|sautify)\//, '')
    .trim();
}

async function attachCoverImage(container, slug) {
  if (!container || !slug || container.dataset.roomCoverRendered === slug) return;
  const url = await roomCoverUrl(slug);
  if (!url || !container.isConnected) return;
  let image = container.querySelector('img.room-cover-image');
  if (!image) {
    image = document.createElement('img');
    image.className = 'room-cover-image';
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    container.replaceChildren(image);
  }
  image.src = url;
  container.dataset.roomCoverRendered = slug;
  container.classList.add('has-image');
}

function ensureRoomsTitle() {
  const surface = document.getElementById('circles-surface');
  if (!surface || surface.hidden) return;
  const title = document.getElementById('view-title');
  if (title && title.textContent !== 'Rooms') title.textContent = 'Rooms';
}

function scanRoomCovers() {
  ensureRoomsTitle();
  document.querySelectorAll('.circle-card[data-circle-slug] .room-card-cover').forEach((cover) => {
    attachCoverImage(cover, cardSlug(cover.closest('.circle-card')));
  });
  const detail = document.querySelector('#circle-detail:not([hidden]) .room-detail-cover');
  if (detail) attachCoverImage(detail, detailSlug());
}

function scheduleRoomCoverScan() {
  window.clearTimeout(roomCoverScanTimer);
  roomCoverScanTimer = window.setTimeout(scanRoomCovers, 60);
}

const roomHardeningObserver = new MutationObserver(scheduleRoomCoverScan);
roomHardeningObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['hidden', 'class'],
});

window.addEventListener('popstate', scheduleRoomCoverScan);
window.addEventListener('beforeunload', () => {
  roomCoverUrls.forEach((url) => URL.revokeObjectURL(url));
  roomCoverUrls.clear();
});

scheduleRoomCoverScan();
