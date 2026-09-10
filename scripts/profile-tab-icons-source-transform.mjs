const PROFILE_ACTIVITY_SOURCE = /(?:^|\/)profile-activity\.js$/;

const TAB_ICON_MAP = `const PROFILE_ACTIVITY_TAB_ICONS = Object.freeze({
  posts: '<svg data-profile-activity-tab-icon="posts" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M8 9h8M8 13h8M8 17h5"></path></svg>&nbsp;',
  reposts: '<svg data-profile-activity-tab-icon="reposts" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"></path></svg>&nbsp;',
  replies: '<svg data-profile-activity-tab-icon="replies" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z"></path></svg>&nbsp;',
});`;

export function transformProfileTabIconsSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (!PROFILE_ACTIVITY_SOURCE.test(normalized)) return source;
  if (source.includes('data-profile-activity-tab-icon="posts"')) return source;

  const badgesMarker = 'const PROFILE_ACTIVITY_BADGES = Object.freeze({';
  const tabRenderMarker = '${PROFILE_ACTIVITY_LABELS[tab]}</button>';

  if (!source.includes(badgesMarker)) {
    throw new Error('Profile tab icon transform could not find the badge-map insertion point.');
  }
  if (!source.includes(tabRenderMarker)) {
    throw new Error('Profile tab icon transform could not find the profile activity tab renderer.');
  }

  return source
    .replace(badgesMarker, `${TAB_ICON_MAP}\n\n${badgesMarker}`)
    .replace(tabRenderMarker, '${PROFILE_ACTIVITY_TAB_ICONS[tab] || \'\'}${PROFILE_ACTIVITY_LABELS[tab]}</button>');
}
