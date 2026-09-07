const SHORT_VIDEOS_STYLESHEET = '/app/assets/short-videos-feed.css?v=20260907-short1';
const HOME_VIDEO_TILE_SELECTOR = '#stream-feed .sauti-media-tile[data-media-kind="video"][data-media-object-url]';
const SHORT_VIDEOS_ROOT_ID = 'sauti-short-videos';
const SHORT_VIDEO_PREFETCH_DISTANCE = 2;
const SVG_NS = 'http://www.w3.org/2000/svg';

const SHORT_ICONS = Object.freeze({
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"></path>',
  comment: '<path d="M4 5.5h16v11H8l-4 3v-14Z"></path>',
  repost: '<path d="m7 7-3 3 3 3M4 10h11a4 4 0 0 1 4 4v1M17 17l3-3-3-3M20 14H9a4 4 0 0 1-4-4V9"></path>',
  save: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"></path>',
  share: '<path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"></path>',
});

function shortIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${SHORT_ICONS[name] || ''}</svg>`;
}

function ensureShortVideosStylesheet() {
  if (document.querySelector(`link[href="${SHORT_VIDEOS_STYLESHEET}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = SHORT_VIDEOS_STYLESHEET;
  link.dataset.sautilinkShortVideos = 'true';
  document.head.append(link);
}

function profileHrefFor(card) {
  const username = String(card?.dataset.authorUsername || '').trim();
  const existing = card?.querySelector('.sauti-card-head a[href*="/u/"], .sauti-caption-author[href*="/u/"]');
  if (existing?.href) return existing.href;
  return username ? `/u/${encodeURIComponent(username)}` : '/home';
}

function sourceCardForPost(postId) {
  return [...document.querySelectorAll('#stream-feed .sauti-card')]
    .find((card) => card.dataset.postId === postId) || null;
}

function actionSourceFor(card, action) {
  if (!card) return null;
  if (action === 'repost') return card.querySelector('[data-repost-toggle]') || card.querySelector('[data-sauti-action="repost"]');
  return card.querySelector(`[data-sauti-action="${action}"]`);
}

function actionStateSourceFor(card, action) {
  if (!card) return null;
  return card.querySelector(`[data-sauti-action="${action}"]`);
}

function sourceActionCount(card, action) {
  const source = actionStateSourceFor(card, action);
  const count = source?.querySelector('[data-count-for]');
  return count?.textContent?.trim() || '';
}

function createActionButton(action, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sauti-short-action';
  button.dataset.shortAction = action;
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.innerHTML = `<span class="sauti-short-action-icon">${shortIcon(action)}</span><small data-short-action-count></small>`;
  return button;
}

function cloneSourceAvatar(card, target) {
  const source = card?.querySelector('.sauti-card-avatar');
  if (!source || !target) return;
  const clones = [...source.childNodes].map((node) => node.cloneNode(true));
  if (clones.length) target.replaceChildren(...clones);
  else target.textContent = String(card.dataset.authorName || card.dataset.authorUsername || 'S').trim().slice(0, 2);
  target.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
}

function cloneVerificationBadge(card) {
  const source = card?.querySelector('.sauti-card-head .verification-badge, .sauti-caption-author .verification-badge');
  if (!source) return null;
  const badge = source.cloneNode(true);
  badge.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  return badge;
}

function captionForCard(card) {
  const text = card?.querySelector('.sauti-caption-text');
  return String(text?.dataset.fullCaption || text?.textContent || '').trim();
}

function compactCaption(value, limit = 150) {
  const text = String(value || '').trim();
  if (text.length <= limit) return { text, truncated: false };
  const candidate = text.slice(0, limit);
  const breakAt = candidate.lastIndexOf(' ');
  const cutoff = breakAt >= Math.floor(limit * 0.65) ? breakAt : limit;
  return { text: `${text.slice(0, cutoff).trimEnd()}…`, truncated: true };
}

