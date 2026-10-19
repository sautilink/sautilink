/**
 * Presentation-only map of existing member UI glyphs to AnimateIcons Huge.
 * Geometry signatures deliberately ignore SVG presentation/accessibility attributes.
 * Feature modules retain ownership of controls, labels, counts, state and events.
 * The adapter applies the member/auth gate before consulting this map.
 */

const GEOMETRY_ATTRIBUTES = Object.freeze(['cx', 'cy', 'd', 'height', 'points', 'r', 'rx', 'ry', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2']);
const GEOMETRY_SELECTOR = 'path, rect, circle, ellipse, line, polyline, polygon';

export function glyphSignature(svg) {
  return [...svg.querySelectorAll(GEOMETRY_SELECTOR)].map((shape) => {
    const attributes = GEOMETRY_ATTRIBUTES.filter((name) => shape.hasAttribute(name))
      .map((name) => name + '=' + shape.getAttribute(name).trim().replace(/\s+/g, ' '));
    return shape.localName.toLowerCase() + ':' + attributes.join(';');
  }).join('|');
}

const literalGlyphs = [
  // app/index.html:53
  ["path:d=M5 19h4l10-10-4-4L5 15v4Z|path:d=m13.5 6.5 4 4", "edit-0-2"],
  // app/index.html:56
  ["path:d=M4 7h16M4 12h12M4 17h16", "menu-0-1"],
  // app/index.html:59
  ["circle:cx=12;cy=12;r=4|path:d=M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42", "sun-0-1"],
  // app/index.html:60
  ["path:d=M20.2 15.2A8.4 8.4 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z", "moon-0-1"],
  // app/index.html:77
  ["path:d=M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9.5Z", "home-0-1"],
  // app/index.html:81
  ["circle:cx=11;cy=11;r=6.5|path:d=m16 16 4 4M11 7.5v7M7.5 11h7", "search"],
  // app/index.html:85
  ["path:d=M4 5.5h16v11H8l-4 3v-14Z|path:d=M8 10h8M8 13h5", "message-0-1"],
  // app/index.html:90
  ["path:d=M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9|path:d=M10 21h4", "notification"],
  // app/index.html:95
  ["rect:height=17;rx=4;width=17;x=3.5;y=3.5|circle:cx=9;cy=10;r=2.2|circle:cx=15.5;cy=10.8;r=1.8|path:d=M5.8 17c.4-2.5 1.5-3.7 3.4-3.7s3 1.2 3.4 3.7M13 14.4c2.5-.5 4.1.5 4.5 2.6", "user-group"],
  // app/index.html:99
  ["path:d=M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z", "bookmark"],
  // app/index.html:103
  ["path:d=M12 3v18M5 7h14M7 7l-3 6h6L7 7ZM17 7l-3 6h6l-3-6ZM7 21h10", "sautilink:justice-scale"],
  // app/index.html:107
  ["path:d=M12 3 4.5 6v5.5c0 4.6 3 7.8 7.5 9.5 4.5-1.7 7.5-4.9 7.5-9.5V6L12 3Z|path:d=m8.5 12 2.2 2.2 4.8-5", "shield-check"],
  // app/index.html:111
  ["circle:cx=12;cy=12;r=3|path:d=M19 13.5v-3l-2-.7a7.3 7.3 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7.3 7.3 0 0 0-1.7-.7L10.5 2h-3l-.7 2a7.3 7.3 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7.3 7.3 0 0 0-.7 1.7l-2 .7v3l2 .7a7.3 7.3 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7.3 7.3 0 0 0 1.7.7l.7 2h3l.7-2a7.3 7.3 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7.3 7.3 0 0 0 .7-1.7l2-.7Z", "settings-0-1"],
  // app/index.html:115
  ["circle:cx=12;cy=8;r=4|path:d=M4.5 21c.7-4.2 3.2-6.5 7.5-6.5s6.8 2.3 7.5 6.5", "user"],
  // app/index.html:127
  ["path:d=M6 3.5h8l4 4v13H6Z|path:d=M14 3.5v4h4M9 12h6M9 15.5h6", "file-0-1"],
  // app/index.html:135
  ["path:d=M12 3v12M7.5 7.5 12 3l4.5 4.5|path:d=M5 14v5h14v-5", "upload-0-1"],
  // app/index.html:139
  ["path:d=M4 5.5h16v13H4Z|path:d=m4 7 8 6 8-6", "mail-0-1"],
  // app/index.html:143
  ["path:d=M21 11.5a8.4 8.4 0 0 1-9 8.4 9.4 9.4 0 0 1-3.8-.8L3 20.5l1.5-4.8A8.5 8.5 0 1 1 21 11.5Z", "message-0-1"],
  // app/index.html:152
  ["path:d=M7.2 18.5h9.9a4 4 0 0 0 .6-8A6 6 0 0 0 6.3 9.2a4.7 4.7 0 0 0 .9 9.3Z", "lucide:cloud"],
  // app/index.html:156
  ["rect:height=8;rx=2;width=17;x=3.5;y=11|path:d=M7 15h.01M11 15h.01M8 8.2a6 6 0 0 1 8 0M10.4 9.8a2.5 2.5 0 0 1 3.2 0", "lucide:router"],
  // app/index.html:167
  ["path:d=M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5M14 8l4 4-4 4M8 12h10", "logout-0-1"],
  // app/index.html:191
  ["path:d=m6 6 12 12M18 6 6 18", "cancel-0-1"],
  // app/index.html:258
  ["path:d=M5 12h14M13 6l6 6-6 6", "arrow-right-0-2"],
  // app/index.html:344
  ["path:d=m5 12 4 4L19 6", "check"],
  // app/index.html:421
  ["path:d=m5 5 14 14M19 5 5 19", "cancel-0-1"],
  // app/index.html:433
  ["circle:cx=12;cy=12;r=9|path:d=M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18", "globe-0-2"],
  // app/index.html:441
  ["path:d=M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z", "message-0-1"],
  // app/index.html:464
  ["path:d=M12 16V4m0 0L7 9m5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2", "upload-0-1"],
  // app/index.html:497
  ["path:d=M4 4l16 16M8.5 8.5A7 7 0 0 0 5 14h14a7 7 0 0 0-1.2-3.9M10 18h4", "wifi-off-0-1"],
  // app/index.html:514
  ["path:d=M5 6h14M9 6v12M6 18h6", "text-font"],
  // app/index.html:518
  ["rect:height=14;rx=2;width=18;x=3;y=5|circle:cx=9;cy=10;r=2|path:d=m5 17 4-4 3 3 2-2 5 3", "image-0-1"],
  // app/index.html:522
  ["path:d=M4 7h4l2-2h4l2 2h4v12H4z|circle:cx=12;cy=13;r=3", "camera-0-1"],
  // app/index.html:526
  ["path:d=M6 20V10M12 20V4M18 20v-7", "analytics-0-1"],
  // app/index.html:540
  ["path:d=M12 5v14M5 12h14", "add-0-1"],
  // app/index.html:585
  ["path:d=m15.5 19-7-7 7-7", "chevron-left"],
  // app/index.html:633
  ["circle:cx=11;cy=11;r=6.5|path:d=m16 16 4 4", "search"],
  // app/index.html:1110
  ["rect:height=11;rx=2;width=14;x=5;y=10|path:d=M8 10V7a4 4 0 0 1 8 0v3", "lock-keyhole"],
  // app/index.html:1111
  ["rect:height=14;rx=3;width=18;x=3;y=5|path:d=m10 9 5 3-5 3V9Z", "video-0-1"],
  // app/index.html:1114
  ["path:d=M12 3v12|path:d=m7 10 5 5 5-5|path:d=M5 20h14", "download"],
  // app/index.html:1236
  ["path:d=m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z|path:d=m14.7 6.9 2.8 2.8", "edit-0-2"],
  // app/index.html:1245
  ["circle:cx=5;cy=12;r=1.5|circle:cx=12;cy=12;r=1.5|circle:cx=19;cy=12;r=1.5", "more-horizontal"],
  // app/index.html:1248
  ["path:d=M5 3v18|path:d=M5 4h12l-2 4 2 4H5", "flag-0-1"],
  // app/index.html:1249
  ["path:d=M11 5 6.5 9H3v6h3.5L11 19V5Z|path:d=m17 9 4 4M21 9l-4 4", "volume-off"],
  // app/index.html:1250
  ["circle:cx=12;cy=12;r=9|path:d=m5.6 5.6 12.8 12.8", "security-block"],
  // app/index.html:1266
  ["path:d=M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z|circle:cx=12;cy=10;r=2.5", "location-0-1"],
  // app/index.html:1267
  ["circle:cx=12;cy=12;r=9|path:d=M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18", "globe-0-2"],
  // app/index.html:1430
  ["circle:cx=11;cy=11;r=7|path:d=m20 20-4-4", "search"],
  // app/index.html:1435
  ["rect:height=18;rx=5;width=18;x=3;y=3|circle:cx=9;cy=10;r=2|path:d=M5.5 17c.4-2.3 1.5-3.5 3.5-3.5s3.1 1.2 3.5 3.5M15 8a2 2 0 0 1 0 4m0 2c2.1 0 3.1 1 3.5 3", "user-group"],
  // app/index.html:1439
  ["path:d=M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4Z", "bookmark"],
  // app/index.html:1443
  ["circle:cx=12;cy=8;r=4|path:d=M5 21v-2a7 7 0 0 1 14 0v2", "user"],
  // app/index.html:1452
  ["path:d=M3.8 10.7 12 4l8.2 6.7v8.4c0 1-.8 1.8-1.8 1.8h-4.6v-6.2h-3.6v6.2H5.6c-1 0-1.8-.8-1.8-1.8v-8.4Z", "home-0-1"],
  // app/index.html:1453
  ["circle:cx=10.7;cy=10.7;r=6.5|path:d=m15.6 15.6 4.5 4.5", "search"],
  // app/index.html:1454
  ["path:d=M5.2 4.7h13.6c1 0 1.8.8 1.8 1.8v8.7c0 1-.8 1.8-1.8 1.8H9.3L4 20.4v-4.7a1.8 1.8 0 0 1-.6-1.4V6.5c0-1 .8-1.8 1.8-1.8Z", "message-0-1"],
  // app/index.html:1455
  ["path:d=M18.3 9.2c0-3.6-2.4-5.9-6.3-5.9S5.7 5.6 5.7 9.2c0 4.9-1.8 5.7-2.6 7.2-.3.6.1 1.2.8 1.2h16.2c.7 0 1.1-.6.8-1.2-.8-1.5-2.6-2.3-2.6-7.2Z|path:d=M9.4 20.3h5.2", "notification"],
  // app/index.html:1457
  ["circle:cx=12;cy=8.2;r=3.5|path:d=M5.1 20.2c.8-4.2 3.1-6.3 6.9-6.3s6.1 2.1 6.9 6.3", "user"],
  // src/mobile-more-drawer.js:12
  ["circle:cx=12;cy=12;r=3|path:d=M19 13.5v-3l-2-.7a7.2 7.2 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7.2 7.2 0 0 0-1.7-.7L10.5 2h-3l-.7 2a7.2 7.2 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7.2 7.2 0 0 0-.7 1.7l-2 .7v3l2 .7a7.2 7.2 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7.2 7.2 0 0 0 1.7.7l.7 2h3l.7-2a7.2 7.2 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7.2 7.2 0 0 0 .7-1.7l2-.7Z", "settings-0-1"],
  // src/mobile-more-drawer.js:17
  ["path:d=M12 3 4.5 6v5.5c0 4.6 3 7.8 7.5 9.5 4.5-1.7 7.5-4.9 7.5-9.5V6L12 3Z|path:d=m8.7 12.2 2.1 2.1 4.6-4.8", "shield-check"],
  // src/mobile-more-drawer.js:18
  ["path:d=M12 3 5.5 5.7v5.5c0 4.2 2.7 7.2 6.5 8.8 3.8-1.6 6.5-4.6 6.5-8.8V5.7L12 3Z|circle:cx=12;cy=10;r=2|path:d=M8.8 15.5c.9-1.5 2-2.2 3.2-2.2s2.3.7 3.2 2.2", "id-verified"],
  // src/mobile-more-drawer.js:20
  ["circle:cx=12;cy=12;r=4|path:d=M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4", "sun-0-1"],
  // src/mobile-more-drawer.js:21
  ["circle:cx=12;cy=12;r=9|path:d=M9.8 9a2.4 2.4 0 1 1 3.7 2c-1 .7-1.5 1.2-1.5 2.3M12 17h.01", "help-circle"],
  // src/mobile-more-drawer.js:27
  ["path:d=m9 6 6 6-6 6", "chevron-right"],
  // src/mobile-more-drawer.js:28
  ["path:d=m6 9 6 6 6-6", "chevron-down"],
  // src/professional-profile-category.js:367
  ["path:d=m7 7 10 10M17 7 7 17", "cancel-0-1"],
  // src/profile-activity.js:153
  ["path:d=m8 4 8 8M14 3l7 7-4 2-5 5-1 4-2-2 1-4 5-5-1-7Z", "lucide:pin"],
  // src/profile-activity.js:267
  ["path:d=M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z", "heart"],
  // src/profile-activity.js:268
  ["path:d=m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3", "repeat"],
  // src/room-post-images.js:398
  ["rect:height=16;rx=3;width=18;x=3;y=4|circle:cx=9;cy=10;r=2|path:d=m5.5 17 4.2-4 3 2.6 2.5-2.1 3.3 3.5", "image-0-1"],
  // src/rooms-facebook-ui.js:149
  ["path:d=M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Z|path:d=m14.8 9.2-2 5.6-5.6 2 2-5.6 5.6-2Z", "compass-0-1"],
  // src/rooms-facebook-ui.js:157
  ["circle:cx=9;cy=9;r=3|circle:cx=17;cy=10;r=2.5|path:d=M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6M14 15c3.4-.7 5.5.9 6 4", "user-group"],
  // src/rooms-facebook-ui.js:295
  ["circle:cx=10.5;cy=10.5;r=6.5|path:d=m15.5 15.5 5 5", "search"],
  // src/rooms-facebook-ui.js:303
  ["circle:cx=5;cy=12;r=1|circle:cx=12;cy=12;r=1|circle:cx=19;cy=12;r=1", "more-horizontal"],
  // src/rooms-facebook-ui.js:393
  ["path:d=M12 3a7 7 0 0 0-7 7v3H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-1v-3a7 7 0 0 0-7-7Zm-4 10v-3a4 4 0 0 1 8 0v3", "lock-keyhole"],
  // src/rooms-facebook-ui.js:431
  ["circle:cx=18;cy=5;r=2.5|circle:cx=6;cy=12;r=2.5|circle:cx=18;cy=19;r=2.5|path:d=m8.2 10.9 7.5-4.5M8.2 13.1l7.5 4.5", "share-0-1"],
  // src/rooms-facebook-ui.js:456
  ["circle:cx=9;cy=8;r=3|path:d=M3.5 19c.4-3.8 2.2-5.7 5.5-5.7 1.2 0 2.2.2 3 .7M17 8v6M14 11h6", "user-add-0-1"],
  // src/short-videos-feed.js:12
  ["path:d=M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z", "heart"],
  // src/short-videos-feed.js:13
  ["path:d=M4 5.5h16v11H8l-4 3v-14Z", "message-0-1"],
  // src/short-videos-feed.js:14
  ["path:d=m2 9 3-3 3 3M5 6h11a2 2 0 0 1 2 2v2m4 5-3 3-3-3m3 3H8a2 2 0 0 1-2-2v-2", "repeat"],
  // src/short-videos-feed.js:16
  ["path:d=M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6", "share-0-1"],
  // scripts/profile-tab-icons-source-transform.mjs:4
  ["rect:height=16;rx=2;width=16;x=4;y=4|path:d=M8 9h8M8 13h8M8 17h5", "file-0-1"],
  // scripts/profile-tab-icons-source-transform.mjs:9
  ["path:d=M5 9h14M4 15h14M10 3 8 21M16 3l-2 18", "lucide:hash"],
  // scripts/profile-tab-icons-source-transform.mjs:11
  ["path:d=M12 3 5 6v5c0 4.8 2.9 8.1 7 10 4.1-1.9 7-5.2 7-10V6l-7-3Z|rect:height=5;rx=1;width=6;x=9;y=10|path:d=M10.5 10V8.7a1.5 1.5 0 0 1 3 0V10", "lock-keyhole"],
];

// Exclude authentication artwork, social trademarks, official identity badges and
// live analytics charts. These carry identity/data, rather than control glyphs.
export const excludedIconSelector = [
  '#auth-view svg', '.auth-view svg', '.auth-result svg', '[id^="auth-"] svg',
  '.auth-entry-header svg', '.auth-art svg', '.auth-panel-symbol svg',
  '.verification-badge svg', '.verification-social-icon svg',
  '.professional-dashboard-chart svg', '#professional-dashboard-chart svg',
  '.brand-mark svg', '.brand-logo svg', '[data-brand-logo] svg',
].join(', ');

const pathGlyph = (...paths) => paths.map((d) => 'path:d=' + d).join('|');
const generatedGlyphs = [
  [pathGlyph('M4 20c1-4 3-6 7-6s6 2 7 6', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8'), 'user'],
  // src/app.js — post/comment actions and media queue deletion.
  [pathGlyph('M7 7h10l-2.5-2.5', 'M17 17H7l2.5 2.5', 'M17 7v4', 'M7 17v-4'), 'repeat'],
  [pathGlyph('M20.8 8.2c0 5-8.8 10.3-8.8 10.3S3.2 13.2 3.2 8.2A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 8.8 1.4Z'), 'heart'],
  [pathGlyph('M12 4v11', 'm8 8 4-4 4 4', 'M5 13v6h14v-6'), 'share-0-1'],
  [pathGlyph('M4 8h16', 'M8 16h12'), 'more-horizontal'],
  [pathGlyph('M5 12h.01M12 12h.01M19 12h.01'), 'more-horizontal'],
  [pathGlyph('M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14'), 'delete-0-2'],
  [pathGlyph('M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3Zm0 0 4-7c.7-1.1 2.5-.6 2.4.8L13 8h5.3a2.7 2.7 0 0 1 2.6 3.4l-1.8 7A3.5 3.5 0 0 1 15.7 21H7V10Z'), 'thumbs-up'],
  [pathGlyph('M7 14V3H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3Zm0 0 4 7c.7 1.1 2.5.6 2.4-.8L13 16h5.3a2.7 2.7 0 0 0 2.6-3.4l-1.8-7A3.5 3.5 0 0 0 15.7 3H7v11Z'), 'thumbs-down'],
  [pathGlyph('M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z'), 'message-0-1'],
  // src/messages-media-ui.js and src/messages-whatsapp-ui.js.
  [pathGlyph('M7 3h7l5 5v13H7z', 'M14 3v6h5'), 'file-0-1'],
  [pathGlyph('M6 6l12 12', 'M18 6 6 18'), 'cancel-0-1'],
  [pathGlyph('M9 6l9 6-9 6z'), 'play'],
  [pathGlyph('M8.5 12.5 14 7a3 3 0 0 1 4.2 4.2l-7.4 7.4a5 5 0 0 1-7.1-7.1l7.8-7.8', 'M6.5 13.5 14.5 5.5'), 'attachment-0-1'],
  [pathGlyph('M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z', 'M5.5 11.5a6.5 6.5 0 0 0 13 0', 'M12 18v3', 'M9 21h6'), 'mic-0-1'],
  [pathGlyph('M22 2 15 22 11 13 2 9 22 2Z', 'M22 2 11 13'), 'send'],
  // src/sautilink-video-player.js and src/post-media-carousel.js.
  [pathGlyph('M8 5v14l11-7Z'), 'play'],
  [pathGlyph('M8 5v14M16 5v14'), 'pause'],
  [pathGlyph('M7.5 8H3.8V4.3', 'M4 8a8 8 0 1 1-.4 7'), 'refresh-0-1'],
  [pathGlyph('M5 10v4h3l4 3V7l-4 3H5Z', 'm16 9 5 6M21 9l-5 6'), 'volume-off'],
  [pathGlyph('M5 10v4h3l4 3V7l-4 3H5Z', 'M15.5 9.5a3.6 3.6 0 0 1 0 5M18.3 7a7 7 0 0 1 0 10'), 'volume-high'],
  [pathGlyph('M5 10v4h3l4 3V7l-4 3H5Z', 'm16 9 5 6', 'm21 9-5 6'), 'volume-off'],
  [pathGlyph('M5 10v4h3l4 3V7l-4 3H5Z', 'M15.5 9.5a3.6 3.6 0 0 1 0 5', 'M18.3 7a7 7 0 0 1 0 10'), 'volume-high'],
  [pathGlyph('M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4'), 'full-screen'],
  [pathGlyph('M4 6h16v12H4Z', 'M12.5 11.5h6v4.5h-6Z'), 'lucide:picture-in-picture'],
  [pathGlyph('m15 18-6-6 6-6'), 'chevron-left'],
  // src/profile-media-upload-icons.js.
  [pathGlyph('M12 15V4m0 0L7.8 8.2M12 4l4.2 4.2', 'M5 14.5v3.1A2.4 2.4 0 0 0 7.4 20h9.2a2.4 2.4 0 0 0 2.4-2.4v-3.1'), 'upload-0-1'],
  // src/composer-formats.js builds the Video tool at member startup.
  ['rect:height=16;rx=3;width=18;x=3;y=4|path:d=M4 9h16M7 4l3 5M13 4l3 5|path:d=m10 12 5 3-5 3v-6Z', 'video-0-1'],
  // src/post-view-metrics.js / src/professional-dashboard.js (control icons only).
  [pathGlyph('M5 19V11', 'M9.7 19V5', 'M14.3 19v-7', 'M19 19V8'), 'analytics-0-1'],
  [pathGlyph('M4 19V10', 'M10 19V5', 'M16 19v-7', 'M22 19V8'), 'analytics-0-1'],
  [pathGlyph('M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z', 'M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Z'), 'eye'],
  [pathGlyph('M4 5h16v11H8l-4 3V5Z', 'M8 9h8M8 12h5'), 'message-0-1'],
  [pathGlyph('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M19 8v6M16 11h6'), 'user-add-0-1'],
  [pathGlyph('M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z', 'M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Z'), 'eye'],
  [pathGlyph('M12 2v20', 'M17 6.5c-1-1-2.5-1.5-4.5-1.5C9.5 5 7 6.4 7 8.5s2 3 5 3.5 5 1.4 5 3.5S14.5 19 11.5 19C9.4 19 7.7 18.4 6.5 17'), 'money-bag-0-1'],
];

export const glyphIcons = Object.freeze(Object.fromEntries([...literalGlyphs, ...generatedGlyphs]));

// profile-activity.js owns category availability and selection. Its build-time
// icon transform prepends a direct SVG before each existing plain-text label.
// Media is a presentation mapping for hosts that already expose that category;
// this map never creates or removes profile tabs.
export const profileActivityTabIcons = Object.freeze({
  posts: 'file-0-1',
  reposts: 'repeat',
  replies: 'message-0-1',
  likes: 'heart',
  saves: 'bookmark',
  hashtags: 'lucide:hash',
  media: 'image-0-1',
});

// All selectors target the native SVG itself. Specific state rules precede
// general ones so Pause/Play and recording never advertise the wrong action.
export const iconRules = Object.freeze([
  { selector: '#message-voice-button.recording > svg', icon: 'activity' },
  { selector: '#message-voice-button > svg', icon: 'mic-0-1' },
  { selector: '#message-attachment-button > svg', icon: 'attachment-0-1' },
  { selector: '#message-send > svg', icon: 'send' },
  { selector: '.sauti-mobile-drawer-settings-toggle > svg:first-child', icon: 'settings-0-1' },
  { selector: '.home-post-menu-toggle > svg, .sauti-head-more > svg, [data-home-post-menu-toggle] > svg, .comment-menu-toggle > svg, [data-comment-menu-toggle] > svg, #profile-more-button > svg, .room-detail-icon-button[aria-controls="room-detail-menu"] > svg', icon: 'more-horizontal' },
  { selector: '.sauti-mobile-more-trigger > svg, .messages-wa-menu-button > svg', icon: 'menu-0-1' },
  { selector: '.messages-wa-thread-menu > summary > svg', icon: 'more-vertical' },
  { selector: '.sauti-video-center-control[aria-label="Replay video"] > svg, .sauti-video-control.play-pause[aria-label="Replay video"] > svg', icon: 'refresh-0-1' },
  { selector: '.sauti-video-center-control[aria-label="Play video"] > svg, .sauti-video-control.play-pause[aria-label="Play video"] > svg', icon: 'play' },
  { selector: '.sauti-video-center-control[aria-label="Pause video"] > svg, .sauti-video-control.play-pause[aria-label="Pause video"] > svg', icon: 'pause' },
  { selector: '.sauti-video-control.audio[aria-label="Unmute video"] > svg, .sauti-video-audio-toggle[aria-label="Unmute video"] > svg', icon: 'volume-off' },
  { selector: '.sauti-video-control.audio[aria-label="Mute video"] > svg, .sauti-video-audio-toggle[aria-label="Mute video"] > svg', icon: 'volume-high' },
  { selector: '.sauti-video-control.fullscreen > svg', icon: 'full-screen' },
  { selector: '.sauti-video-control.pip > svg', icon: 'lucide:picture-in-picture' },
  { selector: 'svg[data-profile-media-upload-icon="true"]', icon: 'upload-0-1' },
  { selector: 'svg[data-profile-media-remove-icon="true"]', icon: 'delete-0-2' },
  { selector: '.profile-route-unavailable-icon', icon: 'security-block' },
  { selector: '[data-comment-reaction="like"] > svg', icon: 'thumbs-up' },
  { selector: '[data-comment-reaction="dislike"] > svg', icon: 'thumbs-down' },
  ...Object.entries(profileActivityTabIcons).map(([tab, icon]) => ({ selector: '[data-profile-activity-tab="' + tab + '"] > svg, svg[data-profile-activity-tab-icon="' + tab + '"]', icon })),
  { selector: 'svg[data-profile-activity-privacy-icon="true"]', icon: 'lock-keyhole' },
  ...Object.entries({ like: 'heart', save: 'bookmark', repost: 'repeat', share: 'share-0-1', comments: 'message-0-1' }).map(([action, icon]) => ({ selector: '[data-sauti-action="' + action + '"] > svg', icon })),
  ...Object.entries({ like: 'heart', heart: 'heart', save: 'bookmark', repost: 'repeat', share: 'share-0-1', comment: 'message-0-1' }).map(([action, icon]) => ({ selector: '[data-short-action="' + action + '"] .sauti-short-action-icon > svg', icon })),
  ...Object.entries({ stream: 'home-0-1', discover: 'search', messages: 'message-0-1', notifications: 'notification', circles: 'user-group', saved: 'bookmark', settings: 'settings-0-1', profile: 'user', appeals: 'sautilink:justice-scale', moderation: 'shield-check' }).map(([view, icon]) => ({ selector: '[data-member-view="' + view + '"] > svg:first-child, [data-member-view="' + view + '"] > span[aria-hidden="true"] > svg, [data-mobile-drawer-view="' + view + '"] > svg:first-child', icon })),
  ...Object.entries({ account: 'user', privacy: 'lock-keyhole', playback: 'video-0-1', notifications: 'notification', safety: 'shield-check', data: 'download' }).map(([section, icon]) => ({ selector: '[data-settings-section="' + section + '"] > svg:first-child, [data-mobile-drawer-settings-section="' + section + '"] > svg:first-child', icon })),
]);

/** Glyph text is replaced only when it matches; other words/children survive.
 * pseudo marks existing CSS ::before/::after glyphs, whose content alone is
 * suppressed while the adapter adds an aria-hidden icon in the same position.
 */
export const textIconRules = Object.freeze([
  { selector: '#settings-birth-date-card .settings-card-title strong', glyph: '', decorative: true, icon: 'calendar-0-1' },
  { selector: '#settings-birth-date-fieldset .field-hint', glyph: '', decorative: true, icon: 'lock-keyhole' },
  { selector: '#settings-birth-date-form .birth-date-settings-actions > button', glyph: '', decorative: true, icon: 'check' },
  { selector: '.messages-wa-app-back-chevron, .message-thread-back-chevron', glyph: '‹', icon: 'chevron-left' },
  { selector: '.messages-wa-thread-menu > summary', glyph: '⋮', icon: 'more-vertical' },
  { selector: '.messages-appearance-close, .message-reply-cancel, .composer-trim-close, .post-edit-close, .profile-media-editor-close, .room-post-image-remove', glyph: '×', icon: 'cancel-0-1' },
  { selector: '#circle-back, #message-thread-back', glyph: '←', icon: 'arrow-left-0-2' },
  { selector: '[data-settings-section] > i', glyph: '›', icon: 'chevron-right' },
  { selector: '[data-post-format="bold"] > strong', glyph: 'B', icon: 'text-bold' },
  { selector: '[data-post-format="italic"] > em', glyph: 'I', icon: 'text-italic' },
  { selector: '[data-post-format="underline"] > u', glyph: 'U', icon: 'text-underline' },
  { selector: '[data-post-format="strikethrough"] > s', glyph: 'S', icon: 'text-strikethrough' },
  { selector: '.messages-whatsapp-ui .messages-search', glyph: '⌕', pseudo: 'before', icon: 'search' },
  { selector: '.messages-whatsapp-ui .dm-message:not(.deleted)', glyph: '↩', pseudo: 'after', icon: 'corner-up-left' },
  { selector: '.notification-item[data-circle-slug]', glyph: '›', pseudo: 'after', icon: 'chevron-right' },
  { selector: '.sauti-video-quality-option[aria-checked="true"]', glyph: '✓', pseudo: 'after', icon: 'check' },
  { selector: '.messages-wa-placeholder-mark', glyph: '', decorative: true, icon: 'message-0-1' },
  { selector: '.messages-wa-menu-button', glyph: '', decorative: true, icon: 'menu-0-1' },
]);

export const iconCoverage = Object.freeze({
  family: 'AnimateIcons Huge',
  literalSignatures: literalGlyphs.length,
  generatedSignatures: generatedGlyphs.length,
  auditedSources: ['app/index.html', 'src/app.js', 'src/mobile-more-drawer.js', 'src/mobile-nav-icon-style.js', 'src/professional-profile-category.js', 'src/profile-activity.js', 'src/profile-media-upload-icons.js', 'src/profile-route-states.js', 'src/room-post-images.js', 'src/rooms-facebook-ui.js', 'src/rooms-platform.js', 'src/rooms-invitations.js', 'src/short-videos-feed.js', 'src/messages-media-ui.js', 'src/messages-whatsapp-ui.js', 'src/messages-reply-ui.js', 'src/composer-formats.js', 'src/sautilink-video-player.js', 'src/post-media-carousel.js', 'src/post-view-metrics.js', 'src/professional-dashboard.js', 'src/post-edit.js', 'src/web-push-notifications.js', 'scripts/profile-tab-icons-source-transform.mjs', 'scripts/rooms-startup-isolation-source-transform.mjs', 'scripts/messages-reply-source-transform.mjs', 'app/assets/app.css', 'app/assets/messages-whatsapp.css', 'app/assets/messages-reply.css', 'app/assets/sautilink-video-player.css'],
  unchanged: ['Login and signup/authentication', 'SautiLink and external service trademarks', 'Official verification identity badge', 'Charts, waveform/data visualizations and media content', 'Playback speed and numeric counters', 'Native browser audio controls'],
});
