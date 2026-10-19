/* Member-only presentation for confirmations, review notes and action sheets.
 * Native feature handlers keep their original values, permissions and requests. */
(() => {
  'use strict';
  if (window.SautiMemberDialogs) return;

  let active = null;
  let dialog;
  let form;
  let heading;
  let description;
  let input;
  let inputLabel;
  let choices;
  let submit;
  let cancel;
  let badge;
  let observer;
  let fallbackInert = [];

  function memberVisible() {
    const member = document.getElementById('member-view');
    return Boolean(member && !member.hidden && !document.body.classList.contains('auth-entry'));
  }

  function aborted() {
    const error = new Error('The member action was cancelled because its view is no longer available.');
    error.name = 'AbortError';
    return error;
  }

  function icon(name, path) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ width: '22', height: '22', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', 'data-sl-icon-name': name })) svg.setAttribute(key, value);
    const geometry = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    geometry.setAttribute('d', path);
    svg.append(geometry);
    return svg;
  }

  function finish(value, error) {
    if (!active) return;
    const request = active;
    active = null;
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    dialog.removeAttribute('open');
    dialog.removeAttribute('data-builtin-fallback');
    for (const [node, wasInert] of fallbackInert) node.inert = wasInert;
    fallbackInert = [];
    observer?.disconnect();
    observer = null;
    if (memberVisible() && request.focus?.isConnected && !request.focus.disabled && !request.focus.closest('[hidden]')) request.focus.focus({ preventScroll: true });
    if (error) request.reject(error);
    else request.resolve(value);
  }

  function cancelValue() { return active?.kind === 'confirm' ? false : null; }

  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.id = 'member-builtin-dialog';
    dialog.className = 'member-builtin-dialog';
    dialog.setAttribute('data-member-builtin-dialog', '');
    dialog.setAttribute('aria-labelledby', 'member-builtin-dialog-title');
    dialog.setAttribute('aria-describedby', 'member-builtin-dialog-description');
    form = document.createElement('form');
    form.className = 'member-builtin-dialog-form';
    badge = document.createElement('div');
    badge.className = 'member-builtin-dialog-badge';
    heading = document.createElement('h2');
    heading.id = 'member-builtin-dialog-title';
    description = document.createElement('p');
    description.id = 'member-builtin-dialog-description';
    inputLabel = document.createElement('label');
    inputLabel.className = 'member-builtin-dialog-input-label';
    inputLabel.htmlFor = 'member-builtin-dialog-input';
    inputLabel.textContent = 'Review note';
    input = document.createElement('textarea');
    input.id = 'member-builtin-dialog-input';
    input.name = 'review-note';
    input.rows = 4;
    input.setAttribute('aria-describedby', description.id);
    choices = document.createElement('div');
    choices.className = 'member-builtin-dialog-choices';
    const actions = document.createElement('div');
    actions.className = 'member-builtin-dialog-actions';
    cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'member-builtin-dialog-cancel';
    cancel.textContent = 'Cancel';
    submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'member-builtin-dialog-confirm';
    submit.textContent = 'Continue';
    actions.append(cancel, submit);
    form.append(badge, heading, description, inputLabel, input, choices, actions);
    dialog.append(form);
    document.body.append(dialog);

    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!active || active.kind === 'choose') return;
      finish(active.kind === 'prompt' ? input.value : true);
    });
    cancel.addEventListener('click', () => finish(cancelValue()));
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      finish(cancelValue());
    });
    dialog.addEventListener('close', () => { if (active && !dialog.open) finish(cancelValue()); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) finish(cancelValue());
    });
    dialog.addEventListener('keydown', event => {
      if (!active) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(cancelValue());
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && active.kind === 'prompt') {
        event.preventDefault();
        event.stopPropagation();
        finish(input.value);
      } else if (event.key === 'Tab' && dialog.hasAttribute('data-builtin-fallback')) {
        const buttons = [...dialog.querySelectorAll('button, textarea')].filter(node => !node.hidden && !node.disabled);
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
  }

  function defaultPresentation(kind, message) {
    if (kind === 'prompt') return { title: 'Review note', label: 'Continue', icon: 'edit-0-2', tone: 'neutral' };
    if (kind === 'choose') return { title: 'Share', label: 'Continue', icon: 'share-0-1', tone: 'neutral' };
    if (/^delete/i.test(message)) return { title: /^Delete this conversation/.test(message) ? 'Remove conversation?' : message.split('?')[0] + '?', label: /^Delete this conversation/.test(message) ? 'Remove' : 'Delete', icon: 'delete-0-2', tone: 'destructive' };
    if (/^block/i.test(message)) return { title: 'Block account?', label: 'Block', icon: 'shield-check', tone: 'destructive' };
    if (/^mute/i.test(message)) return { title: 'Mute account?', label: 'Mute', icon: 'volume-off', tone: 'neutral' };
    if (/^remove/i.test(message)) return { title: 'Remove member?', label: 'Remove', icon: 'user-group', tone: 'destructive' };
    return { title: 'Confirm action', label: 'Continue', icon: 'shield-check', tone: 'neutral' };
  }

  function request(kind, message, options = {}, actionChoices = []) {
    // A navigation or overlapping programmatic request must never accept an action.
    // Rejection also stops the legacy optional-note handler, where null means no note.
    if (!memberVisible() || active) return Promise.reject(aborted());
    ensureDialog();
    options ||= {};
    const copy = String(message ?? '');
    const presentation = { ...defaultPresentation(kind, copy), ...options };
    heading.textContent = String(presentation.title);
    description.textContent = copy;
    dialog.dataset.tone = presentation.tone;
    dialog.dataset.kind = kind;
    badge.replaceChildren(icon(presentation.icon, 'M12 3 4 7v5c0 4 3 7 8 9 5-2 8-5 8-9V7l-8-4Z'));
    submit.textContent = String(presentation.confirmLabel || presentation.label);
    cancel.textContent = String(presentation.cancelLabel || 'Cancel');
    inputLabel.textContent = String(presentation.inputLabel || 'Review note');
    inputLabel.hidden = input.hidden = kind !== 'prompt';
    input.value = kind === 'prompt' ? String(options.defaultValue ?? '') : '';
    input.placeholder = String(options.placeholder || 'Write your note…');
    choices.hidden = kind !== 'choose';
    submit.hidden = kind === 'choose';
    choices.replaceChildren();
    for (const action of actionChoices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'member-builtin-dialog-choice';
      button.dataset.choice = String(action.value);
      if (action.icon) button.append(icon(action.icon, 'M8 12h8M12 8v8'));
      const text = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = String(action.label);
      text.append(label);
      if (action.description) {
        const detail = document.createElement('small');
        detail.textContent = String(action.description);
        text.append(detail);
      }
      button.append(text);
      button.addEventListener('click', () => finish(action.value));
      choices.append(button);
    }
    return new Promise((resolve, reject) => {
      active = { kind, resolve, reject, focus: document.activeElement };
      observer = new MutationObserver(() => { if (active && !memberVisible()) finish(null, aborted()); });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      observer.observe(document.getElementById('member-view'), { attributes: true, attributeFilter: ['hidden'] });
      try {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else {
          fallbackInert = [...document.body.children].filter(node => node !== dialog).map(node => [node, node.inert]);
          for (const [node] of fallbackInert) node.inert = true;
          dialog.setAttribute('open', '');
          dialog.setAttribute('aria-modal', 'true');
          dialog.setAttribute('data-builtin-fallback', '');
        }
        if (kind === 'prompt') { input.focus(); input.select(); }
        else cancel.focus();
      } catch (error) { finish(null, error); }
    });
  }

  for (const event of ['popstate', 'hashchange', 'pagehide']) window.addEventListener(event, () => { if (active) finish(null, aborted()); });

  window.SautiMemberDialogs = Object.freeze({
    confirm: (message, options) => request('confirm', message, options),
    prompt: (message, options) => request('prompt', message, options),
    choose: (message, actionChoices, options) => request('choose', message, options, actionChoices),
  });
})();
