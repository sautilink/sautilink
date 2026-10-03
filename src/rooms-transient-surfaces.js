const ROOM_TRANSIENT_SURFACES = [
  {
    id: 'room-detail-menu',
    trigger: '[aria-controls="room-detail-menu"]',
    kind: 'menu',
  },
  {
    id: 'room-detail-search',
    trigger: '[aria-controls="room-detail-search"]',
    kind: 'search',
  },
];

let roomTransientFrame = 0;

function roomTransientSurface(config) {
  return document.getElementById(config.id);
}

function roomTransientTrigger(config) {
  return document.querySelector(config.trigger);
}

function roomTransientIsOpen(surface) {
  return Boolean(surface && !surface.hidden);
}

function roomTransientClamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function roomTransientPortal(surface) {
  if (!surface || surface.parentElement === document.body) return;
  document.body.append(surface);
  surface.dataset.roomTransientPortal = 'true';
}

function roomTransientResetSearch(surface) {
  const input = surface?.querySelector('#room-detail-search-input');
  if (!input || !input.value) return;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function roomTransientClose(config, { resetSearch = true } = {}) {
  const surface = roomTransientSurface(config);
  const trigger = roomTransientTrigger(config);
  if (!surface) return;

  surface.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (config.kind === 'search' && resetSearch) roomTransientResetSearch(surface);
}

function roomTransientCloseAll(exceptId = '') {
  ROOM_TRANSIENT_SURFACES.forEach((config) => {
    if (config.id !== exceptId) roomTransientClose(config);
  });
}

function roomTransientApplyFixedBase(surface) {
  surface.style.position = 'fixed';
  surface.style.zIndex = '1200';
  surface.style.right = 'auto';
  surface.style.bottom = 'auto';
  surface.style.margin = '0';
  surface.style.transform = 'none';
  surface.style.maxHeight = 'calc(100dvh - 84px)';
  surface.style.overflowY = 'auto';
  surface.style.boxSizing = 'border-box';
}

function roomTransientPosition(config) {
  const surface = roomTransientSurface(config);
  const trigger = roomTransientTrigger(config);
  if (!roomTransientIsOpen(surface) || !trigger) return;

  roomTransientPortal(surface);
  roomTransientApplyFixedBase(surface);

  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;
  const edge = 12;
  const gap = 8;
  const triggerRect = trigger.getBoundingClientRect();
  const toolbar = trigger.closest('#room-detail-toolbar');
  const toolbarRect = toolbar?.getBoundingClientRect() || triggerRect;
  const roomDetail = document.getElementById('circle-detail');
  const detailRect = roomDetail?.getBoundingClientRect();

  let top = toolbarRect.bottom + gap;
  let left = edge;
  let width = Math.max(0, viewportWidth - (edge * 2));

  if (config.kind === 'menu') {
    width = Math.min(240, Math.max(0, viewportWidth - (edge * 2)));
    left = roomTransientClamp(triggerRect.right - width, edge, viewportWidth - width - edge);
  } else {
    const preferredLeft = detailRect ? detailRect.left + edge : edge;
    const preferredWidth = detailRect
      ? detailRect.width - (edge * 2)
      : viewportWidth - (edge * 2);
    width = Math.min(
      Math.max(0, preferredWidth),
      Math.max(0, viewportWidth - (edge * 2)),
    );
    left = roomTransientClamp(preferredLeft, edge, viewportWidth - width - edge);
  }

  const maxTop = Math.max(edge, viewportHeight - 72);
  top = roomTransientClamp(top, edge, maxTop);

  surface.style.top = `${Math.round(top)}px`;
  surface.style.left = `${Math.round(left)}px`;
  surface.style.width = `${Math.round(width)}px`;
}

function roomTransientSyncOpenSurface(config) {
  const surface = roomTransientSurface(config);
  if (!roomTransientIsOpen(surface)) return;

  roomTransientCloseAll(config.id);
  roomTransientPosition(config);
}

function roomTransientScheduleSync(config) {
  if (roomTransientFrame) cancelAnimationFrame(roomTransientFrame);
  roomTransientFrame = requestAnimationFrame(() => {
    roomTransientFrame = 0;
    roomTransientSyncOpenSurface(config);
  });
}

function roomTransientConfigFromTrigger(target) {
  const trigger = target?.closest?.('[aria-controls="room-detail-menu"], [aria-controls="room-detail-search"]');
  if (!trigger) return null;
  const controlledId = trigger.getAttribute('aria-controls');
  return ROOM_TRANSIENT_SURFACES.find((config) => config.id === controlledId) || null;
}

function roomTransientHandlePointerDown(event) {
  ROOM_TRANSIENT_SURFACES.forEach((config) => {
    const surface = roomTransientSurface(config);
    if (!roomTransientIsOpen(surface)) return;

    const trigger = roomTransientTrigger(config);
    const target = event.target;
    if (surface.contains(target) || trigger?.contains(target)) return;
    roomTransientClose(config);
  });
}

function roomTransientHandleClick(event) {
  const config = roomTransientConfigFromTrigger(event.target);
  if (!config) return;
  roomTransientScheduleSync(config);
}

function roomTransientHandleScroll() {
  roomTransientCloseAll();
}

function roomTransientHandleResize() {
  roomTransientCloseAll();
}

function roomTransientHandleKeydown(event) {
  if (event.key !== 'Escape') return;
  const openConfig = ROOM_TRANSIENT_SURFACES.find((config) => roomTransientIsOpen(roomTransientSurface(config)));
  if (!openConfig) return;

  const trigger = roomTransientTrigger(openConfig);
  roomTransientClose(openConfig);
  trigger?.focus({ preventScroll: true });
}

function installRoomTransientSurfaceFix() {
  if (document.documentElement.dataset.roomTransientSurfaceFix === 'true') return;
  document.documentElement.dataset.roomTransientSurfaceFix = 'true';

  document.addEventListener('pointerdown', roomTransientHandlePointerDown, true);
  document.addEventListener('click', roomTransientHandleClick);
  document.addEventListener('scroll', roomTransientHandleScroll, true);
  document.addEventListener('touchmove', roomTransientHandleScroll, { capture: true, passive: true });
  document.addEventListener('wheel', roomTransientHandleScroll, { capture: true, passive: true });
  document.addEventListener('keydown', roomTransientHandleKeydown);
  window.addEventListener('resize', roomTransientHandleResize, { passive: true });
  window.addEventListener('orientationchange', roomTransientHandleResize, { passive: true });
}

installRoomTransientSurfaceFix();
