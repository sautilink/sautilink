const POST_MEDIA_CAROUSEL_STYLESHEET = '/app/assets/post-media-carousel.css';
const HOME_VIDEO_SELECTOR = '.sauti-media-tile video[data-home-autoplay-video]';
const SVG_NS = 'http://www.w3.org/2000/svg';

function ensurePostMediaCarouselStylesheet() {
  if (document.querySelector(`link[href="${POST_MEDIA_CAROUSEL_STYLESHEET}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = POST_MEDIA_CAROUSEL_STYLESHEET;
  link.dataset.sautilinkPostMediaCarousel = 'true';
  document.head.append(link);
}

function carouselCount(gallery) {
  const match = [...gallery.classList].map((name) => name.match(/^media-count-(\d+)$/)).find(Boolean);
  return Number(match?.[1] || 0);
}

function chevronIcon(direction) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', direction === 'prev' ? 'm15 18-6-6 6-6' : 'm9 6 6 6-6 6');
  svg.append(path);
  return svg;
}

function videoAudioIcon(muted) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');

  const speaker = document.createElementNS(SVG_NS, 'path');
  speaker.setAttribute('d', 'M5 10v4h3l4 3V7l-4 3H5Z');
  svg.append(speaker);

  if (muted) {
    const slashOne = document.createElementNS(SVG_NS, 'path');
    slashOne.setAttribute('d', 'm16 9 5 6');
    const slashTwo = document.createElementNS(SVG_NS, 'path');
    slashTwo.setAttribute('d', 'm21 9-5 6');
    svg.append(slashOne, slashTwo);
  } else {
    const waveOne = document.createElementNS(SVG_NS, 'path');
    waveOne.setAttribute('d', 'M15.5 9.5a3.6 3.6 0 0 1 0 5');
    const waveTwo = document.createElementNS(SVG_NS, 'path');
    waveTwo.setAttribute('d', 'M18.3 7a7 7 0 0 1 0 10');
    svg.append(waveOne, waveTwo);
  }

  return svg;
}

function syncVideoAudioToggle(video, control) {
  const muted = video.muted;
  const label = muted ? 'Unmute video' : 'Mute video';
  control.setAttribute('aria-label', label);
  control.setAttribute('title', label);
  control.setAttribute('aria-pressed', muted ? 'false' : 'true');
  control.replaceChildren(videoAudioIcon(muted));
}

function enhancePostVideoAudioToggle(video) {
  if (!(video instanceof HTMLVideoElement) || video.dataset.audioToggleReady === 'true') return;
  const tile = video.closest('.sauti-media-tile');
  if (!tile) return;

  video.dataset.audioToggleReady = 'true';

  const control = document.createElement('span');
  control.className = 'sauti-video-audio-toggle';
  control.dataset.videoAudioToggle = 'true';
  control.setAttribute('role', 'button');
  control.setAttribute('tabindex', '0');

  const stopPointerEvent = (event) => event.stopPropagation();
  control.addEventListener('pointerdown', stopPointerEvent);
  control.addEventListener('pointerup', stopPointerEvent);
  control.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    video.muted = !video.muted;
    video.defaultMuted = video.muted;
    syncVideoAudioToggle(video, control);
  });
  control.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    video.muted = !video.muted;
    video.defaultMuted = video.muted;
    syncVideoAudioToggle(video, control);
  });
  video.addEventListener('volumechange', () => syncVideoAudioToggle(video, control));

  syncVideoAudioToggle(video, control);
  tile.append(control);
}

function scanPostVideoAudioToggles(root = document) {
  root.querySelectorAll?.(HOME_VIDEO_SELECTOR).forEach(enhancePostVideoAudioToggle);
  if (root.matches?.(HOME_VIDEO_SELECTOR)) enhancePostVideoAudioToggle(root);
}

function activeCarouselIndex(gallery, total) {
  if (!gallery.clientWidth) return 0;
  return Math.max(0, Math.min(total - 1, Math.round(gallery.scrollLeft / gallery.clientWidth)));
}

function syncCarouselControls(gallery, shell, total) {
  const index = activeCarouselIndex(gallery, total);
  const counter = shell.querySelector('.sauti-media-carousel-counter');
  if (counter) counter.textContent = `${index + 1}/${total}`;

  const prev = shell.querySelector('.sauti-media-carousel-nav.prev');
  const next = shell.querySelector('.sauti-media-carousel-nav.next');
  if (prev) prev.disabled = index <= 0;
  if (next) next.disabled = index >= total - 1;

  shell.querySelectorAll('.sauti-media-carousel-dot').forEach((dot, dotIndex) => {
    const active = dotIndex === index;
    dot.classList.toggle('active', active);
    dot.setAttribute('aria-current', active ? 'true' : 'false');
  });
}

function scrollCarouselTo(gallery, index, total) {
  const target = Math.max(0, Math.min(total - 1, index));
  gallery.scrollTo({
    left: target * gallery.clientWidth,
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

function enhancePostMediaGallery(gallery) {
  if (!gallery || gallery.dataset.carouselReady === 'true') return;
  const total = carouselCount(gallery);
  if (total < 2) return;

  const tiles = [...gallery.children].filter((node) => node.classList?.contains('sauti-media-tile'));
  if (tiles.length !== total) return;

  gallery.dataset.carouselReady = 'true';
  gallery.classList.add('is-carousel');
  gallery.setAttribute('role', 'group');
  gallery.setAttribute('aria-roledescription', 'carousel');
  gallery.setAttribute('aria-label', `Post media, ${total} slides`);

  tiles.forEach((tile, index) => {
    tile.setAttribute('aria-label', `${tile.getAttribute('aria-label') || 'Open post media'} · Slide ${index + 1} of ${total}`);
  });

  const shell = document.createElement('div');
  shell.className = 'sauti-media-carousel-shell';
  gallery.before(shell);
  shell.append(gallery);

  const counter = document.createElement('span');
  counter.className = 'sauti-media-carousel-counter';
  counter.setAttribute('aria-hidden', 'true');
  shell.append(counter);

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'sauti-media-carousel-nav prev';
  prev.setAttribute('aria-label', 'Previous media');
  prev.append(chevronIcon('prev'));

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'sauti-media-carousel-nav next';
  next.setAttribute('aria-label', 'Next media');
  next.append(chevronIcon('next'));
  shell.append(prev, next);

  const dots = document.createElement('div');
  dots.className = 'sauti-media-carousel-dots';
  dots.setAttribute('aria-label', 'Media slides');
  for (let index = 0; index < total; index += 1) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'sauti-media-carousel-dot';
    dot.setAttribute('aria-label', `Go to media ${index + 1}`);
    dot.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      scrollCarouselTo(gallery, index, total);
    });
    dots.append(dot);
  }
  shell.append(dots);

  prev.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    scrollCarouselTo(gallery, activeCarouselIndex(gallery, total) - 1, total);
  });
  next.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    scrollCarouselTo(gallery, activeCarouselIndex(gallery, total) + 1, total);
  });

  let scrollFrame = 0;
  gallery.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => syncCarouselControls(gallery, shell, total));
  }, { passive: true });

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        const index = activeCarouselIndex(gallery, total);
        gallery.scrollLeft = index * gallery.clientWidth;
        syncCarouselControls(gallery, shell, total);
      })
    : null;
  resizeObserver?.observe(gallery);

  syncCarouselControls(gallery, shell, total);
}

function scanPostMediaGalleries(root = document) {
  root.querySelectorAll?.('.sauti-media-gallery').forEach(enhancePostMediaGallery);
  if (root.matches?.('.sauti-media-gallery')) enhancePostMediaGallery(root);
}

function installPostMediaCarousels() {
  ensurePostMediaCarouselStylesheet();
  scanPostMediaGalleries();
  scanPostVideoAudioToggles();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        if (mutation.attributeName === 'class') enhancePostMediaGallery(mutation.target);
        if (mutation.attributeName === 'data-home-autoplay-video') enhancePostVideoAudioToggle(mutation.target);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        scanPostMediaGalleries(node);
        scanPostVideoAudioToggles(node);
      }
      if (mutation.target?.matches?.('.sauti-media-gallery')) enhancePostMediaGallery(mutation.target);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'data-home-autoplay-video'],
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installPostMediaCarousels, { once: true });
} else {
  installPostMediaCarousels();
}
