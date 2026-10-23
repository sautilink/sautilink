/** Delay short waits, then show one stable buffering indicator. User pauses and
 * completed/error states must never leave an animated loading overlay behind. */
export function bindVideoBuffering(video, change, { delay = 180, setTimer = setTimeout, clearTimer = clearTimeout,
  visible = () => globalThis.document?.visibilityState !== 'hidden' } = {}) {
  let timer = null, waiting = false;
  const listeners = new Map();
  const hide = () => {
    if (timer !== null) clearTimer(timer);
    timer = null; waiting = false; change(false, false);
  };
  const wait = () => {
    if (video.paused || video.ended || video.error || !visible()) { hide(); return; }
    if (waiting) return;
    waiting = true; change(true, false);
    timer = setTimer(() => {
      timer = null;
      if (waiting && video.isConnected && !video.paused && !video.ended && !video.error && visible()) change(true, true);
      else hide();
    }, delay);
  };
  const on = (event, listener) => { listeners.set(event, listener); video.addEventListener(event, listener); };
  on('waiting', wait);
  on('stalled', () => { if (video.readyState < 3) wait(); });
  on('play', () => { if (video.readyState < 3) wait(); });
  on('seeking', () => { if (video.readyState < 3) wait(); });
  for (const event of ['playing', 'canplay', 'seeked', 'pause', 'ended', 'error', 'emptied']) on(event, hide);
  return () => { hide(); for (const [event, listener] of listeners) video.removeEventListener(event, listener); };
}
