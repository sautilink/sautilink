const CONVERSATION_REPLIES_UI_CSS = '/app/assets/conversation-replies-ui.css?v=20260917-homefeeds1';

export function ensureConversationRepliesUiStyles() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[href^="/app/assets/conversation-replies-ui.css"]')) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CONVERSATION_REPLIES_UI_CSS;
  document.head.append(link);
}

function installConversationRepliesUi() {
  ensureConversationRepliesUiStyles();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installConversationRepliesUi, { once: true });
  } else {
    queueMicrotask(installConversationRepliesUi);
  }
}