function createShortVideoSlide(tile) {
  const card = tile.closest('.sauti-card');
  if (!card) return null;
  const postId = String(card.dataset.postId || '');
  const mediaId = String(tile.dataset.openMediaId || tile.dataset.mediaObjectUrl || 'video');
  const key = `${postId}:${mediaId}`;
  const username = String(card.dataset.authorUsername || 'member');
  const displayName = String(card.dataset.authorName || username || 'SautiLink member');
  const profileHref = profileHrefFor(card);
  const captionValue = captionForCard(card);
  const caption = compactCaption(captionValue);
  const sourceVideo = tile.querySelector('video');

  const slide = document.createElement('article');
  slide.className = 'sauti-short-video-slide';
  slide.dataset.shortVideoKey = key;
  slide.dataset.postId = postId;
  slide.dataset.authorId = String(card.dataset.authorId || '');
  slide.setAttribute('aria-label', `Short video by @${username}`);

  const stage = document.createElement('div');
  stage.className = 'sauti-short-video-stage';

  const frame = document.createElement('div');
  frame.className = 'sauti-media-tile sauti-short-video-frame';
  frame.dataset.mediaKind = 'video';

  const video = document.createElement('video');
  video.src = tile.dataset.mediaObjectUrl;
  video.playsInline = true;
  video.preload = 'metadata';
  video.loop = true;
  video.muted = sourceVideo?.muted ?? true;
  video.defaultMuted = video.muted;
  if (sourceVideo?.poster) video.poster = sourceVideo.poster;
  video.setAttribute('aria-label', tile.dataset.mediaAlt ? `Video: ${tile.dataset.mediaAlt}` : `Video by @${username}`);
  frame.append(video);
  stage.append(frame);

  const profile = document.createElement('div');
  profile.className = 'sauti-short-profile';

  const avatar = document.createElement('a');
  avatar.className = 'sauti-short-avatar';
  avatar.href = profileHref;
  avatar.setAttribute('aria-label', `View @${username} profile`);
  cloneSourceAvatar(card, avatar);

  const identity = document.createElement('div');
  identity.className = 'sauti-short-identity';
  const nameRow = document.createElement('div');
  nameRow.className = 'sauti-short-name-row';
  const nameLink = document.createElement('a');
  nameLink.href = profileHref;
  nameLink.className = 'sauti-short-name';
  nameLink.textContent = displayName;
  nameRow.append(nameLink);
  const badge = cloneVerificationBadge(card);
  if (badge) nameRow.append(badge);

  const usernameLink = document.createElement('a');
  usernameLink.href = profileHref;
  usernameLink.className = 'sauti-short-username';
  usernameLink.textContent = `@${username}`;
  identity.append(nameRow, usernameLink);

  const sourceFollow = card.querySelector('[data-home-follow]');
  let follow = null;
  if (sourceFollow) {
    follow = document.createElement('button');
    follow.type = 'button';
    follow.className = 'sauti-short-follow';
    follow.dataset.shortFollow = '';
    profile.append(avatar, identity, follow);
  } else {
    profile.append(avatar, identity);
  }

  const captionNode = document.createElement('p');
  captionNode.className = 'sauti-short-caption';
  const captionText = document.createElement('span');
  captionText.textContent = caption.text;
  captionText.dataset.fullCaption = captionValue;
  captionText.dataset.previewCaption = caption.text;
  captionNode.append(captionText);
  if (caption.truncated) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'sauti-short-caption-more';
    more.dataset.shortCaptionMore = '';
    more.setAttribute('aria-expanded', 'false');
    more.textContent = 'more';
    captionNode.append(document.createTextNode(' '), more);
  }

  const meta = document.createElement('div');
  meta.className = 'sauti-short-meta';
  meta.append(profile);
  if (captionValue) meta.append(captionNode);

  const rail = document.createElement('div');
  rail.className = 'sauti-short-actions';
  rail.setAttribute('aria-label', 'Post actions');
  rail.append(
    createActionButton('heart', 'Like video'),
    createActionButton('comment', 'View comments'),
    createActionButton('repost', 'Repost video'),
    createActionButton('save', 'Save video'),
    createActionButton('share', 'Share video'),
  );
  rail.querySelector('[data-short-action="heart"]').dataset.shortAction = 'like';
  rail.querySelector('[data-short-action="comment"]').dataset.shortAction = 'comments';

  slide.append(stage, meta, rail);
  return slide;
}

