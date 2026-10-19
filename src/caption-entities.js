import { parsePostFormatting } from './post-text-formatting.js';

const CAPTION_SELECTOR = '.sauti-card-body, .sauti-caption-text, .profile-activity-body';
const PROFILE_BIO_SELECTOR = '#profile-bio';
const ENTITY_SELECTOR = `${CAPTION_SELECTOR}, ${PROFILE_BIO_SELECTOR}`;
const ENTITY_STYLESHEET_ID = 'sautilink-caption-entities-style';
const ENTITY_STYLESHEET_HREF = '/app/assets/caption-entities.css?v=20261016-orange1';
const ENTITY_ATTR = 'data-caption-entity';
const renderedEntities = new WeakMap();
const ENTITY_CANDIDATE_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|@[a-z0-9][a-z0-9._]*|#[\p{L}\p{N}_]+)/giu;

function isMentionBoundary(source, index) {
  if (index === 0) return true;
  return !/[\p{L}\p{N}\p{M}._@]$/u.test(source.slice(0, index));
}

function isHashtagBoundary(source, index) {
  if (index === 0) return true;
  return !/[\p{L}\p{N}\p{M}_]$/u.test(source.slice(0, index));
}

function trimMentionPunctuation(value) {
  return String(value || '').replace(/\.+$/u, '');
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
  const username = trimMentionPunctuation(mention)
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
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
      if (/^[\p{L}\p{N}\p{M}_@]/u.test(source.slice(start + candidate.length))) continue;
      const displayText = trimMentionPunctuation(candidate);
      const href = profileHref(displayText);
      if (!displayText || href === '/discover') continue;
      entities.push({
        type: 'mention',
        start,
        end: start + displayText.length,
        text: displayText,
        href,
      });
      continue;
    }

    if (candidate.startsWith('#')) {
      if (!isHashtagBoundary(source, start)) continue;
      if (/^[\p{L}\p{N}\p{M}_@]/u.test(source.slice(start + candidate.length))) continue;
      const href = hashtagSearchHref(candidate);
      if (href === '/discover') continue;
      entities.push({
        type: 'hashtag',
        start,
        end: start + candidate.length,
        text: candidate,
        href,
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

export function findProfileBioEntities(value) {
  return findCaptionEntities(value).filter(
    (entity) => entity.type === 'mention' || entity.type === 'hashtag',
  );
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

function appendEntities(fragment, source, host) {
  const candidates = host.matches(PROFILE_BIO_SELECTOR)
    ? findProfileBioEntities(source)
    : findCaptionEntities(source);
  const entities = candidates.filter((entity) => !previewCutsEntity(host, entity, source));
  let cursor = 0;
  for (const entity of entities) {
    if (entity.start < cursor) continue;
    if (entity.start > cursor) fragment.append(document.createTextNode(source.slice(cursor, entity.start)));
    fragment.append(createEntityAnchor(entity));
    cursor = entity.end;
  }
  if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
  return entities.length > 0;
}

export function appendFormattedPostText(parent, value, host = parent) {
  let changed = false;
  const appendNodes = (target, nodes) => {
    for (const node of nodes) {
      if (node.tag) {
        const element = document.createElement(node.tag);
        appendNodes(element, node.children);
        target.append(element);
        changed = true;
      } else if (node.text) {
        changed = appendEntities(target, node.text, host) || changed;
      }
    }
  };
  appendNodes(parent, parsePostFormatting(value, 0, true));
  return changed;
}

function entityNodeSnapshot(element) {
  const nodes = [];
  const visit = (parent) => {
    for (const child of parent.childNodes) {
      nodes.push(child);
      visit(child);
    }
  };
  visit(element);
  return nodes;
}

function restoreEntityTextNodes(parent, host) {
  let changed = false;
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const fragment = document.createDocumentFragment();
      if (appendEntities(fragment, child.textContent || '', host)) {
        child.replaceWith(fragment);
        changed = true;
      }
    } else if (child instanceof Element && child.tagName !== 'A') {
      changed = restoreEntityTextNodes(child, host) || changed;
    }
  }
  return changed;
}

export function renderCaptionEntities(element) {
  if (typeof Element === 'undefined' || !(element instanceof Element)) return false;
  if (!element.matches(ENTITY_SELECTOR)) return false;

  const source = element.textContent || '';
  const currentNodes = entityNodeSnapshot(element);
  const previous = renderedEntities.get(element);
  if (previous?.text === source
    && previous.nodes.length === currentNodes.length
    && previous.nodes.every((node, index) => node === currentNodes[index])) return false;
  const fragment = document.createDocumentFragment();
  const repairOnly = previous?.text === source;
  const changed = repairOnly
    ? restoreEntityTextNodes(element, element)
    : element.matches(PROFILE_BIO_SELECTOR)
      ? appendEntities(fragment, source, element)
      : appendFormattedPostText(fragment, source, element);
  element.dataset.captionEntitiesText = source;
  element.dataset.captionEntitiesRenderedText = source;
  if (changed && !repairOnly) element.replaceChildren(fragment);
  element.dataset.captionEntitiesRenderedText = element.textContent || '';
  renderedEntities.set(element, {
    text: element.textContent || '',
    nodes: changed ? entityNodeSnapshot(element) : currentNodes,
  });
  return changed;
}

function ensureEntityStylesheet() {
  if (document.getElementById(ENTITY_STYLESHEET_ID)) return;
  const link = document.createElement('link');
  link.id = ENTITY_STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = ENTITY_STYLESHEET_HREF;
  (document.head || document.documentElement).append(link);
}

function scanCaptionRoot(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const host = root.parentElement?.closest(ENTITY_SELECTOR);
    if (host) renderCaptionEntities(host);
    return;
  }
  if (!(root instanceof Element) && root !== document) return;
  if (root instanceof Element && root.matches(ENTITY_SELECTOR)) {
    renderCaptionEntities(root);
  }
  root.querySelectorAll?.(ENTITY_SELECTOR).forEach(renderCaptionEntities);
}

function initCaptionEntities() {
  ensureEntityStylesheet();
  scanCaptionRoot(document);

  const observedRoot = document.body || document.documentElement;
  if (!observedRoot || typeof MutationObserver === 'undefined') return;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const host = mutation.target instanceof Element
        ? mutation.target.closest(ENTITY_SELECTOR)
        : mutation.target.parentElement?.closest(ENTITY_SELECTOR);
      if (host) renderCaptionEntities(host);
      mutation.addedNodes.forEach(scanCaptionRoot);
    }
  });

  observer.observe(observedRoot, { childList: true, characterData: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCaptionEntities, { once: true });
  } else {
    initCaptionEntities();
  }
}
