/* Original SautiLink verified badge artwork, traced to vector from SautiLink-owned PNGs.
   Inline SVG intentionally has no per-badge asset URL. As with all client-side
   markup, the paths remain inspectable in the browser; this is not DRM.
   Verification privilege is enforced by server-originated is_verified/type data.
*/
const SVG_NS = 'http://www.w3.org/2000/svg';
const BADGE_PATH = "M988 426 L963 433 L938 449 L844 542 L825 558 L807 568 L793 572 L773 574 L627 575 L608 580 L594 587 L570 607 L554 631 L549 644 L546 660 L545 806 L543 823 L539 837 L531 852 L517 869 L439 947 L412 978 L404 993 L398 1013 L397 1040 L401 1059 L406 1072 L420 1093 L514 1188 L529 1206 L540 1227 L545 1251 L546 1402 L550 1419 L556 1433 L564 1446 L580 1463 L595 1474 L609 1481 L628 1486 L770 1486 L789 1487 L804 1491 L817 1497 L834 1509 L912 1587 L949 1620 L964 1628 L981 1633 L1015 1634 L1044 1625 L1062 1613 L1165 1511 L1189 1495 L1215 1487 L1371 1486 L1391 1481 L1410 1472 L1433 1452 L1449 1426 L1456 1401 L1457 1256 L1462 1227 L1469 1212 L1484 1192 L1587 1087 L1601 1059 L1604 1047 L1605 1024 L1599 996 L1584 970 L1563 947 L1488 873 L1472 854 L1462 834 L1457 812 L1456 656 L1452 641 L1445 626 L1438 615 L1424 599 L1408 587 L1385 577 L1368 574 L1227 574 L1214 573 L1198 569 L1183 562 L1162 546 L1076 460 L1052 440 L1039 433 L1020 427 Z M1243 875 L1249 892 L1249 909 L1246 919 L1239 931 L986 1249 L969 1267 L962 1272 L945 1278 L925 1278 L913 1274 L905 1269 L772 1137 L760 1122 L754 1107 L753 1088 L756 1076 L762 1065 L769 1057 L784 1046 L798 1042 L815 1042 L829 1047 L840 1055 L927 1141 L933 1142 L953 1119 L1132 894 L1164 858 L1180 849 L1188 847 L1205 847 L1220 852 L1227 857 Z";
const TEAM_STOPS = Object.freeze([
  ['21.00%', '#fa1f56'],
  ['29.30%', '#fa2255'],
  ['38.09%', '#fa3c50'],
  ['45.41%', '#fb4d4d'],
  ['53.71%', '#fa6049'],
  ['62.50%', '#fb7d42'],
  ['72.75%', '#fb8f3e'],
  ['78.12%', '#fb873f'],
]);
let nextGradientId = 0;

const svgNode = (name, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

export function createInlineVerificationSvg(badgeType = 'standard', theme = document.documentElement.dataset.theme) {
  const team = String(badgeType || '').toLowerCase() === 'team';
  const dark = theme !== 'light';
  const svg = svgNode('svg', {
    viewBox: '384 414 1240 1240',
    'aria-hidden': 'true',
    focusable: 'false',
    draggable: 'false',
    'data-sautilink-verification-vector': team ? 'team' : dark ? 'standard-dark' : 'standard-light',
  });
  const path = svgNode('path', { d: BADGE_PATH, 'fill-rule': 'evenodd', 'clip-rule': 'evenodd' });
  if (team) {
    const id = `sautilink-team-verify-gradient-${++nextGradientId}`;
    const defs = svgNode('defs');
    const gradient = svgNode('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' });
    for (const [offset, color] of TEAM_STOPS) {
      gradient.append(svgNode('stop', { offset, 'stop-color': color }));
    }
    defs.append(gradient);
    svg.append(defs);
    path.setAttribute('fill', `url(#${id})`);
  } else if (dark) {
    path.setAttribute('fill', '#ffffff');
    path.setAttribute('stroke', '#30aaf0');
    path.setAttribute('stroke-width', '5');
    path.setAttribute('stroke-linejoin', 'round');
  } else {
    path.setAttribute('fill', '#28a9e3');
  }
  svg.append(path);
  return svg;
}

// Cloned controls discard or namespace DOM IDs. Recreate only badge artwork so
// its paint references resolve to fresh, unique gradients inside each SVG.
// The existing badge wrapper, account status and accessibility label stay put.
export function refreshClonedVerificationSvgs(root) {
  if (!root) return;
  const selector = 'svg[data-sautilink-verification-vector]';
  const vectors = [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  for (const vector of vectors) {
    const type = vector.getAttribute('data-sautilink-verification-vector');
    vector.replaceWith(createInlineVerificationSvg(type === 'team' ? 'team' : 'standard', type === 'standard-dark' ? 'dark' : 'light'));
  }
}

export function mountInlineVerificationSvg(container, badgeType = 'standard') {
  if (!container) return;
  // Only replaces artwork, never the interactive button or its accessibility label.
  container.replaceChildren(createInlineVerificationSvg(badgeType));
  container.dataset.verificationBadgeType = badgeType === 'team' ? 'team' : 'standard';
}
