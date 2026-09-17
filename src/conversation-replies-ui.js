const CONVERSATION_REPLIES_UI_CSS = '/app/assets/conversation-replies-ui.css?v=20260917-comments1';
const SUPABASE_URL = 'https://rggpyiterdbbugluejcs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_omJ-5Mem-K4vgm6WLXRzJQ_jeGs65ca';
const AUTH_STORAGE_KEY = 'sautilink.auth.session';
const COMMENT_CARD_SELECTOR = '#conversation-thread .thread-sauti[data-post-id]';

let dislikeHydrationTimer = 0;
let commentUiInstalled = false;

export function ensureConversationRepliesUiStyles() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[href^="/app/assets/conversation-replies-ui.css"]')) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CONVERSATION_REPLIES_UI_CSS;
  document.head.append(link);
}

function authSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    const session = value?.access_token ? value : value?.currentSession || value?.session || null;
    if (!session?.access_token || !session?.user?.id) return null;
    return session;
  } catch {
    return null;
  }
}

function dislikeHeaders({ json = false, prefer = '' } = {}) {
  const session = authSession();
  if (!session) return null;
  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${session.access_token}`,
    Accept: 'application/json',
  };
  if (json) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  return { headers, session };
}

function commentSvg(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  paths.forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  return svg;
}

function commentThumbIcon(direction) {
  return direction === 'down'
    ? commentSvg([
      'M7 4v10',
      'M7 14H4.5A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4H7',
      'M7 14h7l-1 4.2a1.8 1.8 0 0 0 3.4 1.1L21 10V6.5A2.5 2.5 0 0 0 18.5 4H7',
    ])
    : commentSvg([
      'M7 20V10',
      'M7 10H4.5A1.5 1.5 0 0 0 3 11.5v7A1.5 1.5 0 0 0 4.5 20H7',
      'M7 10h7l-1-4.2a1.8 1.8 0 0 1 3.4-1.1L21 14v3.5a2.5 2.5 0 0 1-2.5 2.5H7',
    ]);
}

function commentReplyIcon() {
  return commentSvg([
    'M9 8 4 12l5 4',
    'M4 12h8.5c4.1 0 6.5 2 7.5 5',
  ]);
}

function commentMoreIcon() {
  return commentSvg(['M4 8h16', 'M8 16h12']);
}

function closeCommentMenus(except = null) {
  document.querySelectorAll('[data-comment-more-menu]').forEach((menu) => {
    if (menu === except) return;
    menu.hidden = true;
    menu.closest('[data-comment-more-shell]')
      ?.querySelector('[data-comment-more-toggle]')
      ?.setAttribute('aria-expanded', 'false');
  });
}

function commentMenuShell(card, saveButton) {
  const postId = String(card.dataset.postId || '');
  const authorId = String(card.dataset.authorId || '');
  const authorName = String(card.dataset.authorName || 'SautiLink member');
  const session = authSession();

  const shell = document.createElement('div');
  shell.className = 'comment-more-shell';
  shell.dataset.commentMoreShell = '';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'comment-more-toggle';
  toggle.dataset.commentMoreToggle = '';
  toggle.setAttribute('aria-label', `More options for ${authorName}'s comment`);
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.append(commentMoreIcon());

  const menu = document.createElement('div');
  menu.className = 'comment-more-menu';
  menu.dataset.commentMoreMenu = '';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  if (saveButton) {
    saveButton.classList.add('comment-menu-item');
    saveButton.setAttribute('role', 'menuitem');
    saveButton.querySelector('svg')?.remove();
    saveButton.querySelector('.sauti-action-count')?.remove();
    const label = saveButton.querySelector('.sauti-action-label');
    if (label) label.textContent = saveButton.dataset.active === 'true' ? 'Saved' : 'Save';
    menu.append(saveButton);
  }

  if (postId && authorId && session?.user?.id !== authorId) {
    const report = document.createElement('button');
    report.type = 'button';
    report.className = 'comment-menu-item danger';
    report.dataset.reportComment = postId;
    report.dataset.reportLabel = `Report comment by ${authorName}`;
    report.setAttribute('role', 'menuitem');
    report.textContent = 'Report';
    menu.append(report);
  }

  shell.append(toggle, menu);
  return shell;
}

