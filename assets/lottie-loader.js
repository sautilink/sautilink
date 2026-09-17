(() => {
  "use strict";

  const RELEASE = "20260917-lottie1";
  const STYLE_URL = `/assets/lottie-loader.css?v=${RELEASE}`;
  const RUNTIME_URL = "/assets/vendor/lottie-web/lottie_light.min.js";
  const ANIMATION_URL = "/assets/animations/sautilink-loader/animations/12345.json";
  const AUTO_TARGET_SELECTOR = ".loading-mark, .profile-route-brand-spinner";
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const mounted = new Map();

  let runtimePromise = null;
  let animationDataPromise = null;
  let observer = null;
  let scanQueued = false;
  let unavailable = false;

  function ensureStyles() {
    if (document.querySelector('link[data-sautilink-lottie-style="true"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = STYLE_URL;
    link.dataset.sautilinkLottieStyle = "true";
    document.head.append(link);
  }

  function ensureRuntime() {
    if (window.lottie?.loadAnimation) return Promise.resolve(window.lottie);
    if (runtimePromise) return runtimePromise;

    runtimePromise = new Promise((resolve, reject) => {
      let runtime = document.querySelector('script[data-sautilink-lottie-runtime="true"]');
      const complete = () => {
        if (window.lottie?.loadAnimation) resolve(window.lottie);
        else reject(new Error("SautiLink Lottie runtime did not initialise."));
      };
      const fail = () => reject(new Error("SautiLink Lottie runtime could not be loaded."));

      if (!runtime) {
        runtime = document.createElement("script");
        runtime.src = RUNTIME_URL;
        runtime.async = true;
        runtime.dataset.sautilinkLottieRuntime = "true";
        runtime.addEventListener("load", complete, { once: true });
        runtime.addEventListener("error", fail, { once: true });
        document.head.append(runtime);
        return;
      }

      if (window.lottie?.loadAnimation) complete();
      else {
        runtime.addEventListener("load", complete, { once: true });
        runtime.addEventListener("error", fail, { once: true });
      }
    }).catch((error) => {
      runtimePromise = null;
      unavailable = true;
      throw error;
    });

    return runtimePromise;
  }

  function ensureAnimationData() {
    if (animationDataPromise) return animationDataPromise;
    animationDataPromise = fetch(ANIMATION_URL, {
      cache: "force-cache",
      credentials: "same-origin",
    }).then((response) => {
      if (!response.ok) throw new Error(`SautiLink loader asset returned ${response.status}.`);
      return response.json();
    }).catch((error) => {
      animationDataPromise = null;
      unavailable = true;
      throw error;
    });
    return animationDataPromise;
  }

  function cloneAnimationData(data) {
    if (typeof structuredClone === "function") return structuredClone(data);
    return JSON.parse(JSON.stringify(data));
  }

  function contextIsVisible(target) {
    if (!target?.isConnected) return false;
    if (target.closest("[hidden]")) return false;
    if (target.closest('[data-visual="unavailable"]')) return false;
    return true;
  }

  function clearTargetState(target) {
    target.classList.remove("sl-lottie-pending", "sl-lottie-ready", "sl-lottie-host");
    delete target.dataset.sautilinkLottie;
    delete target.dataset.sautilinkLottieMode;
  }

  function destroy(target) {
    const record = mounted.get(target);
    if (!record) return;
    try { record.animation?.destroy(); } catch (_) {}
    record.surface?.remove();
    mounted.delete(target);
    clearTargetState(target);
  }

  function waitForDom(animation) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        callback(value);
      };
      const timer = window.setTimeout(
        () => finish(reject, new Error("SautiLink loader render timed out.")),
        3000,
      );
      animation.addEventListener("DOMLoaded", () => finish(resolve));
      animation.addEventListener(
        "data_failed",
        () => finish(reject, new Error("SautiLink loader animation data failed.")),
      );
    });
  }

  function mount(target, options = {}) {
    if (!(target instanceof Element) || unavailable) return Promise.resolve(null);
    const existing = mounted.get(target);
    if (existing) return existing.ready;

    ensureStyles();
    delete target.dataset.sautilinkLottieFallback;

    const surface = document.createElement("span");
    surface.className = "sl-lottie-loader-surface";
    surface.setAttribute("aria-hidden", "true");

    target.classList.add("sl-lottie-host", "sl-lottie-pending");
    target.dataset.sautilinkLottie = "pending";
    target.dataset.sautilinkLottieMode = options.mode || "inline";
    target.append(surface);

    const record = {
      target,
      surface,
      animation: null,
      ready: null,
      auto: options.auto === true,
    };

    record.ready = Promise.all([ensureRuntime(), ensureAnimationData()])
      .then(async ([lottie, animationData]) => {
        if (!target.isConnected) throw new Error("SautiLink loader target was removed.");

        const animation = lottie.loadAnimation({
          container: surface,
          renderer: "svg",
          loop: !reducedMotion,
          autoplay: !reducedMotion,
          animationData: cloneAnimationData(animationData),
          rendererSettings: {
            preserveAspectRatio: "xMidYMid meet",
            progressiveLoad: true,
            hideOnTransparent: true,
          },
        });
        record.animation = animation;
        await waitForDom(animation);

        if (!target.isConnected) throw new Error("SautiLink loader target was removed.");
        if (reducedMotion) animation.goToAndStop(0, true);

        target.classList.remove("sl-lottie-pending");
        target.classList.add("sl-lottie-ready");
        target.dataset.sautilinkLottie = "ready";
        return animation;
      })
      .catch(() => {
        try { record.animation?.destroy(); } catch (_) {}
        surface.remove();
        mounted.delete(target);
        clearTargetState(target);
        target.dataset.sautilinkLottieFallback = "true";
        return null;
      });

    mounted.set(target, record);
    return record.ready;
  }

  function syncPlayback(target, record) {
    if (!record.animation || reducedMotion) return;
    if (contextIsVisible(target)) record.animation.play();
    else record.animation.pause();
  }

  function scan(root = document) {
    if (!root?.querySelectorAll || unavailable) return;

    root.querySelectorAll(AUTO_TARGET_SELECTOR).forEach((target) => {
      if (!contextIsVisible(target)) return;
      if (!mounted.has(target)) mount(target, { auto: true });
    });

    for (const [target, record] of mounted) {
      if (!target.isConnected || (record.auto && !target.matches(AUTO_TARGET_SELECTOR))) {
        destroy(target);
        continue;
      }
      syncPlayback(target, record);
    }
  }

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    const run = () => {
      scanQueued = false;
      scan(document);
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
    else queueMicrotask(run);
  }

  function installAutoUpgrade() {
    if (observer) return;
    ensureStyles();
    scan(document);
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "data-state", "data-visual"],
    });
  }

  window.SautiLinkLottieLoader = Object.freeze({
    release: RELEASE,
    mount,
    destroy,
    scan,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installAutoUpgrade, { once: true });
  } else {
    installAutoUpgrade();
  }
})();
