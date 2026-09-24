(() => {
  "use strict";

  const script = document.currentScript;
  const product = script?.dataset.product || location.hostname;
  const version = script?.dataset.version || "1";
  const storageKey = `sautilink-launch:${product}:${version}`;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const startedAt = performance.now();
  let showSplash = true;
  let lottieHelperPromise = null;

  try {
    showSplash = sessionStorage.getItem(storageKey) !== "seen";
    if (showSplash) sessionStorage.setItem(storageKey, "seen");
  } catch (_) {
    showSplash = true;
  }

  document.documentElement.dataset.launchSplash = showSplash ? "full" : "skip";

  function registerServiceWorker() {
    if (script?.dataset.registerSw !== "true" || !("serviceWorker" in navigator) || location.protocol !== "https:") return;
    window.addEventListener("load", () => navigator.serviceWorker.register(script.dataset.sw || "/sw.js?v=20260924-video-stream1", { updateViaCache: "none" }).then((registration) => registration.update()).catch(() => {}), { once: true });
  }

  function ensureLottieHelper() {
    if (window.SautiLinkLottieLoader?.mount) return Promise.resolve(window.SautiLinkLottieLoader);
    if (lottieHelperPromise) return lottieHelperPromise;

    lottieHelperPromise = new Promise((resolve, reject) => {
      let helper = document.querySelector('script[data-sautilink-lottie-helper="true"]');
      const complete = () => {
        if (window.SautiLinkLottieLoader?.mount) resolve(window.SautiLinkLottieLoader);
        else reject(new Error("SautiLink loader helper did not initialise."));
      };
      const fail = () => reject(new Error("SautiLink loader helper could not be loaded."));

      if (!helper) {
        helper = document.createElement("script");
        helper.src = "/assets/lottie-loader.js?v=20260917-lottie1";
        helper.defer = true;
        helper.dataset.sautilinkLottieHelper = "true";
        helper.addEventListener("load", complete, { once: true });
        helper.addEventListener("error", fail, { once: true });
        document.head.append(helper);
        return;
      }

      helper.addEventListener("load", complete, { once: true });
      helper.addEventListener("error", fail, { once: true });
    }).catch(() => null);

    return lottieHelperPromise;
  }

  async function enhanceSplash(splash) {
    const stage = splash.querySelector(".sl-launch-logo-stage");
    if (!stage) return;
    const loader = await ensureLottieHelper();
    if (!loader || !splash.isConnected) return;
    await loader.mount(stage, { mode: "launch" });
  }

  function initSplash() {
    const splash = document.getElementById("sl-launch-splash");
    if (!splash || !showSplash) {
      splash?.remove();
      document.documentElement.dataset.launchSplash = "complete";
      return;
    }

    void enhanceSplash(splash);

    const minimum = reducedMotion ? 320 : 1900;
    const maximum = reducedMotion ? 900 : 4200;
    let dismissed = false;

    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      splash.classList.add("is-leaving");
      window.setTimeout(() => {
        splash.remove();
        document.documentElement.dataset.launchSplash = "complete";
      }, reducedMotion ? 20 : 420);
    };

    const finishAfterMinimum = () => {
      window.setTimeout(dismiss, Math.max(0, minimum - (performance.now() - startedAt)));
    };

    if (document.readyState === "complete") finishAfterMinimum();
    else window.addEventListener("load", finishAfterMinimum, { once: true });
    window.setTimeout(dismiss, maximum);
  }

  registerServiceWorker();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSplash, { once: true });
  else initSplash();
})();
