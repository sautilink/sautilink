/* Public dropdown presentation adapted from the existing SautiLink member controls. Native fields remain the source of
 * truth, including form submission, validity, option values and change events. */
(() => {
  'use strict';

  const records = new Map();
  const forms = new Map();
  const errors = new Map();
  const passiveChecks = new Set();
  const nativeSelect = window.HTMLSelectElement?.prototype;
  let serial = 0;
  let active = null;
  let scheduled = false;
  let pendingFocus = false;
  let typeBuffer = '';
  let typeAt = 0;

  const publicVisible = () => Boolean(document.body?.matches('[data-public-selects]'));
  const publicField = (node) => publicVisible() && node?.nodeType === 1 && !node.closest('[data-public-select-skip]');
  const setAttribute = (node, name, value) => {
    if (value === null || value === undefined || value === false) {
      if (node.hasAttribute(name)) node.removeAttribute(name);
    } else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
  };
  const disabled = (select) => select.disabled || select.matches(':disabled');
  const eligible = (select) => publicField(select) && !select.multiple && select.size <= 1;
  const optionDisabled = (option) => option.disabled || option.parentElement?.matches('optgroup:disabled');
  const optionsFor = (select) => [...select.options].filter((option) => !option.hidden && !option.parentElement?.hidden);

  function icon(name, path) {
    const library = window.SautiPublicIcons;
    if (library?.catalog?.[name]) {
      const svg = library.renderIcon(name, 24, document);
      svg.setAttribute('class', 'public-icon');
      svg.setAttribute('data-public-icon', name);
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      return svg;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    drawing.setAttribute('d', path);
    svg.append(drawing);
    return svg;
  }

  function fieldLabel(select) {
    const explicit = select.getAttribute('aria-label');
    if (explicit) return explicit;
    const labelled = select.getAttribute('aria-labelledby');
    if (labelled) {
      const text = labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
      if (text) return text;
    }
    const label = select.labels?.[0];
    if (label) {
      const strong = label.querySelector('strong');
      if (strong?.textContent.trim()) return strong.textContent.trim();
      const copy = label.cloneNode(true);
      copy.querySelectorAll('select, [data-sl-built-in], small, svg, .field-hint, .sl-field-error').forEach((node) => node.remove());
      const text = copy.textContent.replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return select.title || select.name || select.id.replace(/[-_]/g, ' ') || 'Choose an option';
  }

  function snapshot(select) {
    return JSON.stringify([
      select.value, select.selectedIndex, disabled(select), select.hidden, select.required,
      select.getAttribute('aria-label'), select.getAttribute('aria-labelledby'), select.getAttribute('aria-describedby'),
      select.getAttribute('aria-invalid'), select.title, fieldLabel(select),
      [...select.options].map((option) => [option.value, option.label, option.selected, optionDisabled(option), option.hidden,
        option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '', Boolean(option.parentElement?.hidden)]),
    ]);
  }

  function refreshRecord(record, force = false) {
    const { select, button, value, wrapper } = record;
    const next = snapshot(select);
    if (!force && next === record.snapshot) return;
    record.snapshot = next;
    const selected = select.selectedOptions[0];
    const label = fieldLabel(select);
    const text = selected?.label || 'Choose an option';
    if (value.textContent !== text) value.textContent = text;
    button.disabled = disabled(select);
    wrapper.hidden = select.hidden;
    wrapper.classList.toggle('sl-select-placeholder', !select.value);
    setAttribute(button, 'aria-label', `${label}: ${text}`);
    setAttribute(button, 'title', select.title || label);
    setAttribute(button, 'aria-required', select.required ? 'true' : null);
    setAttribute(button, 'aria-invalid', select.getAttribute('aria-invalid'));
    setAttribute(button, 'aria-describedby', select.getAttribute('aria-describedby'));
    if (active === record) {
      if (button.disabled || wrapper.hidden || select.closest('[hidden]') || !select.isConnected) closeSelect(false);
      else renderOptions(record);
    }
  }

  // Existing page clients assign .value without dispatching an event. Delegate these
  // setters to the native implementation and refresh only this field. No timer
  // or prototype patch is needed, and the descriptors are restored on teardown.
  function observeProperty(record, name) {
    const descriptor = nativeSelect && Object.getOwnPropertyDescriptor(nativeSelect, name);
    const own = Object.getOwnPropertyDescriptor(record.select, name);
    if (!descriptor?.get || !descriptor.set || own) return;
    record.properties.set(name, own);
    Object.defineProperty(record.select, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() { return descriptor.get.call(this); },
      set(value) {
        descriptor.set.call(this, value);
        refreshRecord(record);
      },
    });
  }

  function enhance(select) {
    if (records.has(select) || !eligible(select)) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'sl-select';
    wrapper.dataset.slBuiltIn = 'select';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sl-select-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const menuId = `sl-select-menu-${++serial}`;
    button.setAttribute('aria-controls', menuId);
    const value = document.createElement('span');
    value.className = 'sl-select-value';
    button.append(value, icon('chevron-down', 'm6 9 6 6 6-6'));
    select.before(wrapper);
    wrapper.append(select, button);
    const record = {
      select, wrapper, button, value, menuId, menu: null, options: [], highlighted: -1, snapshot: '', properties: new Map(),
      original: new Map(['tabindex', 'aria-hidden', 'data-sl-native-select'].map((name) => [name, select.getAttribute(name)])),
    };
    records.set(select, record);
    select.dataset.slNativeSelect = '';
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    observeProperty(record, 'value');
    observeProperty(record, 'selectedIndex');
    button.addEventListener('click', () => active === record ? closeSelect(true) : openSelect(record));
    button.addEventListener('keydown', (event) => onKeyDown(event, record));
    select.addEventListener('focus', record.onNativeFocus = () => { if (publicVisible()) button.focus({ preventScroll: true }); });
    refreshRecord(record, true);
  }

  function destroy(record) {
    if (active === record) closeSelect(false);
    const { select, wrapper } = record;
    select.removeEventListener('focus', record.onNativeFocus);
    for (const [name, descriptor] of record.properties) {
      if (descriptor) Object.defineProperty(select, name, descriptor);
      else delete select[name];
    }
    for (const [name, value] of record.original) setAttribute(select, name, value);
    if (wrapper.parentNode) {
      // A feature may remove or move the native control independently of its
      // surrounding form. Preserve that change instead of reinserting it.
      if (select.parentNode === wrapper) wrapper.before(select);
      wrapper.remove();
    }
    records.delete(select);
  }

  function renderOptions(record) {
    const menu = record.menu;
    if (!menu) return;
    const previous = record.options[record.highlighted];
    const normalize = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    const query = normalize(record.search?.value.trim() || '');
    record.options = optionsFor(record.select).filter((option) => !query || normalize(`${option.label} ${option.value}`).includes(query));
    // A country code such as TZ should highlight Tanzania before a partial
    // label match such as Switzerland. Preserve source order for other matches.
    if (query) record.options.sort((a, b) => Number(normalize(b.value) === query) - Number(normalize(a.value) === query));
    const optionsSignature = JSON.stringify(record.options.map((option) => [option.label, option.selected, optionDisabled(option), option.parentElement?.label]));
    if (menu.dataset.options !== optionsSignature) {
      menu.dataset.options = optionsSignature;
      record.list.replaceChildren();
      let group = null;
      record.options.forEach((option, index) => {
        const parent = option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement : null;
        if (parent && parent !== group) {
          const heading = document.createElement('div');
          heading.className = 'sl-select-group';
          heading.setAttribute('role', 'presentation');
          heading.textContent = parent.label;
          record.list.append(heading);
        }
        group = parent;
        const item = document.createElement('div');
        item.id = `${record.menuId}-option-${index}`;
        item.className = 'sl-select-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        if (optionDisabled(option)) item.setAttribute('aria-disabled', 'true');
        const copy = document.createElement('span');
        copy.textContent = option.label;
        item.append(copy, icon('check', 'm5 12 4 4L19 6'));
        item.addEventListener('pointermove', () => { if (!optionDisabled(option)) highlight(record, index, false); });
        item.addEventListener('pointerdown', (event) => event.preventDefault());
        item.addEventListener('click', () => { if (!optionDisabled(option)) choose(record, index); });
        record.list.append(item);
      });
    }
    record.empty.hidden = record.options.length > 0;
    const selected = record.options.indexOf(record.select.selectedOptions[0]);
    const previousIndex = record.options.indexOf(previous);
    highlight(record, previousIndex >= 0 && !optionDisabled(previous) ? previousIndex : selected, false);
    positionMenu(record);
  }

  function highlight(record, index, scroll = true) {
    const option = record.options[index];
    if (!option || optionDisabled(option)) {
      index = record.options.findIndex((item) => !optionDisabled(item));
    }
    record.highlighted = index;
    record.menu?.querySelectorAll('[role="option"]').forEach((item, itemIndex) => item.classList.toggle('sl-select-highlighted', itemIndex === index));
    setAttribute(record.button, 'aria-activedescendant', index >= 0 ? `${record.menuId}-option-${index}` : null);
    if (record.search) setAttribute(record.search, 'aria-activedescendant', index >= 0 ? `${record.menuId}-option-${index}` : null);
    if (scroll && index >= 0) document.getElementById(`${record.menuId}-option-${index}`)?.scrollIntoView({ block: 'nearest' });
  }

  function positionMenu(record) {
    if (!record.menu || !record.button.isConnected) return;
    const rect = record.button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = viewport?.width || document.documentElement.clientWidth;
    const height = viewport?.height || window.innerHeight;
    const leftEdge = viewport?.offsetLeft || 0;
    const topEdge = viewport?.offsetTop || 0;
    const gap = 8;
    const menuWidth = Math.max(0, Math.min(Math.max(rect.width, width <= 520 ? 250 : 260), width - 24));
    const left = Math.max(leftEdge + 12, Math.min(rect.left, leftEdge + width - menuWidth - 12));
    const below = topEdge + height - rect.bottom - gap - 12;
    const above = rect.top - topEdge - gap - 12;
    const upwards = below < 180 && above > below;
    const available = Math.max(88, Math.min(360, upwards ? above : below));
    record.menu.style.width = `${menuWidth}px`;
    record.menu.style.maxHeight = `${available}px`;
    record.menu.style.left = `${left}px`;
    const menuHeight = Math.min(record.menu.scrollHeight, available);
    const top = upwards ? Math.max(topEdge + 12, rect.top - gap - menuHeight) : Math.max(topEdge + 12, rect.bottom + gap);
    record.menu.style.top = `${Math.min(top, topEdge + height - menuHeight - 12)}px`;
  }

  function openSelect(record) {
    if (!publicVisible() || disabled(record.select)) return;
    closeSelect(false);
    refreshRecord(record, true);
    const menu = document.createElement('div');
    menu.id = `${record.menuId}-popup`;
    menu.className = 'sl-select-menu';
    menu.dataset.slBuiltIn = 'select-menu';
    menu.setAttribute('popover', 'manual');
    const list = document.createElement('div');
    list.id = record.menuId;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', fieldLabel(record.select));
    record.list = list;
    record.search = null;
    if (record.select.hasAttribute('data-public-select-search') || optionsFor(record.select).length > 18) {
      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'sl-select-search';
      search.placeholder = record.select.getAttribute('data-public-select-search-placeholder') || 'Search options';
      search.setAttribute('aria-label', `Search ${fieldLabel(record.select)}`);
      search.setAttribute('role', 'combobox');
      search.setAttribute('aria-controls', record.menuId);
      search.setAttribute('aria-expanded', 'true');
      search.setAttribute('aria-autocomplete', 'list');
      search.autocomplete = 'off';
      search.spellcheck = false;
      search.addEventListener('input', () => renderOptions(record));
      search.addEventListener('keydown', (event) => onKeyDown(event, record));
      const searchBar = document.createElement('div');
      searchBar.className = 'sl-select-search-bar';
      searchBar.append(search);
      menu.append(searchBar);
      record.search = search;
    }
    const empty = document.createElement('div');
    empty.className = 'sl-select-empty';
    empty.setAttribute('role', 'status');
    empty.textContent = 'No matching options';
    record.empty = empty;
    menu.append(list, empty);
    // Keeping the portal in the same modal also supports browsers that do not
    // provide the Popover API. A popover itself joins the top layer when present.
    (record.select.closest('dialog[open]') || document.body).append(menu);
    record.menu = menu;
    record.highlighted = -1;
    active = record;
    record.button.setAttribute('aria-expanded', 'true');
    record.wrapper.classList.add('sl-select-open');
    renderOptions(record);
    try { menu.showPopover?.(); } catch { menu.removeAttribute('popover'); }
    positionMenu(record);
    (record.search || record.button).focus({ preventScroll: true });
    const selected = record.options.indexOf(record.select.selectedOptions[0]);
    highlight(record, selected, true);
    typeBuffer = '';
  }

  function closeSelect(restoreFocus = false) {
    const record = active;
    if (!record) return;
    active = null;
    record.button.setAttribute('aria-expanded', 'false');
    record.button.removeAttribute('aria-activedescendant');
    record.wrapper.classList.remove('sl-select-open');
    try { record.menu?.hidePopover?.(); } catch { /* Already hidden by a parent modal. */ }
    record.menu?.remove();
    record.menu = null;
    record.search = null;
    record.list = null;
    if (restoreFocus && record.button.isConnected && !record.button.disabled) record.button.focus({ preventScroll: true });
  }

  function choose(record, index) {
    const option = record.options[index];
    if (!option || optionDisabled(option)) return;
    const previous = record.select.selectedIndex;
    record.select.selectedIndex = [...record.select.options].indexOf(option);
    refreshRecord(record, true);
    closeSelect(true);
    if (previous !== record.select.selectedIndex) {
      record.select.dispatchEvent(new Event('input', { bubbles: true }));
      record.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    scheduleRefresh();
  }

  function onKeyDown(event, record) {
    if (event.isComposing || event.keyCode === 229) return;
    const { key } = event;
    const searching = event.target === record.search;
    if (key === 'Tab') { if (active === record) closeSelect(searching); return; }
    if (event.altKey && key === 'ArrowUp' && active === record) {
      event.preventDefault();
      closeSelect(true);
      return;
    }
    if (key === 'Escape' && active === record) {
      event.preventDefault();
      event.stopPropagation();
      closeSelect(true);
      return;
    }
    if (key === 'Enter' || (key === ' ' && !searching)) {
      event.preventDefault();
      if (active === record) choose(record, record.highlighted);
      else openSelect(record);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      if (searching && (key === 'Home' || key === 'End')) return;
      event.preventDefault();
      if (active !== record) openSelect(record);
      const options = record.options;
      const step = key === 'ArrowUp' || key === 'End' ? -1 : 1;
      let index = key === 'Home' ? 0 : key === 'End' ? options.length - 1 : record.highlighted + step;
      for (; index >= 0 && index < options.length; index += step) {
        if (!optionDisabled(options[index])) { highlight(record, index); break; }
      }
      return;
    }
    if (!searching && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (active !== record) openSelect(record);
      if (record.search) {
        record.search.value = key;
        renderOptions(record);
        record.search.focus({ preventScroll: true });
        return;
      }
      const now = Date.now();
      typeBuffer = now - typeAt < 700 ? typeBuffer + key.toLocaleLowerCase() : key.toLocaleLowerCase();
      typeAt = now;
      const repeated = [...typeBuffer].every((letter) => letter === typeBuffer[0]);
      const query = repeated ? typeBuffer[0] : typeBuffer;
      const start = repeated ? record.highlighted + 1 : Math.max(0, record.highlighted);
      for (let offset = 0; offset < record.options.length; offset++) {
        const index = (start + offset) % record.options.length;
        const option = record.options[index];
        if (!optionDisabled(option) && option.label.trim().toLocaleLowerCase().startsWith(query)) { highlight(record, index); break; }
      }
    }
  }

  function focusControl(field) {
    const target = records.get(field)?.button || field;
    if (target?.isConnected) target.focus({ preventScroll: false });
  }

  function clearError(field) {
    const error = errors.get(field);
    if (!error) return;
    error.node.remove();
    const description = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== error.node.id).join(' ');
    setAttribute(field, 'aria-describedby', description || null);
    if (field.getAttribute('aria-invalid') === 'true') setAttribute(field, 'aria-invalid', error.invalid);
    errors.delete(field);
    if (records.has(field)) refreshRecord(records.get(field), true);
  }

  function showError(field) {
    if (!publicField(field)) return;
    let error = errors.get(field);
    if (!error) {
      const node = document.createElement('small');
      node.id = `sl-field-error-${++serial}`;
      node.className = 'sl-field-error';
      node.setAttribute('role', 'alert');
      const target = records.get(field)?.wrapper || field;
      target.after(node);
      error = { node, invalid: field.getAttribute('aria-invalid') };
      errors.set(field, error);
      const descriptions = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      descriptions.add(node.id);
      field.setAttribute('aria-describedby', [...descriptions].join(' '));
    }
    error.node.textContent = field.validationMessage || 'Please check this field.';
    field.setAttribute('aria-invalid', 'true');
    if (records.has(field)) refreshRecord(records.get(field), true);
  }

  function enhanceForm(form) {
    if (forms.has(form) || !publicField(form)) return;
    const own = Object.getOwnPropertyDescriptor(form, 'checkValidity');
    if (own && !own.configurable) return;
    const check = form.checkValidity;
    if (typeof check !== 'function') return;
    Object.defineProperty(form, 'checkValidity', {
      configurable: true,
      writable: true,
      value: function (...args) {
        passiveChecks.add(this);
        try { return check.apply(this, args); }
        finally { passiveChecks.delete(this); }
      },
    });
    forms.set(form, own);
  }

  function refresh() {
    scheduled = false;
    if (!document.body) return;
    for (const record of records.values()) {
      if (!record.select.isConnected || record.select.parentNode !== record.wrapper || !eligible(record.select)) destroy(record);
    }
    for (const [form, own] of forms) {
      if (!form.isConnected || !publicField(form)) {
        if (own) Object.defineProperty(form, 'checkValidity', own); else delete form.checkValidity;
        forms.delete(form);
      }
    }
    for (const [field] of errors) if (!field.isConnected || !publicField(field)) clearError(field);
    if (!publicVisible()) { closeSelect(false); return; }
    document.querySelectorAll('select').forEach(enhance);
    document.querySelectorAll('form').forEach(enhanceForm);
    for (const record of records.values()) refreshRecord(record);
    if (active && (!active.button.getClientRects().length || active.select.closest('dialog:not([open])'))) closeSelect(false);
  }

  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(refresh);
  }

  function install() {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => {
        const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        return !target?.closest('[data-sl-built-in]') || target?.closest('select')
          || (mutation.type === 'childList' && target?.classList.contains('sl-select'));
      })) scheduleRefresh();
    });
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'hidden', 'open', 'disabled', 'required', 'multiple', 'size', 'selected', 'label', 'value', 'title', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-invalid'],
    });
    document.addEventListener('pointerdown', (event) => {
      if (active && !active.wrapper.contains(event.target) && !active.menu?.contains(event.target)) closeSelect(false);
    }, true);
    document.addEventListener('click', (event) => {
      const label = event.target.closest?.('label');
      const record = records.get(label?.control || label?.querySelector('select'));
      if (!record || event.target.closest('button, a, input, textarea, [role="option"]')) return;
      // Label activation must open the same built-in menu rather than delegate
      // a trusted activation click to the visually hidden native select.
      event.preventDefault();
      active === record ? closeSelect(true) : openSelect(record);
    }, true);
    document.addEventListener('focusin', (event) => {
      if (active && !active.wrapper.contains(event.target) && !active.menu?.contains(event.target)) closeSelect(false);
      if (publicVisible()) scheduleRefresh();
    });
    document.addEventListener('input', (event) => {
      if (errors.has(event.target) && event.target.validity.valid) clearError(event.target);
      scheduleRefresh();
    });
    document.addEventListener('change', (event) => {
      if (errors.has(event.target)) event.target.validity.valid ? clearError(event.target) : showError(event.target);
      scheduleRefresh();
    });
    document.addEventListener('reset', (event) => {
      queueMicrotask(() => {
        for (const [field] of errors) if (field.form === event.target) clearError(field);
        refresh();
      });
    });
    document.addEventListener('invalid', (event) => {
      const field = event.target;
      if (!records.has(field)) return;
      event.preventDefault();
      if (passiveChecks.has(field.form)) return;
      showError(field);
      // Keep native first-invalid ordering when another field precedes this
      // select. Only replace focus when this select is the first invalid field.
      const firstInvalid = field.form?.elements
        ? [...field.form.elements].find((control) => control.willValidate && !control.validity.valid)
        : field;
      if (!pendingFocus && (!firstInvalid || firstInvalid === field)) {
        pendingFocus = true;
        queueMicrotask(() => { pendingFocus = false; focusControl(field); });
      }
    }, true);
    document.addEventListener('cancel', (event) => {
      if (active) { event.preventDefault(); event.stopPropagation(); closeSelect(true); }
    }, true);
    document.addEventListener('close', () => { if (active && !active.select.closest('dialog[open]') && active.select.closest('dialog')) closeSelect(false); }, true);
    window.addEventListener('resize', () => { if (active) positionMenu(active); });
    window.addEventListener('scroll', (event) => {
      if (active && !active.menu?.contains(event.target)) positionMenu(active);
    }, true);
    window.visualViewport?.addEventListener('resize', () => { if (active) positionMenu(active); });
    window.visualViewport?.addEventListener('scroll', () => { if (active) positionMenu(active); });
    window.addEventListener('pageshow', scheduleRefresh);
    window.addEventListener('pagehide', () => closeSelect(false));
    refresh();
  }

  window.SautiPublicSelects = Object.assign(window.SautiPublicSelects || {}, { refresh, closeSelect, focusControl });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
