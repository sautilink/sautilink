/* useAnimations micro-interactions for existing member controls.
 * Vendored MIT assets/provenance: /app/assets/animated-icons/NOTICE.txt.
 * Presentation only: no action handlers, application data or permissions change. */
(() => {
  'use strict';
  const VERSION = '20261019-useanimations1';
  const RUNTIME = '/assets/vendor/lottie-web/lottie_light.min.js';
  const SELECTOR = '[data-sauti-action], [data-member-view], #message-send, #message-voice-button';
  const NAV = {
    stream: { asset: 'home', kind: 'replay', roundTrip: true },
    messages: { asset: 'messageCircle', kind: 'replay' },
    notifications: { asset: 'notification', kind: 'bell' },
    circles: { asset: 'users', kind: 'replay' },
    saved: { asset: 'bookmark', kind: 'toggle' },
    settings: { asset: 'settings', kind: 'replay', roundTrip: true },
    profile: { asset: 'user', kind: 'replay' },
  };
  const ACTIONS = {
    like: { asset: 'heart', kind: 'toggle' },
    save: { asset: 'bookmark', kind: 'toggle' },
    comments: { asset: 'messageCircle', kind: 'replay' },
    repost: { asset: 'repeat', kind: 'replay' },
    share: { asset: 'link', kind: 'replay' },
  };
  const records = new Map();
  const dataCache = new Map();
  const roots = new WeakSet();
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let runtimePromise;
  let observer;
  let intersection;
  let queued = false;

  function memberVisible() {
    const member = document.getElementById('member-view');
    return Boolean(member && !member.hidden && !document.body.classList.contains('auth-entry'));
  }
  function visible(button) {
    return memberVisible() && button.isConnected && !button.closest('[hidden]')
      && document.visibilityState !== 'hidden' && button.getClientRects().length > 0;
  }
  function definition(button) {
    if (button.id === 'message-send') return { asset: 'send', kind: 'send' };
    if (button.id === 'message-voice-button') return { asset: 'microphone', kind: 'mic' };
    return ACTIONS[button.dataset.sautiAction] || NAV[button.dataset.memberView];
  }
  function selected(button) {
    return button.getAttribute('aria-pressed') === 'true' || button.dataset.active === 'true'
      || button.classList.contains('active');
  }
  function busy(button) {
    return button.getAttribute('aria-busy') === 'true' || button.dataset.sending === 'true';
  }
  function unread(button) {
    const badge = button.querySelector('[data-notification-badge]');
    return badge && !badge.hidden ? Math.max(0, Number.parseInt(badge.textContent, 10) || 0) : 0;
  }
  function runtime() {
    if (window.lottie?.loadAnimation) return Promise.resolve(window.lottie);
    if (runtimePromise) return runtimePromise;
    runtimePromise = new Promise((resolve, reject) => {
      let script = document.querySelector('script[data-sautilink-lottie-runtime="true"]');
      if (script?.dataset.slIconRuntimeFailed === 'true') { script.remove(); script = null; }
      const done = () => { clearTimeout(timeout); window.lottie?.loadAnimation ? resolve(window.lottie) : reject(new Error('Icon player unavailable')); };
      const failed = () => { if (script) script.dataset.slIconRuntimeFailed = 'true'; clearTimeout(timeout); reject(new Error('Icon player unavailable')); };
      const timeout = setTimeout(() => reject(new Error('Icon player unavailable')), 6000);
      if (!script) {
        script = document.createElement('script');
        script.src = RUNTIME;
        script.async = true;
        script.dataset.sautilinkLottieRuntime = 'true';
        script.addEventListener('load', done, { once: true });
        script.addEventListener('error', failed, { once: true });
        document.head.append(script);
      } else {
        script.addEventListener('load', done, { once: true });
        script.addEventListener('error', failed, { once: true });
      }
    }).catch((error) => { runtimePromise = null; throw error; });
    return runtimePromise;
  }
  function data(asset) {
    if (!dataCache.has(asset)) {
      dataCache.set(asset, fetch(`/app/assets/animated-icons/${asset}.json?v=${VERSION}`, {
        cache: 'force-cache', credentials: 'omit',
      }).then((response) => {
        if (!response.ok) throw new Error('Icon asset unavailable');
        return response.json();
      }).catch((error) => { dataCache.delete(asset); throw error; }));
    }
    return dataCache.get(asset);
  }
  function paint(host) {
    // White strokes cut a gap in microphone paths; they must follow the surface,
    // while foreground strokes/fills inherit the control's live theme/state color.
    host.querySelectorAll('[stroke], [fill]').forEach((node) => {
      if (node.closest('mask, clipPath, defs')) return;
      for (const attr of ['stroke', 'fill']) {
        const color = node.getAttribute(attr);
        if (!color || color === 'none' || color.startsWith('url(')) continue;
        const white = /^(?:#fff(?:fff)?|white|rgb\(255,\s*255,\s*255\))$/i.test(color);
        node.classList.add(`sl-icon-${white ? 'cutout' : 'ink'}-${attr}`);
      }
    });
  }
  // Lottie's playSegments changes totalFrames and makes currentFrame relative
  // to the segment. Keep the original bounds so repeated/reversed plays agree.
  function endFrame(record) { return record.lastFrame || 0; }
  function seek(record, frame) {
    record.animation.resetSegments(true);
    record.animation.goToAndStop(frame, true);
  }
  function resting(record) {
    if (!record.animation || !record.ready) return;
    record.phase = '';
    record.animation.loop = false;
    seek(record, record.kind === 'toggle' && record.state ? endFrame(record) : 0);
  }
  function replay(record, force = false) {
    if (!record.animation || !record.ready) { record.wantsReplay = true; return; }
    if (!visible(record.button) || !record.inView || motion.matches) return;
    if (record.phase && !force) return;
    record.wantsReplay = false;
    record.phase = 'forward';
    record.animation.loop = false;
    record.animation.setSpeed?.(1.25);
    record.animation.playSegments([record.firstFrame, record.firstFrame + endFrame(record)], true);
  }
  function toggle(record) {
    if (!record.animation || !record.ready) return;
    const to = record.state ? endFrame(record) : 0;
    const from = Math.max(0, Math.min(endFrame(record),
      (Number(record.animation.currentFrame) || 0) + (Number(record.animation.firstFrame) || 0) - record.firstFrame));
    record.animation.loop = false;
    if (Math.abs(from - to) < .1) seek(record, to);
    else record.animation.playSegments([record.firstFrame + from, record.firstFrame + to], true);
  }
  function nativeIcon(record) {
    const svg = record.button.querySelector(':scope > svg');
    if (svg && svg !== record.fallback) {
      if (record.fallback?.classList.contains('sl-animated-fallback')) record.fallback.classList.remove('sl-animated-fallback');
      record.fallback = svg;
    }
    // Some legacy send rendering replaces children while the request is pending.
    // Never interfere with the busy label; restore the saved glyph only at rest.
    if (!svg && record.fallback && !busy(record.button) && !record.button.contains(record.fallback)) {
      record.button.prepend(record.fallback);
    }
    if (record.fallback && record.host && !record.button.contains(record.host) && !busy(record.button)) {
      record.fallback.after(record.host);
    }
    if (record.ready && record.fallback && record.button.contains(record.host)) {
      if (!record.fallback.classList.contains('sl-animated-fallback')) record.fallback.classList.add('sl-animated-fallback');
      if (!record.button.classList.contains('sl-animated-ready')) record.button.classList.add('sl-animated-ready');
    }
  }
  function unmount(record) {
    record.token++;
    record.animation?.destroy();
    record.animation = null;
    record.ready = false;
    record.requesting = '';
    record.renderedAsset = '';
    record.phase = '';
    record.host?.remove();
    record.host = null;
    if (record.fallback?.classList.contains('sl-animated-fallback')) record.fallback.classList.remove('sl-animated-fallback');
    if (record.button.classList.contains('sl-animated-ready')) record.button.classList.remove('sl-animated-ready');
    if (record.button.dataset.slAnimatedReady) delete record.button.dataset.slAnimatedReady;
  }
  function destroy(record) {
    unmount(record);
    intersection?.unobserve(record.button);
    delete record.button.dataset.slAnimatedIcon;
    records.delete(record.button);
  }
  function sync(record) {
    const previous = record.state;
    record.state = selected(record.button);
    const isBusy = busy(record.button);
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
      const count = unread(record.button);
      if (count > record.unread) record.wantsReplay = true;
      record.unread = count;
    }
    if (!record.inView || !visible(record.button) || motion.matches) {
      record.wantsReplay = false;
      unmount(record);
      return;
    }
    nativeIcon(record);
    const asset = record.kind === 'mic' && record.button.classList.contains('recording') ? 'activity' : record.asset;
    if (record.renderedAsset !== asset || !record.animation) {
      void mount(record, asset);
      return;
    }
    if (!record.ready) return;
    if (record.kind === 'mic') {
      record.animation.loop = asset === 'activity';
      if (asset === 'activity') record.animation.play();
      else record.animation.goToAndStop(0, true);
    } else if (record.kind === 'toggle' && previous !== record.state) toggle(record);
    else if (record.wantsReplay && !isBusy) replay(record, true);
  }
  async function mount(record, asset) {
    if (record.failed || record.requesting === asset || !visible(record.button) || !record.inView || motion.matches) return;
    unmount(record);
    const token = ++record.token;
    record.requesting = asset;
    const initialState = record.state;
    try {
      const [player, source] = await Promise.all([runtime(), data(asset)]);
      if (records.get(record.button) !== record || token !== record.token || !visible(record.button) || !record.inView || motion.matches) return;
      const host = document.createElement('span');
      host.className = 'sl-animated-icon';
      host.setAttribute('aria-hidden', 'true');
      record.host = host;
      nativeIcon(record);
      const animationData = typeof structuredClone === 'function' ? structuredClone(source) : JSON.parse(JSON.stringify(source));
      const animation = player.loadAnimation({ container: host, renderer: 'svg', loop: false, autoplay: false,
        animationData, rendererSettings: { progressiveLoad: false, preserveAspectRatio: 'xMidYMid meet', hideOnTransparent: false } });
      record.animation = animation;
      record.firstFrame = Number(source.ip) || 0;
      record.lastFrame = Math.max(0, Number(source.op) - record.firstFrame - 1);
      record.renderedAsset = asset;
      record.requesting = '';
      const ready = () => {
        if (record.animation !== animation || token !== record.token) return;
        paint(host);
        const svg = host.querySelector('svg');
        svg?.setAttribute('aria-hidden', 'true');
        svg?.setAttribute('focusable', 'false');
        record.ready = true;
        if (record.button.dataset.slAnimatedReady !== 'true') record.button.dataset.slAnimatedReady = 'true';
        nativeIcon(record);
        if (record.kind === 'toggle') {
          seek(record, initialState ? endFrame(record) : 0);
          if (initialState !== record.state) toggle(record);
        } else if (record.kind === 'mic' && asset === 'activity') {
          animation.loop = true;
          animation.play();
        } else if (record.wantsReplay && !busy(record.button)) replay(record, true);
        else resting(record);
      };
      animation.addEventListener('DOMLoaded', ready);
      animation.addEventListener('complete', () => {
        if (record.animation !== animation || record.kind === 'toggle' || record.kind === 'mic') return;
        if (record.roundTrip && record.phase === 'forward' && visible(record.button) && !motion.matches) {
          record.phase = 'back';
          animation.playSegments([record.firstFrame + endFrame(record), record.firstFrame], true);
        } else resting(record);
      });
      animation.addEventListener('data_failed', () => { record.failed = true; unmount(record); });
      animation.addEventListener('error', () => { record.failed = true; unmount(record); });
      if (animation.isLoaded) ready();
    } catch (_) {
      if (token === record.token) { record.failed = true; unmount(record); }
    }
  }
  function observeRoot(root) {
    if (!root || roots.has(root)) return;
    roots.add(root);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'class', 'aria-pressed', 'aria-current', 'aria-busy', 'data-active', 'data-sending'] });
  }
  function scan() {
    queued = false;
    if (!memberVisible() || motion.matches) { [...records.values()].forEach(destroy); return; }
    for (const root of document.querySelectorAll('#member-view, .primary-rail, .mobile-nav, .mobile-header, .context-rail, .sauti-mobile-drawer')) observeRoot(root);
    for (const button of document.querySelectorAll(SELECTOR)) {
      if (records.has(button) || !definition(button) || !button.querySelector(':scope > svg')) continue;
      const record = { button, ...definition(button), fallback: button.querySelector(':scope > svg'), host: null,
        token: 0, ready: false, state: selected(button), wasBusy: busy(button), unread: unread(button),
        inView: !intersection, wantsReplay: false, failed: false, intent: false };
      records.set(button, record);
      button.dataset.slAnimatedIcon = record.asset;
      if (intersection) intersection.observe(button);
    }
    for (const record of [...records.values()]) {
      if (!record.button.isConnected) destroy(record);
      else sync(record);
    }
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(scan);
  }
  function control(event) {
    if (!(event.target instanceof Element)) return null;
    const button = event.target.closest(SELECTOR);
    return button && records.get(button);
  }
  function interact(event) {
    const record = control(event);
    if (!record || record.button.disabled || !visible(record.button) || motion.matches) return;
    if (event.type === 'pointerover' && event.relatedTarget instanceof Element && record.button.contains(event.relatedTarget)) return;
    record.failed = false;
    record.inView = true;
    if (!['replay', 'bell'].includes(record.kind)) { sync(record); return; }
    record.wantsReplay = true;
    sync(record);
  }
  function install() {
    if (!document.getElementById('member-view')) return;
    observer = new MutationObserver((changes) => {
      if (changes.some((change) => !(change.target instanceof Element ? change.target : change.target.parentElement)?.closest('.sl-animated-icon'))) schedule();
    });
    if (typeof IntersectionObserver === 'function') {
      intersection = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const record = records.get(entry.target);
          if (!record) continue;
          record.inView = entry.isIntersecting;
          sync(record);
        }
      }, { rootMargin: '80px' });
    }
    observer.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    observeRoot(document.getElementById('member-view'));
    document.addEventListener('pointerover', interact, { passive: true });
    document.addEventListener('focusin', interact);
    document.addEventListener('click', interact, true);
    document.addEventListener('submit', (event) => {
      if (!memberVisible() || motion.matches || event.target?.id !== 'message-composer') return;
      const record = records.get(document.getElementById('message-send'));
      if (record) record.intent = !record.button.disabled && !busy(record.button);
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
