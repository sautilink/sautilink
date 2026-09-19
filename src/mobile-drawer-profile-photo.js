const MOBILE_DRAWER_ID = 'sauti-mobile-more-drawer';
const DRAWER_AVATAR_SELECTOR = '.sauti-mobile-drawer-avatar';
const PROFILE_AVATAR_IMAGE_ID = 'profile-avatar-image';
const AVATAR_HOST_IDS = ['rail-avatar', 'member-avatar'];

function avatarFallbackText() {
  const railAvatar = document.getElementById('rail-avatar');
  const fallback = railAvatar?.querySelector('.profile-avatar-fallback');
  const value = String(fallback?.textContent || railAvatar?.textContent || 'S').trim();
  return value.charAt(0).toUpperCase() || 'S';
}

function explicitProfilePhotoSource() {
  const image = document.getElementById(PROFILE_AVATAR_IMAGE_ID);
  if (!(image instanceof HTMLImageElement) || image.hidden) return '';
  return String(image.currentSrc || image.getAttribute('src') || '').trim();
}

function hostedProfilePhotoSource() {
  for (const id of AVATAR_HOST_IDS) {
    const host = document.getElementById(id);
    if (!(host instanceof Element) || !host.classList.contains('has-profile-photo')) continue;
    const image = host.querySelector('img.profile-avatar-photo, img');
    const source = String(image?.currentSrc || image?.getAttribute('src') || '').trim();
    if (source) return source;
  }
  return '';
}

function activeProfilePhotoSource() {
  return explicitProfilePhotoSource() || hostedProfilePhotoSource();
}

function renderDrawerProfilePhoto(drawerAvatar) {
  if (!(drawerAvatar instanceof Element)) return;
  const source = activeProfilePhotoSource();
  if (!source) return;

  const existing = drawerAvatar.querySelector('img[data-mobile-drawer-profile-photo]');
  if (existing?.getAttribute('src') === source && drawerAvatar.classList.contains('has-profile-photo')) return;

  const fallback = document.createElement('span');
  fallback.className = 'profile-avatar-fallback';
  fallback.textContent = avatarFallbackText();

  const image = document.createElement('img');
  image.className = 'profile-avatar-photo';
  image.alt = '';
  image.decoding = 'async';
  image.loading = 'eager';
  image.dataset.mobileDrawerProfilePhoto = '';

  image.addEventListener('load', () => {
    if (!image.isConnected) return;
    fallback.hidden = true;
    drawerAvatar.classList.add('has-profile-photo');
  }, { once: true });

  image.addEventListener('error', () => {
    if (!image.isConnected) return;
    image.remove();
    fallback.hidden = false;
    drawerAvatar.classList.remove('has-profile-photo');
  }, { once: true });

  drawerAvatar.replaceChildren(fallback, image);
  drawerAvatar.classList.remove('has-profile-photo');
  image.src = source;

  if (image.complete && image.naturalWidth > 0) {
    fallback.hidden = true;
    drawerAvatar.classList.add('has-profile-photo');
  }
}

function bindMobileDrawerProfilePhoto() {
  const drawer = document.getElementById(MOBILE_DRAWER_ID);
  const drawerAvatar = drawer?.querySelector(DRAWER_AVATAR_SELECTOR);
  if (!(drawer instanceof Element) || !(drawerAvatar instanceof Element)) return false;
  if (drawer.dataset.profilePhotoBridgeBound === 'true') return true;
  drawer.dataset.profilePhotoBridgeBound = 'true';

  let scheduled = false;
  const scheduleSync = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      renderDrawerProfilePhoto(drawerAvatar);
    });
  };

  const sourceObserver = new MutationObserver(scheduleSync);
  const explicitProfileImage = document.getElementById(PROFILE_AVATAR_IMAGE_ID);
  if (explicitProfileImage instanceof Element) {
    sourceObserver.observe(explicitProfileImage, {
      attributes: true,
      attributeFilter: ['src', 'hidden'],
    });
  }

  AVATAR_HOST_IDS.forEach((id) => {
    const host = document.getElementById(id);
    if (!(host instanceof Element)) return;
    sourceObserver.observe(host, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    });
  });

  const drawerObserver = new MutationObserver(scheduleSync);
  drawerObserver.observe(drawer, {
    attributes: true,
    attributeFilter: ['class', 'hidden'],
  });

  scheduleSync();
  return true;
}

function installMobileDrawerProfilePhoto() {
  if (bindMobileDrawerProfilePhoto()) return;

  const bodyObserver = new MutationObserver(() => {
    if (!bindMobileDrawerProfilePhoto()) return;
    bodyObserver.disconnect();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installMobileDrawerProfilePhoto, { once: true });
} else {
  queueMicrotask(installMobileDrawerProfilePhoto);
}
