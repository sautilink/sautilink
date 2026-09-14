const CONVERSATION_UI_STYLESHEETS = [
  '/app/assets/conversation-replies-ui.css?v=20260914-conversation1',
  '/app/assets/conversation-heading-ui.css?v=20260914-conversation1',
];

export function ensureConversationRepliesUiStyles() {
  if (typeof document === 'undefined') return;

  for (const href of CONVERSATION_UI_STYLESHEETS) {
    const pathname = href.split('?')[0];
    if (document.querySelector(`link[href^="${pathname}"]`)) continue;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  }
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