function syncSlideFromSource(slide) {
  const card = sourceCardForPost(slide?.dataset.postId);
  if (!card) return;

  const follow = slide.querySelector('[data-short-follow]');
  const sourceFollow = card.querySelector('[data-home-follow]');
  if (follow && sourceFollow) {
    const following = sourceFollow.dataset.following === 'true';
    follow.textContent = following ? 'Following' : 'Follow';
    follow.classList.toggle('following', following);
    follow.dataset.following = String(following);
    follow.disabled = sourceFollow.disabled;
    follow.setAttribute('aria-pressed', String(following));
    follow.setAttribute('aria-busy', sourceFollow.getAttribute('aria-busy') || 'false');
  }

  for (const action of ['like', 'comments', 'repost', 'save', 'share']) {
    const button = slide.querySelector(`[data-short-action="${action}"]`);
    if (!button) continue;
    const source = actionStateSourceFor(card, action);
    const active = source?.dataset.active === 'true';
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', ['like', 'repost', 'save'].includes(action) ? String(active) : 'false');
    const count = button.querySelector('[data-short-action-count]');
    if (count) {
      count.textContent = sourceActionCount(card, action);
      count.hidden = !count.textContent;
    }
  }
}

function installShortVideosFeed() {
  if (document.getElementById(SHORT_VIDEOS_ROOT_ID)) return;
  ensureShortVideosStylesheet();

  const root = document.createElement('section');
  root.id = SHORT_VIDEOS_ROOT_ID;
  root.className = 'sauti-short-videos';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Short Videos');
  root.innerHTML = `
    <header class="sauti-short-videos-header">
      <button class="sauti-short-close" type="button" aria-label="Close Short Videos">${shortIcon('close')}</button>
      <strong>Short Videos</strong>
      <span aria-hidden="true"></span>
    </header>
    <div class="sauti-short-videos-track" tabindex="0" aria-label="Short Videos feed"></div>`;
  document.body.append(root);

  const track = root.querySelector('.sauti-short-videos-track');
  const close = root.querySelector('.sauti-short-close');
  const slides = new Map();
  let restoreFocus = null;
  let observer = null;
  let sourceObserver = null;
  let streamStateObserver = null;
  let loadTimer = 0;
  let loadingMore = false;
  let endSlide = null;
  let pausedHomeVideos = [];

  function videoSlides() {
    return [...track.querySelectorAll('.sauti-short-video-slide')];
  }

  function endIsKnown() {
    const streamMore = document.getElementById('stream-more');
    return Boolean(streamMore && streamMore.hidden);
  }

  function removeEndSlide() {
    endSlide?.remove();
    endSlide = null;
  }

  function ensureEndSlide() {
    if (!endIsKnown() || endSlide || !slides.size) return;
    endSlide = document.createElement('article');
    endSlide.className = 'sauti-short-video-end';
    endSlide.setAttribute('aria-label', 'End of Short Videos');
    endSlide.innerHTML = '<div><strong>You’re all caught up.</strong><p>You’ve seen the latest short videos for now.</p></div>';
    track.append(endSlide);
  }

  function observeSlide(slide) {
    observer?.observe(slide);
  }

  function addAvailableSlides() {
    removeEndSlide();
    document.querySelectorAll(HOME_VIDEO_TILE_SELECTOR).forEach((tile) => {
      const card = tile.closest('.sauti-card');
      if (!card) return;
      const key = `${card.dataset.postId || ''}:${tile.dataset.openMediaId || tile.dataset.mediaObjectUrl || 'video'}`;
      if (slides.has(key)) {
        syncSlideFromSource(slides.get(key));
        return;
      }
      const slide = createShortVideoSlide(tile);
      if (!slide) return;
      slides.set(key, slide);
      track.append(slide);
      observeSlide(slide);
      syncSlideFromSource(slide);
    });
    ensureEndSlide();
  }

  function pauseShortVideos(except = null) {
    track.querySelectorAll('.sauti-short-video-frame video').forEach((video) => {
      if (video !== except) video.pause();
    });
  }

  function activeSlideIndex() {
    const list = videoSlides();
    if (!list.length) return -1;
    const viewportMiddle = track.scrollTop + (track.clientHeight / 2);
    let closest = 0;
    let distance = Infinity;
    list.forEach((slide, index) => {
      const middle = slide.offsetTop + (slide.offsetHeight / 2);
      const nextDistance = Math.abs(middle - viewportMiddle);
      if (nextDistance < distance) {
        distance = nextDistance;
        closest = index;
      }
    });
    return closest;
  }

  function requestMoreIfNeeded(index = activeSlideIndex()) {
    const list = videoSlides();
    if (index < 0 || index < list.length - 1 - SHORT_VIDEO_PREFETCH_DISTANCE || endIsKnown() || loadingMore) return;
    const streamMore = document.getElementById('stream-more');
    const loadMore = document.getElementById('stream-load-more');
    if (!streamMore || streamMore.hidden || !loadMore || loadMore.disabled) return;
    loadingMore = true;
    loadMore.click();
    window.clearTimeout(loadTimer);
    loadTimer = window.setTimeout(() => {
      loadingMore = false;
      addAvailableSlides();
      if (!endIsKnown() && activeSlideIndex() >= videoSlides().length - 1 - SHORT_VIDEO_PREFETCH_DISTANCE) {
        requestMoreIfNeeded();
      }
    }, 900);
  }

  function activateSlide(slide) {
    if (!slide || root.hidden) return;
    videoSlides().forEach((item) => item.classList.toggle('active', item === slide));
    const video = slide.querySelector('.sauti-short-video-frame video');
    pauseShortVideos(video);
    if (video && video.dataset.sautiUserPaused !== 'true') video.play().catch(() => {});
    const index = videoSlides().indexOf(slide);
    requestMoreIfNeeded(index);
  }

  function pauseHomePlayback() {
    pausedHomeVideos = [...document.querySelectorAll('#stream-feed video')]
      .filter((video) => !video.paused)
      .map((video) => ({ video, time: video.currentTime }));
    document.querySelectorAll('#stream-feed video').forEach((video) => {
      video.dataset.sautiShortVideosPaused = 'true';
      video.dataset.sautiUserPaused = 'true';
      video.pause();
    });
  }

  function restoreHomePlayback() {
    document.querySelectorAll('#stream-feed video[data-sauti-short-videos-paused]').forEach((video) => {
      delete video.dataset.sautiShortVideosPaused;
      delete video.dataset.sautiUserPaused;
    });
    const previous = pausedHomeVideos.find(({ video }) => video.isConnected);
    pausedHomeVideos = [];
    previous?.video.play().catch(() => {});
  }

  function openShortVideos(tile) {
    addAvailableSlides();
    const card = tile.closest('.sauti-card');
    const key = `${card?.dataset.postId || ''}:${tile.dataset.openMediaId || tile.dataset.mediaObjectUrl || 'video'}`;
    const slide = slides.get(key);
    if (!slide) return;

    restoreFocus = tile;
    pauseHomePlayback();
    root.hidden = false;
    document.documentElement.classList.add('sauti-short-videos-open');
    root.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      track.scrollTop = slide.offsetTop;
      activateSlide(slide);
      track.focus({ preventScroll: true });
    });
  }

  function closeShortVideos({ restore = true } = {}) {
    if (root.hidden) return;
    pauseShortVideos();
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('sauti-short-videos-open');
    restoreHomePlayback();
    if (restore && restoreFocus instanceof HTMLElement && restoreFocus.isConnected) {
      restoreFocus.focus({ preventScroll: true });
    }
  }

  observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible?.intersectionRatio >= 0.62) activateSlide(visible.target);
  }, { root: track, threshold: [0.2, 0.62, 0.85] });

  const streamFeed = document.getElementById('stream-feed');
  if (streamFeed) {
    sourceObserver = new MutationObserver(() => {
      window.clearTimeout(loadTimer);
      loadTimer = window.setTimeout(() => {
        loadingMore = false;
        addAvailableSlides();
        if (!root.hidden) requestMoreIfNeeded();
      }, 180);
    });
    sourceObserver.observe(streamFeed, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-active', 'data-following'] });
  }

  const streamMore = document.getElementById('stream-more');
  if (streamMore) {
    streamStateObserver = new MutationObserver(() => {
      addAvailableSlides();
      if (!root.hidden) requestMoreIfNeeded();
    });
    streamStateObserver.observe(streamMore, { attributes: true, attributeFilter: ['hidden'] });
  }

  document.addEventListener('click', (event) => {
    const tile = event.target?.matches?.(HOME_VIDEO_TILE_SELECTOR) ? event.target : null;
    if (!tile) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openShortVideos(tile);
  }, true);

  close.addEventListener('click', () => closeShortVideos());

  track.addEventListener('click', (event) => {
    const profileLink = event.target.closest('.sauti-short-profile a');
    if (profileLink) {
      event.preventDefault();
      const href = profileLink.href;
      closeShortVideos({ restore: false });
      window.location.assign(href);
      return;
    }

    const more = event.target.closest('[data-short-caption-more]');
    if (more) {
      const text = more.parentElement?.querySelector('span');
      if (!text) return;
      const expanded = more.getAttribute('aria-expanded') === 'true';
      text.textContent = expanded ? text.dataset.previewCaption : text.dataset.fullCaption;
      more.setAttribute('aria-expanded', String(!expanded));
      more.textContent = expanded ? 'more' : 'less';
      return;
    }

    const follow = event.target.closest('[data-short-follow]');
    if (follow) {
      const slide = follow.closest('.sauti-short-video-slide');
      const source = sourceCardForPost(slide?.dataset.postId)?.querySelector('[data-home-follow]');
      if (source && !source.disabled) {
        source.click();
        queueMicrotask(() => syncSlideFromSource(slide));
      }
      return;
    }

    const action = event.target.closest('[data-short-action]');
    if (!action) return;
    const slide = action.closest('.sauti-short-video-slide');
    const card = sourceCardForPost(slide?.dataset.postId);
    const actionName = action.dataset.shortAction;
    const source = actionSourceFor(card, actionName);
    if (!source || source.disabled) return;

    if (actionName === 'comments') {
      closeShortVideos({ restore: false });
      source.click();
      return;
    }

    source.click();
    window.setTimeout(() => syncSlideFromSource(slide), 0);
  });

  track.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeShortVideos();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) return;
    event.preventDefault();
    const list = videoSlides();
    if (!list.length) return;
    const current = Math.max(0, activeSlideIndex());
    const direction = event.key === 'ArrowDown' || event.key === 'PageDown' ? 1 : -1;
    const target = list[Math.max(0, Math.min(list.length - 1, current + direction))];
    target?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && event.target !== track) {
      event.preventDefault();
      closeShortVideos();
    }
  });

  window.addEventListener('popstate', () => closeShortVideos({ restore: false }));
  addAvailableSlides();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installShortVideosFeed, { once: true });
} else {
  queueMicrotask(installShortVideosFeed);
}
