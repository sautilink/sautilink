const CAPTION_SELECTOR = '.sauti-card-body, .sauti-caption-text';
const PROFILE_BIO_SELECTOR = '#profile-bio';
const ENTITY_SELECTOR = `${CAPTION_SELECTOR}, ${PROFILE_BIO_SELECTOR}`;
const ENTITY_STYLESHEET_ID = 'sautilink-caption-entities-style';
const ENTITY_STYLESHEET_HREF = '/app/assets/caption-entities.css?v=20260909-theme1';
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

function hashtagHref(raw) {
  const tag = String(raw || '').trim();
  return /^#[\p{L}\p{N}_]{1,64}$/u.test(tag)
    ? `/discover?q=${encodeURIComponent(tag)}`
    : '/discover';
}

function mentionHref(raw) {
  const username = trimMentionPunctuation(raw).trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9._]{2,29}$/.test(username)
    ? `/u/${encodeURIComponent(username)}`
    : '/discover';
}

function urlHref(raw) {
  const value = trimUrlPunctuation(raw);
  const normalized = /^www\./i.test(value) ? `https://${value}` : value;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function captionEntities(text) {
  const source = String(text || '');
  const entities = [];
  ENTITY_CANDIDATE_RE.lastIndex = 0;
  let match;
  while ((match = ENTITY_CANDIDATE_RE.exec(source))) {
    const raw = match[0];
    const start = match.index;
    if (raw.startsWith('@')) {
      if (!isMentionBoundary(source, start)) continue;
      const text = trimMentionPunctuation(raw);
      const href = mentionHref(text);
      if (!text || href === '/discover') continue;
      entities.push({ type: 'mention', start, end: start + text.length, text, href });
      continue;
    }
    if (raw.startsWith('#')) {
      if (!isHashtagBoundary(source, start)) continue;
      entities.push({ type: 'hashtag', start, end: start + raw.length, text: raw, href: hashtagHref(raw) });
      continue;
    }
    const text = trimUrlPunctuation(raw);
    const href = urlHref(text);
    if (!text || !href) continue;
    entities.push({ type: 'url', start, end: start + text.length, text, href });
  }
  return entities;
}

function profileBioEntities(text) {
  return captionEntities(text).filter((entity) => entity.type === 'mention' || entity.type === 'hashtag');
}

function previewEntitySpillsIntoHiddenText(element, entity, visibleText) {
  if (!element.classList.contains('sauti-caption-text') || !visibleText.endsWith('\u2026')) return false;
  const previewText = element.dataset.previewCaption || '';
  const fullText = element.dataset.fullCaption || '';
  if (visibleText !== previewText || !fullText) return false;
  const visiblePrefix = visibleText.slice(0, -1);
  if (!fullText.startsWith(visiblePrefix) || entity.end !== visiblePrefix.length) return false;
  const next = fullText[visiblePrefix.length] || '';
  if (!next) return false;
  if (entity.type === 'hashtag') return /[\p{L}\p{N}_]/u.test(next);
  if (entity.type === 'mention') return /[A-Za-z0-9._]/.test(next);
  return !/\s/.test(next);
}

function entityAnchor(entity) {
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

function linkifyCaptionElement(element) {
  if (!(element instanceof Element) || !element.matches(ENTITY_SELECTOR)) return false;
  const text = element.textContent || '';
  if (element.dataset.captionEntitiesText === text && element.querySelector(`[${ENTITY_ATTR}]`)) return false;
  const allEntities = element.matches(PROFILE_BIO_SELECTOR) ? profileBioEntities(text) : captionEntities(text);
  const entities = allEntities.filter((entity) => !previewEntitySpillsIntoHiddenText(element, entity, text));
  element.dataset.captionEntitiesText = text;
  if (!entities.length) return false;

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const entity of entities) {
    if (entity.start < cursor) continue;
    if (entity.start > cursor) fragment.append(document.createTextNode(text.slice(cursor, entity.start)));
    fragment.append(entityAnchor(entity));
    cursor = entity.end;
  }
  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
  element.replaceChildren(fragment);
  return true;
}

function ensureCaptionEntityStyles() {
  if (document.getElementById(ENTITY_STYLESHEET_ID)) return;
  const link = document.createElement('link');
  link.id = ENTITY_STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = ENTITY_STYLESHEET_HREF;
  (document.head || document.documentElement).append(link);
}

function scanCaptionEntities(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const parent = root.parentElement?.closest(ENTITY_SELECTOR);
    if (parent) linkifyCaptionElement(parent);
    return;
  }
  if (!(root instanceof Element) && root !== document) return;
  if (root instanceof Element && root.matches(ENTITY_SELECTOR)) linkifyCaptionElement(root);
  root.querySelectorAll?.(ENTITY_SELECTOR).forEach(linkifyCaptionElement);
}

function startCaptionEntityEnhancer() {
  ensureCaptionEntityStyles();
  scanCaptionEntities(document);
  const target = document.body || document.documentElement;
  if (!target || typeof MutationObserver === 'undefined') return;
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const parent = mutation.target instanceof Element
        ? mutation.target.closest(ENTITY_SELECTOR)
        : mutation.target.parentElement?.closest(ENTITY_SELECTOR);
      if (parent) linkifyCaptionElement(parent);
      mutation.addedNodes.forEach(scanCaptionEntities);
    }
  }).observe(target, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCaptionEntityEnhancer, { once: true });
  } else {
    startCaptionEntityEnhancer();
  }
}
