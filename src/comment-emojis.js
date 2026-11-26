export const COMMENT_EMOJIS = Object.freeze(['❤️', '🙌', '🔥', '👏', '🥹', '😍', '😮', '😂']);

export function insertCommentEmoji(input, emoji) {
  if (!input || input.disabled || input.readOnly) return false;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const value = input.value.slice(0, start) + emoji + input.value.slice(end);
  if (input.maxLength > 0 && value.length > input.maxLength) return false;
  input.value = value;
  input.setSelectionRange(start + emoji.length, start + emoji.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus({ preventScroll: true });
  return true;
}

export function installCommentEmojis(root = document) {
  function mount(form) {
    const input = form.querySelector('textarea');
    if (!input || form.querySelector('.comment-emoji-suggestions')) return;
    const row = document.createElement('div');
    row.className = 'comment-emoji-suggestions'; row.setAttribute('aria-label', 'Quick emoji');
    for (const emoji of COMMENT_EMOJIS) {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = emoji; button.setAttribute('aria-label', `Insert ${emoji}`);
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', () => insertCommentEmoji(input, emoji)); row.append(button);
    }
    form.prepend(row);
  }
  root.querySelectorAll('#conversation-reply-form, form[data-comment-form]').forEach(mount);
  const feed = root.getElementById('conversation-thread');
  if (feed) new MutationObserver(changes => {
    for (const change of changes) for (const node of change.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches('form[data-comment-form]')) mount(node);
      node.querySelectorAll('form[data-comment-form]').forEach(mount);
    }
  }).observe(feed, { childList: true, subtree: true });
}
