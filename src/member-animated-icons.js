/* Member-wide AnimateIcons presentation. Existing SVG/control nodes, labels,
 * counters, handlers and feature state remain owned by the application. */
import { iconRules, glyphIcons, textIconRules, excludedIconSelector, glyphSignature } from './member-icon-map.js';

(() => {
  'use strict';
  const RELEASE = '20261019-huge3';
  const RUNTIME = `/app/assets/huge-icons/runtime.js?v=${RELEASE}`;
  const GRAPHICS = ['viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'style'];
  const records = new Map();
  const textRecords = new Map();
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let playerRuntime;
  let runtimePromise;
  let observer;
  let intersection;
  let queued = false;
  let profileScrollTimer;

  function memberVisible() {
    const member = document.getElementById('member-view');
    return Boolean(member && !member.hidden && !document.body.classList.contains('auth-entry'));
  }
  function visible(record) {
    return memberVisible() && record.svg.isConnected && !record.svg.closest('[hidden]')
      && document.visibilityState !== 'hidden' && record.svg.getClientRects().length > 0 && record.inView;
  }
  function busy(button) { return button?.getAttribute('aria-busy') === 'true' || button?.dataset.sending === 'true'; }
  function selected(button) {
    return button?.getAttribute('aria-pressed') === 'true' || button?.getAttribute('aria-selected') === 'true'
      || button?.dataset.active === 'true' || button?.classList.contains('active');
  }
  function unread(button) {
    const badge = button?.querySelector('[data-notification-badge]');
    return badge && !badge.hidden ? Number.parseInt(badge.textContent, 10) || 0 : 0;
  }
  function excluded(svg) {
    return Boolean(svg.closest('#auth-view, .auth-view, .auth-result, [id^="auth-"], .auth-entry-header, .auth-art, .auth-panel-symbol')
      || svg.closest(excludedIconSelector));
  }
  function resolve(svg, record) {
    if (excluded(svg)) return null;
    if (svg.dataset.slIconName) return svg.dataset.slIconName;
    for (const rule of iconRules) if (svg.matches(rule.selector)) return rule.icon;
    return glyphIcons[record?.signature || glyphSignature(svg)] || null;
  }
  function ensureRuntime() {
    if (playerRuntime) return Promise.resolve(playerRuntime);
    if (window.SautiHugeIcons?.renderIcon) return Promise.resolve(playerRuntime = window.SautiHugeIcons);
    if (runtimePromise) return runtimePromise;
    runtimePromise = new Promise((resolveRuntime, reject) => {
      let script = document.querySelector('script[data-sauti-huge-runtime]');
      if (script?.dataset.failed === 'true') { script.remove(); script = null; }
      const timer = setTimeout(() => reject(new Error('Icon runtime unavailable')), 6000);
      const done = () => {
        clearTimeout(timer);
        if (window.SautiHugeIcons?.renderIcon) resolveRuntime(playerRuntime = window.SautiHugeIcons);
        else reject(new Error('Icon runtime unavailable'));
      };
      const failed = () => { clearTimeout(timer); if (script) script.dataset.failed = 'true'; reject(new Error('Icon runtime unavailable')); };
      if (!script) {
        script = document.createElement('script');
        script.src = RUNTIME;
        script.async = true;
        script.dataset.sautiHugeRuntime = RELEASE;
        script.addEventListener('load', done, { once: true });
        script.addEventListener('error', failed, { once: true });
        document.head.append(script);
      } else {
        script.addEventListener('load', done, { once: true });
        script.addEventListener('error', failed, { once: true });
      }
    }).catch(error => { runtimePromise = null; throw error; });
    return runtimePromise;
  }
  function remember(svg) {
    return { nodes: [...svg.childNodes], attributes: new Map(GRAPHICS.map(name => [name, svg.getAttribute(name)])) };
  }
  function stop(record) {
    clearTimeout(record.timer);
    record.timer = null;
    record.player?.destroy();
    record.player = null;
    record.playing = false;
  }
  function restore(record) {
    stop(record);
    if (record.drawn) {
      record.svg.replaceChildren(...record.original.nodes);
      for (const [key, value] of record.original.attributes) {
        if (value === null) record.svg.removeAttribute(key);
        else if (key === 'style') record.svg.style.cssText = value;
        else record.svg.setAttribute(key, value);
      }
    }
    record.svg.removeAttribute('data-sl-huge-icon');
    record.svg.removeAttribute('data-sl-huge-ready');
    record.drawn = false;
  }
  function destroy(record, restoreNative = true) {
    if (restoreNative) restore(record); else stop(record);
    intersection?.unobserve(record.svg);
    records.delete(record.svg);
  }
  function draw(record) {
    if (!playerRuntime?.catalog[record.name] || !record.svg.isConnected) return false;
    stop(record);
    const rendered = playerRuntime.renderIcon(record.name, 24, document);
    for (const key of GRAPHICS) {
      if (key === 'style') continue;
      const value = rendered.getAttribute(key);
      if (value !== null && record.svg.getAttribute(key) !== value) record.svg.setAttribute(key, value);
    }
    // Preserve classes/IDs/ARIA and the SVG node itself: theme toggles, media
    // controls and existing CSS continue to address precisely the same node.
    for (const key of rendered.style) record.svg.style.setProperty(key, rendered.style.getPropertyValue(key));
    rendered.firstElementChild?.setAttribute('data-sl-huge-drawing', '');
    record.svg.replaceChildren(...rendered.childNodes);
    record.svg.dataset.slHugeIcon = record.name;
    record.svg.dataset.slHugeReady = 'true';
    record.drawn = true;
    return true;
  }
  function duration(data) {
    let seconds = 0;
    function visit(node) {
      const timing = node.animate?.transition;
      seconds = Math.max(seconds, Number(timing?.duration || .6) + Number(timing?.delay || 0));
      node.children?.forEach(visit);
    }
    visit(data);
    return Math.min(2600, Math.max(450, seconds * 750 + 100));
  }
  function recording(record) { return record.control?.id === 'message-voice-button' && record.control.classList.contains('recording'); }
  function play(record) {
    if (!record.drawn || !visible(record) || motion.matches || (record.control?.disabled && record.kind !== 'send')) return;
    stop(record);
    record.player = playerRuntime.play(record.svg, record.name, { duration: .75 });
    record.player.start();
    record.playing = true;
    record.wantsReplay = false;
    record.timer = setTimeout(() => {
      if (!record.svg.isConnected) { destroy(record, false); return; }
      draw(record);
      if (recording(record) && visible(record) && !motion.matches) play(record);
    }, duration(playerRuntime.catalog[record.name]));
  }
  function sync(record) {
    if (!record.svg.isConnected) { destroy(record, false); return; }
    let name = resolve(record.svg, record);
    if (!name) { destroy(record); return; }
    if (recording(record)) name = 'activity';
    const previous = record.state;
    record.state = selected(record.control);
    const isBusy = busy(record.control);
    if (record.kind === 'send') {
      if (record.wasBusy && !isBusy) {
        const input = document.getElementById('message-body');
        const error = document.getElementById('message-composer-message');
        const attachment = document.getElementById('message-attachment-preview');
        if (record.intent && input && !input.value.trim() && !error?.textContent.trim()
          && (!attachment || attachment.hidden || !attachment.childElementCount)) record.wantsReplay = true;
        record.intent = false;
      }
      record.wasBusy = isBusy;
    }
    if (record.kind === 'bell') {
      const count = unread(record.control);
      if (count > record.unread) record.wantsReplay = true;
      record.unread = count;
    }
    if (record.kind === 'toggle' && previous !== record.state) record.wantsReplay = true;
    const changed = name !== record.name;
    record.name = name;
    if (!playerRuntime) return;
    if (!record.drawn || changed || record.dirty) {
      record.dirty = false;
      try { draw(record); } catch (_) { restore(record); record.failed = true; return; }
    }
    if (!visible(record) || motion.matches) {
      record.wantsReplay = false;
      if (record.player) draw(record);
      return;
    }
    if (recording(record) && !record.playing) play(record);
    else if (record.wantsReplay && !isBusy) play(record);
  }
  function makeRecord(svg) {
    const name = resolve(svg);
    if (!name) return;
    const control = svg.closest('button, a, summary, [role="button"], label') || svg.parentElement;
    const action = control?.dataset.sautiAction;
    const kind = control?.id === 'message-send' ? 'send' : ['like', 'save'].includes(action) ? 'toggle'
      : control?.dataset.memberView === 'notifications' ? 'bell' : 'replay';
    const record = { svg, name, control, kind, original: remember(svg), signature: glyphSignature(svg),
      state: selected(control), wasBusy: busy(control), unread: unread(control), inView: !intersection,
      drawn: false, wantsReplay: false, intent: false, player: null, timer: null };
    records.set(svg, record);
    intersection?.observe(svg);
    return record;
  }
  function restoreText() {
    for (const [host, item] of textRecords) {
      item.svg.remove();
      if (item.text?.isConnected && item.text.nodeValue === item.replacement) item.text.nodeValue = item.original;
      if (item.flag) host.removeAttribute(item.flag);
    }
    textRecords.clear();
  }
  function glyphs() {
    for (const rule of textIconRules) {
      for (const host of document.querySelectorAll(rule.selector)) {
        if (excluded(host) || textRecords.has(host) || host.querySelector('svg[data-sl-huge-text]')) continue;
        const text = [...host.childNodes].find(node => node.nodeType === 3 && rule.glyph && node.nodeValue.includes(rule.glyph));
        if (!rule.pseudo && rule.glyph && !text) continue;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.dataset.slIconName = rule.icon;
        svg.dataset.slHugeText = 'true';
        const item = { svg, text, rule, original: text?.nodeValue, replacement: text?.nodeValue?.replace(rule.glyph, '') };
        if (text) { text.nodeValue = item.replacement; text.before(svg); }
        else if (rule.pseudo === 'after') host.append(svg);
        else host.prepend(svg);
        if (rule.pseudo || rule.decorative) {
          item.flag = rule.decorative ? 'data-sl-huge-decoration' : `data-sl-huge-${rule.pseudo}`;
          host.setAttribute(item.flag, 'true');
        }
        textRecords.set(host, item);
      }
    }
  }
  function scan() {
    queued = false;
    if (!memberVisible()) {
      [...records.values()].forEach(record => destroy(record));
      restoreText();
      return;
    }
    for (const [host, item] of textRecords) if (!host.isConnected || !item.svg.isConnected || !host.matches(item.rule.selector)) {
      item.svg.remove();
      if (item.text?.isConnected && item.text.nodeValue === item.replacement) item.text.nodeValue = item.original;
      if (item.flag) host.removeAttribute(item.flag);
      textRecords.delete(host);
    }
    if (playerRuntime) glyphs();
    for (const svg of document.querySelectorAll('svg')) if (!records.has(svg)) makeRecord(svg);
    for (const record of [...records.values()]) sync(record);
    if (!playerRuntime && records.size) void ensureRuntime().then(schedule).catch(() => {});
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(scan);
  }
  function interactions(event) {
    if (!memberVisible() || motion.matches || !(event.target instanceof Element)) return;
    const target = event.target.closest('button, a, summary, [role="button"], label') || event.target.closest('svg');
    if (!target || target.disabled) return;
    if (event.type === 'pointerover' && event.relatedTarget instanceof Element && target.contains(event.relatedTarget)) return;
    for (const record of records.values()) {
      if (record.control !== target && record.svg !== target) continue;
      if (record.kind === 'send' || record.kind === 'toggle' || recording(record)) continue;
      record.inView = true;
      record.wantsReplay = true;
      sync(record);
    }
  }
  function profileTabKeys(event) {
    if (!memberVisible() || event.defaultPrevented || !(event.target instanceof Element)
      || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const current = event.target.closest('.profile-activity-tabs [data-profile-activity-tab]');
    if (!current) return;
    const tabs = [...current.closest('.profile-activity-tabs').querySelectorAll('[data-profile-activity-tab]')]
      .filter(tab => !tab.hidden && !tab.disabled && tab.getClientRects().length > 0);
    const index = tabs.indexOf(current);
    if (index < 0 || !tabs.length) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    // Keep the existing tab handler responsible for its permission checks,
    // selected state and feed request, exactly as on a pointer/touch click.
    tabs[next].click();
  }
  function revealProfileTab(tab) {
    if (!tab.matches('.profile-activity-tab[aria-selected="true"]')) return;
    clearTimeout(profileScrollTimer);
    profileScrollTimer = setTimeout(() => {
      if (!memberVisible() || !tab.isConnected || tab.hidden || tab.getAttribute('aria-selected') !== 'true') return;
      const bar = tab.closest('.profile-activity-tabs');
      if (!bar || !(bar.scrollWidth > bar.clientWidth)) return;
      const bounds = bar.getBoundingClientRect();
      const item = tab.getBoundingClientRect();
      const delta = item.right > bounds.right ? item.right - bounds.right + 5
        : item.left < bounds.left ? item.left - bounds.left - 5 : 0;
      if (delta) bar.scrollBy({ left: delta, behavior: motion.matches ? 'auto' : 'smooth' });
    }, motion.matches ? 0 : 270);
  }
  function install() {
    if (!document.getElementById('member-view')) return;
    observer = new MutationObserver(changes => {
      let relevant = false;
      for (const change of changes) {
        const element = change.target instanceof Element ? change.target : change.target.parentElement;
        if (change.attributeName === 'aria-selected' && element) revealProfileTab(element);
        const svg = element?.closest('svg[data-sl-huge-icon]');
        if (svg) {
          // The application can redraw a captured SVG. Detect that without
          // observing the Motion renderer's per-frame path/style mutations.
          if (change.type === 'childList' && change.target === svg && !svg.firstElementChild?.hasAttribute('data-sl-huge-drawing')) {
            const record = records.get(svg);
            if (record) {
              stop(record);
              record.original = remember(svg);
              record.signature = glyphSignature(svg);
              record.drawn = false;
              record.dirty = true;
            }
            relevant = true;
          }
          continue;
        }
        relevant = true;
      }
      if (relevant) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'class', 'aria-pressed', 'aria-selected', 'aria-current', 'aria-checked', 'aria-busy', 'aria-expanded', 'aria-label', 'title', 'data-active', 'data-sending'] });
    if (typeof IntersectionObserver === 'function') intersection = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const record = records.get(entry.target);
        if (record) { record.inView = entry.isIntersecting; sync(record); }
      }
    }, { rootMargin: '48px' });
    document.addEventListener('pointerover', interactions, { passive: true });
    document.addEventListener('focusin', interactions);
    document.addEventListener('click', interactions, true);
    document.addEventListener('keydown', profileTabKeys);
    document.addEventListener('submit', event => {
      if (!memberVisible() || event.target?.id !== 'message-composer') return;
      for (const record of records.values()) if (record.kind === 'send') record.intent = !record.control.disabled && !busy(record.control);
    }, true);
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('popstate', schedule);
    window.addEventListener('sautilink:routechange', schedule);
    motion.addEventListener?.('change', schedule);
    scan();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
