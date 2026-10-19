/* A member-only colour editor; the original input still owns saved values. */
(() => {
  'use strict';
  if (window.SautiMemberColor) return;
  const records = new Map();
  const palette = ['#e9e5df', '#f4dce4', '#e8dff5', '#dce7f8', '#dcefe9', '#f7ebd5', '#c7d4e8', '#9bbfb5', '#796b91', '#334863', '#243c38', '#22252b'];
  let queued = false;
  let sequence = 0;
  const memberVisible = () => Boolean(document.getElementById('member-view') && !document.getElementById('member-view').hidden && !document.body.classList.contains('auth-entry'));
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function fromHex(value) {
    const channels = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
    const [r, g, b] = channels;
    const max = Math.max(...channels), min = Math.min(...channels), delta = max - min;
    const light = (max + min) / 2;
    const saturation = delta ? delta / (1 - Math.abs(2 * light - 1)) : 0;
    let hue = !delta ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    if (hue < 0) hue += 6;
    return [Math.round(hue * 60), Math.round(saturation * 100), Math.round(light * 100)];
  }
  function toHex(hue, saturation, lightness) {
    const s = saturation / 100, l = lightness / 100;
    const amplitude = s * Math.min(l, 1 - l);
    return '#' + [0, 8, 4].map((offset) => {
      const k = (offset + hue / 30) % 12;
      return Math.round(255 * (l - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
    }).join('');
  }
  function sync(record, keepSliders = false) {
    const value = record.input.value.toLowerCase();
    if (record.color !== value) {
      record.value.textContent = value.toUpperCase();
      record.swatch.style.backgroundColor = value;
      record.preview.style.backgroundColor = value;
      record.color = value;
    }
    if (document.activeElement !== record.hex) record.hex.value = value;
    const disabled = record.input.disabled || Boolean(record.input.closest('fieldset[disabled]'));
    if (record.trigger.disabled !== disabled) record.trigger.disabled = disabled;
    for (const field of record.wrapper.querySelectorAll('input, button')) if (field.disabled !== disabled) field.disabled = disabled;
    const hidden = record.input.hidden || record.input.closest('[hidden]') !== null;
    if (record.wrapper.hidden !== hidden) record.wrapper.hidden = hidden;
    for (const swatch of record.palette.querySelectorAll('button')) {
      const selected = swatch.dataset.color === value;
      if (swatch.getAttribute('aria-pressed') !== String(selected)) swatch.setAttribute('aria-pressed', String(selected));
    }
    if (!keepSliders) fromHex(value).forEach((number, index) => { record.sliders[index].value = String(number); });
    record.sliders.forEach((slider, index) => {
      const text = `${slider.value}${index ? '%' : '°'}`;
      if (record.outputs[index].textContent !== text) record.outputs[index].textContent = text;
    });
  }
  function apply(record, value, keepSliders = false) {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    record.applying = true;
    try {
      record.input.value = value;
      sync(record, keepSliders);
      record.hex.removeAttribute('aria-invalid');
      record.error.hidden = true;
      record.input.dispatchEvent(new Event('input', { bubbles: true }));
      record.input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally { record.applying = false; }
  }
  function enhance(input) {
    const wrapper = element('div', 'sl-color');
    wrapper.dataset.slBuiltinColor = '';
    const trigger = element('button', 'sl-color-trigger');
    trigger.type = 'button';
    trigger.id = `sl-color-trigger-${++sequence}`;
    trigger.setAttribute('aria-label', 'Edit custom chat color');
    trigger.setAttribute('aria-expanded', 'false');
    const swatch = element('span', 'sl-color-dot');
    swatch.setAttribute('aria-hidden', 'true');
    const value = element('span', 'sl-color-value');
    const edit = element('span', 'sl-color-edit', 'Edit color');
    trigger.append(swatch, value, edit);
    const panel = element('section', 'sl-color-panel');
    panel.id = `sl-color-panel-${sequence}`;
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Custom chat color');
    trigger.setAttribute('aria-controls', panel.id);
    const heading = element('div', 'sl-color-heading');
    const preview = element('span', 'sl-color-preview');
    preview.setAttribute('aria-hidden', 'true');
    heading.append(preview, element('strong', '', 'Make it yours'));
    const colors = element('div', 'sl-color-palette');
    colors.setAttribute('role', 'group');
    colors.setAttribute('aria-label', 'Suggested colors');
    for (const color of palette) {
      const button = element('button', 'sl-color-swatch');
      button.type = 'button';
      button.dataset.color = color;
      button.style.backgroundColor = color;
      button.setAttribute('aria-label', `Use color ${color.toUpperCase()}`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => apply(record, color));
      colors.append(button);
    }
    const sliders = [], outputs = [];
    const sliderGroup = element('div', 'sl-color-sliders');
    ['Hue', 'Saturation', 'Lightness'].forEach((name, index) => {
      const label = element('label', 'sl-color-slider');
      const caption = element('span', 'sl-color-slider-caption', name);
      const output = element('output');
      const slider = element('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = index ? '100' : '359';
      slider.step = '1';
      slider.id = `sl-color-${name.toLowerCase()}-${sequence}`;
      slider.setAttribute('aria-label', name);
      output.htmlFor = slider.id;
      caption.append(output);
      label.append(caption, slider);
      sliders.push(slider); outputs.push(output);
      slider.addEventListener('input', () => apply(record, toHex(...sliders.map((node) => Number(node.value))), true));
      sliderGroup.append(label);
    });
    const hexRow = element('label', 'sl-color-hex-row', 'Hex color');
    const hex = element('input', 'sl-color-hex');
    hex.type = 'text'; hex.maxLength = 7; hex.spellcheck = false; hex.autocomplete = 'off';
    hex.setAttribute('aria-label', 'Hex color');
    const error = element('p', 'sl-color-error', 'Enter a color such as #E9E5DF.');
    error.id = `sl-color-error-${sequence}`; error.hidden = true; error.setAttribute('role', 'status');
    hex.setAttribute('aria-describedby', error.id);
    const commitHex = () => {
      const typed = hex.value.trim();
      const valid = typed.startsWith('#') ? typed : `#${typed}`;
      if (/^#[0-9a-f]{6}$/i.test(valid)) { apply(record, valid); hex.value = valid; }
      else { error.hidden = false; hex.setAttribute('aria-invalid', 'true'); }
    };
    hex.addEventListener('change', commitHex);
    hex.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); commitHex(); } });
    hexRow.append(hex);
    panel.append(heading, colors, sliderGroup, hexRow, error);
    wrapper.append(trigger, panel);
    const label = input.closest('label');
    const record = { input, wrapper, trigger, swatch, value, panel, preview, palette: colors, sliders, outputs, hex, error, label,
      oldFor: label?.getAttribute('for'), oldTab: input.getAttribute('tabindex'), oldAria: input.getAttribute('aria-hidden'), oldValue: Object.getOwnPropertyDescriptor(input, 'value') };
    records.set(input, record);
    if (label) { label.htmlFor = trigger.id; label.after(wrapper); }
    else input.after(wrapper);
    input.dataset.slColorNative = '';
    input.tabIndex = -1; input.setAttribute('aria-hidden', 'true');
    const nativeValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement?.prototype || {}, 'value');
    if (nativeValue?.get && nativeValue.set && (!record.oldValue || record.oldValue.configurable)) {
      Object.defineProperty(input, 'value', {
        configurable: true, enumerable: nativeValue.enumerable,
        get() { return nativeValue.get.call(this); },
        set(value) { nativeValue.set.call(this, value); if (!record.applying) sync(record); },
      });
      record.observesValue = true;
    }
    trigger.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      trigger.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) { sync(record); colors.querySelector('button')?.focus(); }
    });
    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        event.preventDefault(); event.stopPropagation(); panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false'); trigger.focus();
      }
    });
    const update = () => { if (!record.applying) sync(record); };
    input.addEventListener('input', update); input.addEventListener('change', update);
    record.update = update;
    sync(record);
  }
  function restore(input, record) {
    record.wrapper.remove(); delete input.dataset.slColorNative;
    if (record.observesValue) { if (record.oldValue) Object.defineProperty(input, 'value', record.oldValue); else delete input.value; }
    for (const [attribute, value] of [['tabindex', record.oldTab], ['aria-hidden', record.oldAria]]) {
      if (value === null) input.removeAttribute(attribute); else input.setAttribute(attribute, value);
    }
    if (record.label) { if (record.oldFor === null) record.label.removeAttribute('for'); else record.label.setAttribute('for', record.oldFor); }
    input.removeEventListener('input', record.update); input.removeEventListener('change', record.update);
    records.delete(input);
  }
  function refresh() {
    for (const [input, record] of records) {
      if (!memberVisible() || !input.isConnected) restore(input, record);
      else sync(record);
    }
    if (!memberVisible()) return;
    for (const input of document.querySelectorAll('#messages-custom-color[type="color"]')) {
      if (!records.has(input) && !input.closest('#auth-view')) enhance(input);
    }
  }
  function schedule() { if (!queued) { queued = true; queueMicrotask(() => { queued = false; refresh(); }); } }
  function init() {
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => !mutation.target.closest?.('[data-sl-builtin-color]') && !(mutation.type === 'attributes' && mutation.attributeName === 'data-sl-color-native'))) schedule();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'disabled', 'value'] });
    document.addEventListener('reset', () => queueMicrotask(refresh), true);
    document.addEventListener('focusin', (event) => { const record = [...records.values()].find((item) => item.trigger === event.target); if (record) sync(record); });
    refresh();
  }
  window.SautiMemberColor = { refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
