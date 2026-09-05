const CAPTION_SELECTOR = '.sauti-card-body, .sauti-caption-text';
const ENTITY_STYLE_ID = 'sautilink-caption-entities-style';
const ENTITY_ATTR = 'data-caption-entity';
const ENTITY_CANDIDATE_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|@[a-z0-9][a-z0-9._]{2,29}|#[\p{L}\p{N}_]{1,64})/giu;

function isMentionBoundary(source, index) {
  if (index === 0) return true;
  return !/[A-Za-z0-9._@]/.test(source[index - 1]);
}

function isHashtagBoundary(source, index) {
  if (index === 0) return true;
  return !/[\p{L}\p{N}_]/u.test(source[index - 1]);
}

function trimUrlPunctuation(value) {
  let url = String(value || '').replace(/[.,!?;:]+$/u, '');
  const pairs = [
    [')', '(', ')'],
    [']', '[', ']'],
    ['}', '{', '}'],
  ];

  for (const [closer, openerPattern, closerPattern] of pairs) {
    while (url.endsWith(closer)) {
      const openerCount = url.split(openerPattern).length - 1;
      const closerCount = url.split(closerPattern).length - 1;
      if (closerCount <= openerCount) break;
      url = url.slice(0, -1);
    }
  }

  return url;
}

export function hashtagSearchHref(tag) {
  const value = String(tag || '').trim();
  if (!/^#[\p{L}\p{N}_]{1,64}$/u.test(value)) return '/discover';
  return `/discover?q=${encodeURIComponent(value)}`;
}

export function profileHref(mention) {
  const username = String(mention || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._]{2,29}$/.test(username)) return '/discover';
  return `/u/${encodeURIComponent(username)}`;
}

export function externalUrlHref(value) {
  const candidate = trimUrlPunctuation(value);
  const href = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function findCaptionEntities(value) {
  const source = String(value || '');
  const entities = [];
  ENTITY_CANDIDATE_RE.lastIndex = 0;

  let match;
  while ((match = ENTITY_CANDIDATE_RE.exec(source))) {
    const candidate = match[0];
    const start = match.index;

    if (candidate.startsWith('@')) {
      if (!isMentionBoundary(source, start)) continue;
      entities.push({
        type: 'mention',
        start,
        end: start + candidate.length,
        text: candidate,
        href: profileHref(candidate),
      });
      continue;
    }

    if (candidate.startsWith('#')) {
      if (!isHashtagBoundary(source, start)) continue;
      entities.push({
        type: 'hashtag',
        start,
        end: start + candidate.length,
        text: candidate,
        href: hashtagSearchHref(candidate),
      });
      continue;
    }

    const displayText = trimUrlPunctuation(candidate);
    const href = externalUrlHref(displayText);
    if (!displayText || !href) continue;
    entities.push({
      type: 'url',
      start,
      end: start + displayText.length,
      text: displayText,
      href,
    });
  }

  return entities;
}

function previewCutsEntity(element, entity, source) {
  if (!element.classList.contains('sauti-caption-text')) return false;
  if (!source.endsWith('…')) return false;

  const preview = element.dataset.previewCaption || '';
  const full = element.dataset.fullCaption || '';
  if (source !== preview || !full) return false;

  const visiblePrefix = source.slice(0, -1);
  if (!full.startsWith(visiblePrefix) || entity.end !== visiblePrefix.length) return false;

  const next = full[visiblePrefix.length] || '';
  if (!next) return false;
  if (entity.type === 'hashtag') return /[\p{L}\p{N}_]/u.test(next);
  if (entity.type === 'mention') return /[A-Za-z0-9._]/.test(next);
  return !/\s/.test(next);
}

function createEntityAnchor(entity) {
  const anchor = document.createElement('a');
  anchor.className = `sautilink-caption-entity sautilink-caption-${entity.type}`;
  anchor.setAttribute(ENTITY_ATTR, entity.type);
  anchor.href = entity.href;
  anchor.textContent = entity.text;

  if (entity.type === 'mention') {
    anchor.setAttribute('aria-label', `Open ${entity.text} profile`);
  } else if (entity.type === 'hashtag') {
    anchor.setAttribute('aria-label', `Open posts tagged ${entity.text}`);
  } else {
    anchor.setAttribute('aria-label', `Open link ${entity.text}`);
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer nofollow ugc';
  }

  return anchor;
}

export function renderCaptionEntities(element) {
  if (typeof Element === 'undefined' || !(element instanceof Element)) return false;
  if (!element.matches(CAPTION_SELECTOR)) return false;

  const source = element.textContent || '';
  const previousSource = element.dataset.captionEntitiesText || '';
  if (
    previousSource === source &&
    element.querySelector(`[${ENTITY_ATTR}]`)
  ) {
    return false;
  }

  const entities = findCaptionEntities(source).filter(
    (entity) => !previewCutsEntity(element, entity, source),
  );
  element.dataset.captionEntitiesText = source;
  if (!entities.length) return false;

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const entity of entities) {
    if (entity.start < cursor) continue;
    if (entity.start > cursor) {
      fragment.append(document.createTextNode(source.slice(cursor, entity.start)));
    }
    fragment.append(createEntityAnchor(entity));
    cursor = entity.end;
  }
  if (cursor < source.length) {
    fragment.append(document.createTextNode(source.slice(cursor)));
  }

  element.replaceChildren(fragment);
  return true;
}

function injectEntityStyles() {
  if (document.getElementById(ENTITY_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = ENTITY_STYLE_ID;
  style.textContent = `
    .sauti-card-body .sautilink-caption-entity,
    .sauti-caption-text .sautilink-caption-entity {
      color: var(--app-accent);
      text-decoration: none;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    .sauti-card-body .sautilink-caption-hashtag,
    .sauti-card-body .sautilink-caption-mention,
    .sauti-caption-text .sautilink-caption-hashtag,
    .sauti-caption-text .sautilink-caption-mention {
      font-weight: 680;
    }
    .sauti-card-body .sautilink-caption-entity:hover,
    .sauti-caption-text .sautilink-caption-entity:hover {
      color: var(--app-accent-strong);
      text-decoration: underline;
      text-underline-offset: .16em;
    }
    .sauti-card-body .sautilink-caption-url,
    .sauti-caption-text .sautilink-caption-url {
      font-weight: inherit;
    }
    .sauti-card-body .sautilink-caption-entity:focus-visible,
    .sauti-caption-text .sautilink-caption-entity:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: 2px;
      border-radius: 3px;
    }
  `;
  document.head.append(style);
}

function scanCaptionRoot(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const host = root.parentElement?.closest(CAPTION_SELECTOR);
    if (host) renderCaptionEntities(host);
    return;
  }
  if (!(root instanceof Element) && root !== document) return;
  if (root instanceof Element && root.matches(CAPTION_SELECTOR)) {
    renderCaptionEntities(root);
  }
  root.querySelectorAll?.(CAPTION_SELECTOR).forEach(renderCaptionEntities);
}

function initCaptionEntities() {
  injectEntityStyles();
  scanCaptionRoot(document);

  const observedRoot = document.body || document.documentElement;
  if (!observedRoot || typeof MutationObserver === 'undefined') return;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const host = mutation.target instanceof Element
        ? mutation.target.closest(CAPTION_SELECTOR)
        : mutation.target.parentElement?.closest(CAPTION_SELECTOR);
      if (host) renderCaptionEntities(host);
      mutation.addedNodes.forEach(scanCaptionRoot);
    }
  });

  observer.observe(observedRoot, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCaptionEntities, { once: true });
  } else {
    initCaptionEntities();
  }
}
