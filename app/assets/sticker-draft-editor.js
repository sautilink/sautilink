import { splitStickerTokens } from './sticker-token-codec.js';

// Keep the established textarea transport, validation and drafts. The user edits
// a visual surface; atomic sticker chips serialize only at the transport boundary.
export function installStickerDraftEditor(input, renderSticker) {
  if (!input || input.dataset.stickerEditor === 'true') return;
  input.dataset.stickerEditor = 'true';
  const editor = document.createElement('div'); editor.className = 'sl-sticker-draft-editor';
  editor.setAttribute('role', 'textbox'); editor.setAttribute('aria-multiline', 'true');
  editor.setAttribute('aria-label', input.getAttribute('aria-label') || input.placeholder || 'Message');
  const native = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  let editing = false, sequence = 0;
  function serialize(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 && node.nodeType !== 11) return '';
    if (node.dataset?.stickerToken) return node.dataset.stickerToken;
    if (node.nodeName === 'BR') return '\n';
    const text = [...node.childNodes].map(serialize).join('');
    return node !== editor && ['DIV', 'P'].includes(node.nodeName) ? text + '\n' : text;
  }
  function render() {
    const id = ++sequence, value = native.get.call(input);
    const nodes = [];
    for (const part of splitStickerTokens(value)) {
      if (!part.id) { nodes.push(document.createTextNode(part.value || part.raw || '')); continue; }
      const chip = document.createElement('span'); chip.className = 'sl-sticker-draft-chip';
      chip.contentEditable = 'false'; chip.dataset.stickerToken = part.raw; chip.dataset.inline = String(part.type === 'inline');
      chip.setAttribute('role', 'img'); chip.setAttribute('aria-label', 'Sticker'); chip.textContent = '☺'; nodes.push(chip);
      Promise.resolve(renderSticker(part)).then(node => {
        if (id !== sequence || !chip.isConnected || !node) return;
        chip.replaceChildren(node); chip.setAttribute('aria-label', node.getAttribute('aria-label') || 'Sticker');
      }).catch(() => { chip.setAttribute('aria-label', 'Sticker unavailable'); });
    }
    editor.replaceChildren(...nodes);
  }
  function syncDisabled() {
    const disabled = input.disabled || input.readOnly;
    editor.contentEditable = String(!disabled); editor.setAttribute('aria-disabled', String(disabled));
    editor.tabIndex = disabled ? -1 : 0; editor.dataset.placeholder = input.placeholder;
  }
  Object.defineProperty(input, 'value', { configurable: true,
    get() { return native.get.call(this); },
    set(value) { native.set.call(this, value); if (!editing) render(); },
  });
  input.focus = options => editor.focus(options);
  const nativeRange = input.setSelectionRange.bind(input);
  function rememberSelection() {
    const selection = getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return;
    const range = selection.getRangeAt(0), before = document.createRange();
    before.selectNodeContents(editor); before.setEnd(range.startContainer, range.startOffset);
    const start = Math.min(input.value.length, serialize(before.cloneContents()).length);
    before.setEnd(range.endContainer, range.endOffset);
    nativeRange(start, Math.min(input.value.length, serialize(before.cloneContents()).length));
  }
  function restoreSelection() {
    const start = input.selectionStart, end = input.selectionEnd;
    function point(offset) {
      let remaining = offset;
      function walk(parent) {
        for (let index = 0; index < parent.childNodes.length; index++) {
          const node = parent.childNodes[index], length = serialize(node).length;
          if (remaining > length) { remaining -= length; continue; }
          if (node.nodeType === 3) return [node, Math.min(remaining, node.length)];
          if (node.dataset?.stickerToken || node.nodeName === 'BR') return [parent, index + (remaining > 0 ? 1 : 0)];
          return walk(node);
        }
        return [parent, parent.childNodes.length];
      }
      return walk(editor);
    }
    const range = document.createRange(); range.setStart(...point(start)); range.setEnd(...point(end));
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }
  input.setSelectionRange = (...args) => {
    nativeRange(...args);
    if (document.activeElement === editor) restoreSelection();
  };
  editor.addEventListener('input', () => {
    const value = serialize(editor).replace(/\n$/, '');
    if (input.maxLength > 0 && value.length > input.maxLength) { render(); return; }
    editing = true; native.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true })); editing = false;
    rememberSelection();
  });
  editor.addEventListener('paste', event => {
    event.preventDefault(); const value = event.clipboardData?.getData('text/plain') || '';
    const selection = getSelection(); if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0); if (!editor.contains(range.commonAncestorContainer)) return;
    range.deleteContents(); const node = document.createTextNode(value); range.insertNode(node); range.setStartAfter(node); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range); editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  editor.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && input.id === 'message-body') {
      event.preventDefault(); const send = document.getElementById('message-send'); if (!send?.disabled) send?.click();
    }
  });
  editor.addEventListener('drop', event => event.preventDefault());
  editor.addEventListener('keyup', rememberSelection);
  editor.addEventListener('pointerup', rememberSelection);
  editor.addEventListener('focus', restoreSelection);
  input.addEventListener('input', () => { if (!editing) { render(); if (document.activeElement === editor) restoreSelection(); } });
  input.addEventListener('change', render);
  new MutationObserver(syncDisabled).observe(input, { attributes: true, attributeFilter: ['disabled', 'readonly', 'placeholder'] });
  input.before(editor); input.hidden = true; input.setAttribute('aria-hidden', 'true'); input.tabIndex = -1;
  render(); syncDisabled();
}
