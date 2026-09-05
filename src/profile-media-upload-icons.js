const PROFILE_MEDIA_UPLOAD_BUTTONS = Object.freeze([
  {
    id: 'profile-avatar-upload-button',
    label: 'Upload profile photo',
  },
  {
    id: 'profile-header-upload-button',
    label: 'Upload header image',
  },
]);

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function profileMediaUploadIcon() {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.profileMediaUploadIcon = 'true';

  const arrow = document.createElementNS(SVG_NAMESPACE, 'path');
  arrow.setAttribute('d', 'M12 15V4m0 0L7.8 8.2M12 4l4.2 4.2');
  const tray = document.createElementNS(SVG_NAMESPACE, 'path');
  tray.setAttribute('d', 'M5 14.5v3.1A2.4 2.4 0 0 0 7.4 20h9.2a2.4 2.4 0 0 0 2.4-2.4v-3.1');
  svg.append(arrow, tray);
  return svg;
}

function hasUploadIcon(button) {
  return button.children.length === 1
    && button.firstElementChild?.matches('svg[data-profile-media-upload-icon="true"]');
}

function iconifyProfileMediaUploadButton(button, label) {
  if (!button || hasUploadIcon(button)) return;

  const currentText = String(button.textContent || '').trim();
  if (!button.dataset.defaultLabel && currentText) {
    button.dataset.defaultLabel = currentText;
  }

  const busy = /^uploading\b/i.test(currentText);
  button.replaceChildren(profileMediaUploadIcon());
  button.dataset.profileMediaIconified = 'true';
  button.setAttribute('aria-label', busy && currentText ? currentText : label);
  button.title = label;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

function watchProfileMediaUploadButton({ id, label }) {
  const button = document.getElementById(id);
  if (!button) return;

  iconifyProfileMediaUploadButton(button, label);
  const observer = new MutationObserver(() => {
    if (hasUploadIcon(button)) return;
    iconifyProfileMediaUploadButton(button, label);
  });
  observer.observe(button, { childList: true, characterData: true, subtree: true });
}

function installProfileMediaUploadIcons() {
  for (const config of PROFILE_MEDIA_UPLOAD_BUTTONS) {
    watchProfileMediaUploadButton(config);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installProfileMediaUploadIcons, { once: true });
} else {
  installProfileMediaUploadIcons();
}
