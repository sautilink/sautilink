import { clampAudioClip, audioTime } from './social-presentation.js';

/** One bounded clip model for music and video. Keyboard controls remain native ranges. */
export function createAudioWaveform(root, { track, initial, peaks = [], onChange = () => {}, onScrub = () => {} }) {
  let clip = clampAudioClip(track, initial?.startMs, initial?.durationMs);
  root.className = 'audio-trim-timeline';
  const output = document.createElement('output'); output.className = 'audio-trim-duration';
  const position = document.createElement('p'); position.className = 'audio-trim-position';
  const bars = document.createElement('div'); bars.className = 'audio-trim-waveform'; bars.setAttribute('aria-hidden', 'true');
  const selection = document.createElement('div'); selection.className = 'audio-trim-selection'; bars.append(selection);
  const start = document.createElement('input'), length = document.createElement('input');
  for (const input of [start, length]) { input.type = 'range'; input.step = '100'; }
  start.setAttribute('aria-label', 'Clip start'); length.setAttribute('aria-label', 'Clip duration');
  const startLabel = document.createElement('label'), lengthLabel = document.createElement('label');
  startLabel.append('Start', start); lengthLabel.append('Duration', length);
  const controls = document.createElement('div'); controls.className = 'audio-trim-accessible-controls'; controls.append(startLabel, lengthLabel);
  const waveBars = [];
  for (let i = 0; i < 72; i++) {
    const bar = document.createElement('i');
    const peak = Number(peaks[Math.min(peaks.length - 1, Math.floor(i / 72 * peaks.length))]);
    bar.style.height = `${12 + (Number.isFinite(peak) ? Math.min(1, peak > 1 ? peak / 255 : peak) * 46 : 20)}px`;
    bars.append(bar);
    waveBars.push(bar);
  }
  root.replaceChildren(output, position, bars, controls);
  function render(notify = true) {
    start.min = String(track.license.windowStartMs); start.max = String(track.license.windowEndMs - clip.durationMs); start.value = String(clip.startMs);
    length.min = '1000'; length.max = String(Math.min(180000, track.license.maxClipMs, track.license.windowEndMs - clip.startMs)); length.value = String(clip.durationMs);
    output.textContent = audioTime(clip.durationMs); position.textContent = `${audioTime(clip.startMs)} — ${audioTime(clip.startMs + clip.durationMs)}`;
    const span = Math.min(track.license.windowEndMs - track.license.windowStartMs, Math.max(clip.durationMs * 2.8, 10000));
    const windowStart = Math.max(track.license.windowStartMs, Math.min(track.license.windowEndMs - span, clip.startMs - (span - clip.durationMs) / 2));
    selection.style.left = `${(clip.startMs - windowStart) / span * 100}%`;
    selection.style.width = `${clip.durationMs / span * 100}%`;
    for (let i = 0; i < waveBars.length; i++) {
      const at = (windowStart + i / waveBars.length * span) / track.durationMs;
      const peak = Number(peaks[Math.min(peaks.length - 1, Math.floor(at * peaks.length))]);
      waveBars[i].style.height = `${12 + (Number.isFinite(peak) ? Math.min(1, peak > 1 ? peak / 255 : peak) * 46 : 20)}px`;
    }
    root.setAttribute('aria-label', `Audio clip ${position.textContent}`);
    if (notify) onChange({ ...clip });
  }
  start.addEventListener('input', () => { onScrub(); clip = clampAudioClip(track, Number(start.value), clip.durationMs); render(); });
  length.addEventListener('input', () => { onScrub(); clip = clampAudioClip(track, clip.startMs, Number(length.value)); render(); });
  let drag = null;
  bars.addEventListener('pointerdown', event => {
    const rect = bars.getBoundingClientRect(); if (!rect.width) return;
    drag = { x: event.clientX, start: clip.startMs, width: rect.width, span: Math.min(track.license.windowEndMs - track.license.windowStartMs, Math.max(clip.durationMs * 2.8, 10000)) }; bars.setPointerCapture(event.pointerId); onScrub();
  });
  bars.addEventListener('pointermove', event => {
    if (!drag) return;
    clip = clampAudioClip(track, drag.start + (event.clientX - drag.x) / drag.width * drag.span, clip.durationMs); render();
  });
  const endDrag = () => { drag = null; }; bars.addEventListener('pointerup', endDrag); bars.addEventListener('pointercancel', endDrag);
  render(false);
  return { value: () => ({ ...clip }), destroy: () => { drag = null; root.replaceChildren(); } };
}