function resetActionButton(button, { label, icon, count = true } = {}) {
  if (!button) return null;
  const countNode = button.querySelector('.sauti-action-count');
  button.querySelector('svg')?.remove();
  button.querySelector('.sauti-action-label')?.remove();
  button.prepend(icon);
  if (!count) countNode?.remove();
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

function decorateCommentCard(card) {
  if (!card || card.dataset.commentUiReady === 'true') return;
  const postId = String(card.dataset.postId || '');
  if (!postId) return;

  card.dataset.commentUiReady = 'true';
  card.classList.add('comment-card');

  const identity = card.querySelector('.sauti-card-identity');
  identity?.querySelector('a')?.remove();

  card.querySelector('.sauti-card-meta')?.remove();
  card.querySelector('.sauti-repost-menu')?.remove();
  card.querySelector('.sauti-comments')?.remove();

  const head = card.querySelector('.sauti-card-head');
  const actions = card.querySelector('.sauti-actions');
  const like = actions?.querySelector('[data-sauti-action="like"]');
  const reply = actions?.querySelector('[data-sauti-action="comments"]');
  const save = actions?.querySelector('[data-sauti-action="save"]');

  resetActionButton(like, {
    label: like?.dataset.active === 'true' ? 'Unlike comment' : 'Like comment',
    icon: commentThumbIcon('up'),
  });
  if (like) like.classList.add('comment-like-action');

  resetActionButton(reply, {
    label: 'Reply to comment',
    icon: commentReplyIcon(),
    count: false,
  });
  if (reply) reply.classList.add('comment-reply-action');

  const dislike = document.createElement('button');
  dislike.type = 'button';
  dislike.className = 'sauti-action comment-dislike-action';
  dislike.dataset.commentDislike = postId;
  dislike.dataset.active = 'false';
  dislike.setAttribute('aria-pressed', 'false');
  dislike.setAttribute('aria-label', 'Dislike comment');
  dislike.title = 'Dislike comment';
  dislike.append(commentThumbIcon('down'));
  const dislikeCount = document.createElement('span');
  dislikeCount.className = 'sauti-action-count';
  dislikeCount.dataset.commentDislikeCount = postId;
  dislikeCount.textContent = '';
  dislike.append(dislikeCount);

  if (actions) actions.replaceChildren(like, dislike, reply);

  if (head && !head.querySelector('[data-comment-more-shell]')) {
    head.append(commentMenuShell(card, save));
  }
}

function syncCommentCopy() {
  const label = document.querySelector('.conversation-thread-heading .section-label');
  if (label && label.textContent !== 'Comments') label.textContent = 'Comments';

  const total = document.getElementById('conversation-reply-total');
  if (total) {
    const next = total.textContent
      .replace(/\b1 reply\b/i, '1 comment')
      .replace(/\b(\d+) replies\b/i, '$1 comments');
    if (next !== total.textContent) total.textContent = next;
  }

  const heading = document.getElementById('conversation-reply-heading');
  if (heading && /repl/i.test(heading.textContent)) heading.textContent = 'Comments';

  const empty = document.getElementById('conversation-empty');
  const emptyTitle = empty?.querySelector('h2');
  const emptyCopy = empty?.querySelector('p');
  if (emptyTitle && emptyTitle.textContent !== 'No comments yet.') emptyTitle.textContent = 'No comments yet.';
  if (emptyCopy && emptyCopy.textContent !== 'Start the conversation with a thoughtful comment.') {
    emptyCopy.textContent = 'Start the conversation with a thoughtful comment.';
  }

  const form = document.getElementById('conversation-reply-form');
  const contextLabel = form?.querySelector('.conversation-reply-context span');
  if (contextLabel && contextLabel.textContent !== 'Commenting on') contextLabel.textContent = 'Commenting on';
  const textarea = document.getElementById('conversation-reply-body');
  if (textarea && textarea.placeholder !== 'Write a comment…') textarea.placeholder = 'Write a comment…';
  const submit = document.getElementById('conversation-reply-submit');
  if (submit) {
    if (submit.textContent === 'Reply') submit.textContent = 'Comment';
    if (submit.textContent === 'Replying…') submit.textContent = 'Commenting…';
  }
  const note = document.getElementById('conversation-reply-note');
  if (note) {
    const next = note.textContent
      .replace(/Your reply follows/i, 'Your comment follows')
      .replace(/this reply stays/i, 'this comment stays');
    if (next !== note.textContent) note.textContent = next;
  }

  document.querySelectorAll('#conversation-thread .thread-continue').forEach((button) => {
    const next = button.textContent
      .replace(/\b1 deeper reply\b/i, '1 more comment')
      .replace(/\b(\d+) deeper replies\b/i, '$1 more comments');
    if (next !== button.textContent) button.textContent = next;
  });

  document.querySelectorAll('#conversation-root .sauti-card-context').forEach((node) => {
    const next = node.textContent.replace(/Replies:/g, 'Comments:');
    if (next !== node.textContent) node.textContent = next;
  });

  document.querySelectorAll('#notifications-list .notification-copy p').forEach((node) => {
    const next = node.textContent.replace(/ replied to your post/gi, ' commented on your post');
    if (next !== node.textContent) node.textContent = next;
  });
}

function setDislikeState(card, active, count) {
  const button = card?.querySelector('[data-comment-dislike]');
  const countNode = button?.querySelector('[data-comment-dislike-count]');
  if (!button) return;
  const safeCount = Math.max(0, Number(count) || 0);
  button.dataset.active = String(active);
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? 'Remove dislike from comment' : 'Dislike comment');
  button.title = active ? 'Remove dislike from comment' : 'Dislike comment';
  if (countNode) countNode.textContent = safeCount > 0 ? String(safeCount) : '';
}

