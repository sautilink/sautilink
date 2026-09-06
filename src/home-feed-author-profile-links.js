const HOME_FEED_SELECTOR = '#stream-feed';
const HOME_CARD_SELECTOR = '.sauti-card';
const HOME_AUTHOR_USERNAME_SELECTOR = '.sauti-card-identity a[href^="/u/"]';
const HOME_AUTHOR_AVATAR_SELECTOR = '.sauti-card-avatar';
const HOME_AUTHOR_NAME_SELECTOR = '.sauti-card-identity .verified-name';

function activateAuthorProfileTarget(target, usernameLink, label) {
  if (!target || !usernameLink || target.dataset.homeAuthorProfileTarget === 'true') return;

  target.dataset.homeAuthorProfileTarget = 'true';
  target.setAttribute('role', 'link');
  target.setAttribute('tabindex', '0');
  target.setAttribute('aria-label', label);

  target.addEventListener('click', (event) => {
    event.stopPropagation();
    usernameLink.click();
  });

  target.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    usernameLink.click();
  });
}

export function bindHomeFeedAuthorProfileLinks(card) {
  if (!(card instanceof Element) || !card.matches(HOME_CARD_SELECTOR)) return;

  const usernameLink = card.querySelector(HOME_AUTHOR_USERNAME_SELECTOR);
  if (!usernameLink) return;

  const username = String(usernameLink.textContent || '').trim() || 'this author';
  const avatar = card.querySelector(HOME_AUTHOR_AVATAR_SELECTOR);
  const name = card.querySelector(HOME_AUTHOR_NAME_SELECTOR);

  activateAuthorProfileTarget(avatar, usernameLink, `View ${username} profile`);
  activateAuthorProfileTarget(name, usernameLink, `View ${username} profile`);
}

function bindCardsWithin(node) {
  if (!(node instanceof Element)) return;
  if (node.matches(HOME_CARD_SELECTOR)) bindHomeFeedAuthorProfileLinks(node);
  node.querySelectorAll(HOME_CARD_SELECTOR).forEach(bindHomeFeedAuthorProfileLinks);
}

function installHomeFeedAuthorProfileLinks() {
  const feed = document.querySelector(HOME_FEED_SELECTOR);
  if (!feed) return;

  feed.querySelectorAll(HOME_CARD_SELECTOR).forEach(bindHomeFeedAuthorProfileLinks);

  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach(bindCardsWithin);
    });
  }).observe(feed, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installHomeFeedAuthorProfileLinks, { once: true });
} else {
  queueMicrotask(installHomeFeedAuthorProfileLinks);
}
