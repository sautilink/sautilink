export function placeMediaCaptionAboveGallery(article, caption) {
  const gallery = article.querySelector('.sauti-media-gallery');
  if (!gallery) return;
  const mediaContainer = gallery.closest?.('.sauti-media-carousel-shell') || gallery;
  if (caption.nextElementSibling === mediaContainer) return;
  mediaContainer.before(caption);
}

function placeCardCaption(article) {
  if (!(article instanceof HTMLElement)) return;
  const caption = article.querySelector('.sauti-caption');
  if (caption) placeMediaCaptionAboveGallery(article, caption);
}

function scanPostCaptions(root = document) {
  root.querySelectorAll?.('.sauti-card').forEach(placeCardCaption);
  if (root.matches?.('.sauti-card')) placeCardCaption(root);
  const parentCard = root.closest?.('.sauti-card');
  if (parentCard) placeCardCaption(parentCard);
}

function installPostCaptionPlacement() {
  scanPostCaptions();
  const observer = new MutationObserver((mutations) => {
    const cards = new Set();
    for (const mutation of mutations) {
      const targetCard = mutation.target?.closest?.('.sauti-card');
      if (targetCard) cards.add(targetCard);
      for (const node of mutation.addedNodes || []) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        scanPostCaptions(node);
      }
    }
    cards.forEach(placeCardCaption);
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPostCaptionPlacement, { once: true });
  } else {
    installPostCaptionPlacement();
  }
}