async function hydrateDislikeStates() {
  const cards = [...document.querySelectorAll(COMMENT_CARD_SELECTOR)];
  if (!cards.length) return;
  const auth = dislikeHeaders();
  if (!auth) return;

  const ids = [...new Set(cards.map((card) => card.dataset.postId).filter(Boolean))];
  if (!ids.length) return;

  const params = new URLSearchParams();
  params.set('select', 'comment_id,user_id');
  params.set('comment_id', `in.(${ids.join(',')})`);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/social_comment_dislikes?${params}`, {
      headers: auth.headers,
      cache: 'no-store',
    });
    if (!response.ok) return;
    const rows = await response.json().catch(() => []);
    const counts = new Map(ids.map((id) => [id, 0]));
    const mine = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      counts.set(row.comment_id, (counts.get(row.comment_id) || 0) + 1);
      if (row.user_id === auth.session.user.id) mine.add(row.comment_id);
    }
    cards.forEach((card) => setDislikeState(
      card,
      mine.has(card.dataset.postId),
      counts.get(card.dataset.postId) || 0,
    ));
  } catch {
    // Dislikes are non-critical; comments and their existing Like action remain usable.
  }
}

function scheduleDislikeHydration() {
  window.clearTimeout(dislikeHydrationTimer);
  dislikeHydrationTimer = window.setTimeout(() => { void hydrateDislikeStates(); }, 40);
}

async function setCommentDislike(card, button) {
  const commentId = String(button?.dataset.commentDislike || '');
  const auth = dislikeHeaders({ json: true });
  if (!commentId || !auth || button.dataset.pending === 'true') return;

  const active = button.dataset.active === 'true';
  const nextActive = !active;
  const countNode = button.querySelector('[data-comment-dislike-count]');
  const previousCount = Number(countNode?.textContent || 0);
  const nextCount = Math.max(0, previousCount + (nextActive ? 1 : -1));
  const like = card.querySelector('[data-sauti-action="like"]');
  const likeWasActive = like?.dataset.active === 'true';
  const likeCountNode = like?.querySelector('.sauti-action-count');
  const likeCount = Number(likeCountNode?.textContent || 0);

  button.dataset.pending = 'true';
  button.disabled = true;
  setDislikeState(card, nextActive, nextCount);
  if (nextActive && likeWasActive && like) {
    like.dataset.active = 'false';
    like.classList.remove('active');
    like.setAttribute('aria-pressed', 'false');
    like.setAttribute('aria-label', 'Like comment');
    like.title = 'Like comment';
    if (likeCountNode) likeCountNode.textContent = String(Math.max(0, likeCount - 1));
  }

  try {
    let response;
    if (nextActive) {
      response = await fetch(`${SUPABASE_URL}/rest/v1/social_comment_dislikes?on_conflict=comment_id,user_id`, {
        method: 'POST',
        headers: {
          ...auth.headers,
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({ comment_id: commentId, user_id: auth.session.user.id }),
      });
    } else {
      const params = new URLSearchParams({
        comment_id: `eq.${commentId}`,
        user_id: `eq.${auth.session.user.id}`,
      });
      response = await fetch(`${SUPABASE_URL}/rest/v1/social_comment_dislikes?${params}`, {
        method: 'DELETE',
        headers: auth.headers,
      });
    }
    if (!response.ok) throw new Error('COMMENT_DISLIKE_FAILED');
    scheduleDislikeHydration();
  } catch {
    setDislikeState(card, active, previousCount);
    if (likeWasActive && like) {
      like.dataset.active = 'true';
      like.classList.add('active');
      like.setAttribute('aria-pressed', 'true');
      like.setAttribute('aria-label', 'Unlike comment');
      like.title = 'Unlike comment';
      if (likeCountNode) likeCountNode.textContent = String(likeCount);
    }
  } finally {
    button.dataset.pending = 'false';
    button.disabled = false;
  }
}

function syncCommentCards() {
  syncCommentCopy();
  document.querySelectorAll(COMMENT_CARD_SELECTOR).forEach(decorateCommentCard);
  scheduleDislikeHydration();
}

function installConversationRepliesUi() {
  ensureConversationRepliesUiStyles();
  if (commentUiInstalled) return;
  commentUiInstalled = true;

  syncCommentCards();

  const thread = document.getElementById('conversation-surface') || document.body;
  new MutationObserver(() => syncCommentCards()).observe(thread, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest?.('[data-comment-more-toggle]');
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      const menu = toggle.closest('[data-comment-more-shell]')?.querySelector('[data-comment-more-menu]');
      if (!menu) return;
      const opening = menu.hidden;
      closeCommentMenus(menu);
      menu.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      if (opening) menu.querySelector('[role="menuitem"]')?.focus();
      return;
    }

    const dislike = event.target.closest?.('[data-comment-dislike]');
    if (dislike) {
      event.preventDefault();
      event.stopPropagation();
      const card = dislike.closest(COMMENT_CARD_SELECTOR);
      if (card) void setCommentDislike(card, dislike);
      return;
    }

    if (!event.target.closest?.('[data-comment-more-shell]')) closeCommentMenus();
  });

  document.addEventListener('click', (event) => {
    const like = event.target.closest?.(`${COMMENT_CARD_SELECTOR} [data-sauti-action="like"]`);
    if (!like || like.dataset.active === 'true') return;
    const card = like.closest(COMMENT_CARD_SELECTOR);
    const dislike = card?.querySelector('[data-comment-dislike]');
    if (!card || dislike?.dataset.active !== 'true') return;
    const countNode = dislike.querySelector('[data-comment-dislike-count]');
    const current = Number(countNode?.textContent || 0);
    setDislikeState(card, false, Math.max(0, current - 1));
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeCommentMenus();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installConversationRepliesUi, { once: true });
  } else {
    queueMicrotask(installConversationRepliesUi);
  }
}
