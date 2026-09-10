const PROFILE_ACTIVITY_SOURCE = /(?:^|\/)profile-activity\.js$/;

const TAB_ICON_MAP = `const PROFILE_ACTIVITY_TAB_ICONS = Object.freeze({
  posts: '<svg data-profile-activity-tab-icon="posts" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M8 9h8M8 13h8M8 17h5"></path></svg>&nbsp;',
  reposts: '<svg data-profile-activity-tab-icon="reposts" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"></path></svg>&nbsp;',
  replies: '<svg data-profile-activity-tab-icon="replies" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z"></path></svg>&nbsp;',
  likes: '<svg data-profile-activity-tab-icon="likes" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"></path></svg>&nbsp;',
  saves: '<svg data-profile-activity-tab-icon="saves" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"></path></svg>&nbsp;',
  hashtags: '<svg data-profile-activity-tab-icon="hashtags" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18"></path></svg>&nbsp;',
});
const PROFILE_ACTIVITY_PRIVACY_ICON = '<svg data-profile-activity-privacy-icon="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3 5 6v5c0 4.8 2.9 8.1 7 10 4.1-1.9 7-5.2 7-10V6l-7-3Z"></path><rect x="9" y="10" width="6" height="5" rx="1"></rect><path d="M10.5 10V8.7a1.5 1.5 0 0 1 3 0V10"></path></svg>&nbsp;';`;

export function transformProfileTabIconsSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (!PROFILE_ACTIVITY_SOURCE.test(normalized)) return source;
  if (source.includes('data-profile-activity-tab-icon="posts"')) return source;

  const badgesMarker = 'const PROFILE_ACTIVITY_BADGES = Object.freeze({';
  const tabRenderMarker = '${PROFILE_ACTIVITY_LABELS[tab]}</button>';
  const privacyRenderMarker = 'aria-expanded="false">Activity privacy</button>';

  if (!source.includes(badgesMarker)) {
    throw new Error('Profile tab icon transform could not find the badge-map insertion point.');
  }
  if (!source.includes(tabRenderMarker)) {
    throw new Error('Profile tab icon transform could not find the profile activity tab renderer.');
  }
  if (!source.includes(privacyRenderMarker)) {
    throw new Error('Profile tab icon transform could not find the Activity privacy renderer.');
  }

  return source
    .replace(badgesMarker, `${TAB_ICON_MAP}\n\n${badgesMarker}`)
    .replace(tabRenderMarker, '${PROFILE_ACTIVITY_TAB_ICONS[tab] || \'\'}${PROFILE_ACTIVITY_LABELS[tab]}</button>')
    .replace(privacyRenderMarker, 'aria-expanded="false">${PROFILE_ACTIVITY_PRIVACY_ICON}Activity privacy</button>');
}
