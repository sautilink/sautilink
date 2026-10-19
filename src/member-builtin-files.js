/* Branded file fields. The original input owns files, validation and events. */
(() => {
  'use strict';
  const fields = new Map();
  let sequence = 0;
  let queued = false;
  const setAttribute = (node, name, value) => {
    if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
  };
  const memberVisible = () => {
    const member = document.getElementById('member-view');
    return Boolean(member && !member.hidden && !document.body.classList.contains('auth-entry'));
  };
  const excluded = (input) => Boolean(input.closest('#auth-view, #login-panel, #signup-panel'));
  function restore(field) {
    const { input, wrapper, previous } = field;
    input.classList.remove('sl-file-native');
    for (const name of ['tabindex', 'aria-hidden']) {
      if (previous[name] === null) input.removeAttribute(name);
      else setAttribute(input, name, previous[name]);
    }
    input.removeEventListener('change', field.onChange);
    input.removeEventListener('input', field.onChange);
    if (input.parentNode === wrapper && wrapper.parentNode) wrapper.replaceWith(input);
    else wrapper.remove();
    fields.delete(input);
  }
  function sync(field) {
    const { input, wrapper, trigger, caption, summary } = field;
    const hidden = input.hidden || input.style.display === 'none' || input.style.visibility === 'hidden';
    if (wrapper.hidden !== hidden) wrapper.hidden = hidden;
    const disabled = input.disabled || input.matches(':disabled');
    if (trigger.disabled !== disabled) trigger.disabled = disabled;
    const imageOnly = /^image\//i.test(input.accept || '') && !/(?:video|audio|application)\//i.test(input.accept);
    const action = imageOnly ? (input.multiple ? 'Choose photos' : 'Choose photo') : (input.multiple ? 'Choose files' : 'Choose file');
    if (caption.textContent !== action) caption.textContent = action;
    setAttribute(trigger, 'aria-label', field.label ? `${action}: ${field.label}` : action);
    const names = Array.from(input.files || [], (file) => file.name);
    const description = names.length ? names.join(', ') : (input.multiple ? 'No files chosen' : 'No file chosen');
    if (summary.textContent !== description) summary.textContent = description;
  }
  function enhance(input) {
    // Hidden file inputs already have purpose-built composer/avatar triggers.
    if (fields.has(input) || input.hidden || input.closest('[hidden]') || excluded(input)) return;
    const style = window.getComputedStyle(input);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const wrapper = document.createElement('span');
    wrapper.className = 'sl-file';
    wrapper.setAttribute('data-sl-built-in', 'file');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'sl-file-trigger';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('data-sl-icon-name', 'upload-0-1');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 16V3m-4 4 4-4 4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5');
    icon.append(path);
    const caption = document.createElement('span');
    trigger.append(icon, caption);
    const summary = document.createElement('span');
    summary.className = 'sl-file-summary';
    summary.id = `sl-file-summary-${++sequence}`;
    summary.setAttribute('aria-live', 'polite');
    const previous = { tabindex: input.getAttribute('tabindex'), 'aria-hidden': input.getAttribute('aria-hidden') };
    const label = input.getAttribute('aria-label') || Array.from(input.labels || [], (node) => node.textContent.trim()).join(' ') || '';
    const description = [input.getAttribute('aria-describedby'), summary.id].filter(Boolean).join(' ');
    trigger.setAttribute('aria-describedby', description);
    if (input.id) trigger.setAttribute('aria-controls', input.id);
    const field = { input, wrapper, trigger, caption, summary, previous, label, onChange: () => sync(field) };
    fields.set(input, field);
    input.before(wrapper);
    wrapper.append(input, trigger, summary);
    input.classList.add('sl-file-native');
    input.setAttribute('tabindex', '-1');
    input.setAttribute('aria-hidden', 'true');
    trigger.addEventListener('click', () => {
      if (memberVisible() && !input.disabled && !input.matches(':disabled')) input.click();
    });
    input.addEventListener('change', field.onChange);
    input.addEventListener('input', field.onChange);
    sync(field);
  }
  function refresh() {
    const active = memberVisible();
    for (const field of fields.values()) {
      if (!active || !field.input.isConnected || field.input.parentNode !== field.wrapper || excluded(field.input)) restore(field);
      else sync(field);
    }
    if (active) document.querySelectorAll('input[type="file"]').forEach(enhance);
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; refresh(); });
  }
  function start() {
    refresh();
    new MutationObserver(schedule).observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['hidden', 'class', 'style', 'disabled', 'multiple', 'accept', 'aria-label'],
    });
    document.addEventListener('reset', schedule, true);
    document.addEventListener('focusin', schedule, true);
    window.SautiMemberFiles = Object.freeze({ refresh });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
