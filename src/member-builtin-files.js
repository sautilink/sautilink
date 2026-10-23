/* Branded file fields. The original input owns files, validation and events. */
(() => {
  'use strict';
  const fields = new Map();
  let sequence = 0;
  let queued = false;
  let previousMemberVisible;
  let refreshAll = false;
  const refreshRoots = new Set();
  const selector = 'input[type="file"]';
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
  function enhance(input, styleChecked = false) {
    // Hidden file inputs already have purpose-built composer/avatar triggers.
    if (fields.has(input) || input.hidden || input.closest('[hidden]') || excluded(input)) return;
    if (!styleChecked) {
      const style = window.getComputedStyle(input);
      if (style.display === 'none' || style.visibility === 'hidden') return;
    }
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
  function refresh(scopes = [document]) {
    const active = memberVisible();
    for (const field of fields.values()) {
      if (!active || !field.input.isConnected || field.input.parentNode !== field.wrapper || excluded(field.input)) restore(field);
    }
    if (!active) return;
    const candidates = new Set();
    for (const root of scopes) {
      if (root !== document && !root.isConnected) continue;
      if (root.matches?.(selector)) candidates.add(root);
      root.querySelectorAll(selector).forEach(input => candidates.add(input));
    }
    // Read styles together before inserting any branded wrappers. On mobile a
    // read after each preceding input's DOM writes forces repeated layouts.
    const visible = [...candidates].filter(input => {
      if (fields.has(input) || input.hidden || input.closest('[hidden]') || excluded(input)) return false;
      const style = window.getComputedStyle(input);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    for (const field of fields.values()) {
      if (scopes.some(root => root === document || root === field.input || root.contains(field.input))) sync(field);
    }
    visible.forEach(input => enhance(input, true));
  }
  function schedule(root) {
    if (root?.nodeType === 1) refreshRoots.add(root);
    else refreshAll = true;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const scopes = refreshAll ? [document] : [...refreshRoots];
      refreshAll = false; refreshRoots.clear();
      refresh(scopes);
    });
  }
  function containsFile(root) { return root?.nodeType === 1 && (root.matches(selector) || root.querySelector(selector)); }
  function observeChanges(mutations) {
    const active = memberVisible();
    if (active !== previousMemberVisible) { previousMemberVisible = active; schedule(); }
    for (const mutation of mutations) {
      const target = mutation.target;
      if (target?.nodeType !== 1 || target.closest('svg')) continue;
      if (mutation.type === 'attributes' && mutation.oldValue === target.getAttribute(mutation.attributeName)) continue;
      if (target.closest('[data-sl-built-in="file"]') && !target.matches(selector) && mutation.type !== 'childList') continue;
      if (mutation.type === 'attributes') {
        if (containsFile(target)) schedule(target);
      } else {
        for (const node of mutation.addedNodes || []) if (containsFile(node)) schedule(node);
        if ([...mutation.removedNodes || []].some(containsFile)) schedule(target);
      }
    }
  }
  function start() {
    previousMemberVisible = memberVisible();
    refresh();
    new MutationObserver(observeChanges).observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['hidden', 'class', 'style', 'disabled', 'multiple', 'accept', 'aria-label'],
      attributeOldValue: true,
    });
    document.addEventListener('reset', event => schedule(event.target), true);
    document.addEventListener('focusin', event => { if (containsFile(event.target)) schedule(event.target); }, true);
    window.SautiMemberFiles = Object.freeze({ refresh });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
