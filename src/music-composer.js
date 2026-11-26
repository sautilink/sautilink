import { createMusicClient, MUSIC_ORIGIN, audioClipUrl, clampAudioClip } from './music-client.js';
import { isNewMusicRelease, formatEngagementCount, audioTime } from './social-presentation.js';
import { createAudioWaveform } from './audio-waveform.js';
import { createPostActionIcon } from './social-icons.js';

function element(tag, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}
function action(label, onClick, cls = '') {
  const button = element('button', cls, label); button.type = 'button'; button.addEventListener('click', onClick); return button;
}

export function createMusicComposer({ supabase, getMemberId, onChange = () => {}, onCreate = () => {} }) {
  const client = createMusicClient({ supabase, getMemberId });
  let chosen = null, dialog = null, audio = null, request = 0, controller = null;
  let rows = [], saved = new Set(), uses = new Map(), tab = 'For you', nextOffset = null;
  let timeline = null, selectedTrack = null, pendingSelection = null, searchTimer = 0;
  let library, list, search, status, editor, summary, libraryOwner = null;
  const saving = new Map(); let saveEpoch = 0;
  const owner = () => getMemberId();
  function resetAccount() {
    if (libraryOwner === owner()) return;
    libraryOwner = owner(); saved = new Set(); uses = new Map(); rows = [];
    saving.clear(); saveEpoch++;
  }
  function stop() { audio?.pause(); if (audio) { audio.removeAttribute('src'); audio.load(); } audio = null; }
  function preview(selection, button) {
    stop(); audio = new Audio(audioClipUrl(selection)); audio.preload = 'metadata'; audio.volume = selection.musicVolume ?? 1;
    void audio.play().then(() => { if (button) button.textContent = 'Pause preview'; }).catch(() => { status.textContent = 'Tap play to preview this audio. If it remains unavailable, choose another track.'; });
    if (button) audio.addEventListener('ended', () => { button.textContent = 'Play preview'; }, { once: true });
  }
  function update() {
    summary.replaceChildren(); summary.hidden = !chosen;
    if (chosen) summary.append(action(`♫ ${chosen.title} · ${audioTime(chosen.durationMs)}`, () => void selectTrack(chosen.trackId)),
      action('Remove audio', () => { chosen = null; update(); onChange(); }));
    onChange();
  }
  async function saveTrack(track, button) {
    if (saving.has(track.id)) return;
    const id = owner(); button.disabled = true;
    const enabled = !saved.has(track.id), operation = client.save(track.id, enabled);
    saving.set(track.id, operation);
    try {
      await operation;
      if (id !== owner()) return;
      if (enabled) saved.add(track.id); else saved.delete(track.id);
      saveEpoch++;
      if (!button.dataset.musicSaveIcon) button.textContent = enabled ? 'Saved' : 'Save';
      button.setAttribute('aria-pressed', String(enabled)); saving.delete(track.id);
      if (dialog.open && !library.hidden) { if (tab === 'Saved') void load(); else renderRows(); }
    } catch (error) { status.textContent = error.message; }
    finally { if (saving.get(track.id) === operation) saving.delete(track.id); button.disabled = false; }
  }
  function renderRows() {
    const available = rows.filter(row => tab !== 'Saved' || saved.has(row.id)).filter(row => tab !== 'Original audio' || row.originalAudio);
    if (tab === 'Trending') available.sort((a, b) => (uses.get(b.id) || 0) - (uses.get(a.id) || 0));
    list.replaceChildren();
    for (const track of available) {
      const row = element('article', 'music-track-row');
      const cover = element('img'); cover.src = `${MUSIC_ORIGIN}/tracks/${track.id}/cover`; cover.alt = ''; cover.width = cover.height = 52; cover.loading = 'lazy'; cover.decoding = 'async';
      cover.addEventListener('error', () => cover.hidden = true, { once: true });
      const copy = action('', () => void selectTrack(track.id), 'music-track-copy');
      const title = element('strong', '', track.title); if (isNewMusicRelease(track.releasedOn)) title.append(element('span', 'music-new', 'New'));
      copy.append(title, element('span', '', `${track.artist} · ${audioTime(track.durationMs)}`),
        element('small', '', `${formatEngagementCount(uses.get(track.id)) || '0'} ${uses.get(track.id) === 1 ? 'use' : 'uses'}`));
      const play = action('▶', () => preview(clampAudioClip(track), play), 'music-track-play'); play.setAttribute('aria-label', `Preview ${track.title}`);
      const save = action('', () => void saveTrack(track, save), 'music-track-save'); save.dataset.musicSaveIcon = 'true';
      save.append(createPostActionIcon('save')); save.setAttribute('aria-label', `Save audio: ${track.title}`);
      save.setAttribute('aria-pressed', String(saved.has(track.id))); save.disabled = saving.has(track.id);
      row.append(cover, copy, play, save); list.append(row);
    }
    if (!available.length) list.append(element('p', 'music-empty', tab === 'Saved' ? 'Save audio to find it here.' : 'No matching audio. Try another search.'));
    if (nextOffset !== null) list.append(action('More audio', () => void load(true), 'music-load-more'));
  }
  async function load(more = false) {
    const id = ++request, member = owner(); controller?.abort(); controller = new AbortController(); status.textContent = 'Loading audio…';
    try {
      await Promise.allSettled([...saving.values()]);
      if (id !== request || member !== owner() || !dialog.open) return;
      const query = search.value.trim();
      if (tab === 'Saved') {
        const epoch = saveEpoch, result = await client.savedIds();
        if (id !== request || member !== owner() || !dialog.open) return;
        if (epoch === saveEpoch) saved = result;
        const selected = [];
        const ids = [...saved];
        for (let offset = 0; offset < ids.length; offset += 8) {
          selected.push(...await Promise.allSettled(ids.slice(offset, offset + 8).map(trackId => client.details(trackId, controller.signal))));
          if (id !== request || member !== owner() || !dialog.open) return;
        }
        if (id !== request || member !== owner() || !dialog.open) return;
        rows = selected.filter(item => item.status === 'fulfilled').map(item => item.value)
          .filter(track => `${track.title} ${track.artist}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        nextOffset = null; uses = await client.usage(rows.map(track => track.id));
        if (id !== request || member !== owner() || !dialog.open) return;
        renderRows(); status.textContent = selected.some(item => item.status === 'rejected') ? 'Some saved audio is unavailable.' : ''; return;
      }
      const result = more ? await client.page(query, nextOffset, controller.signal) : await client.catalog(query, controller.signal);
      if (id !== request || member !== owner() || !dialog.open) return;
      const incoming = (result.tracks || []).filter(row => /^[a-z0-9-]{1,80}$/.test(row.id) && row.license);
      rows = more ? [...new Map([...rows, ...incoming].map(row => [row.id, row])).values()] : incoming;
      nextOffset = Number.isSafeInteger(result.nextOffset) ? result.nextOffset : null;
      renderRows(); status.textContent = '';
      const epoch = saveEpoch;
      const [savedResult, useResult] = await Promise.allSettled([client.savedIds(), client.usage(rows.map(row => row.id))]);
      if (id !== request || member !== owner() || !dialog.open) return;
      if (savedResult.status === 'fulfilled' && epoch === saveEpoch) saved = savedResult.value;
      if (useResult.status === 'fulfilled') uses = useResult.value;
      renderRows();
      if (savedResult.status === 'rejected' || useResult.status === 'rejected') status.textContent = 'Some library details could not load. Try again.';
    } catch (error) { if (id === request && error.name !== 'AbortError') status.textContent = error.message; }
  }
  async function selectTrack(id) {
    const sequence = ++request; stop(); status.textContent = 'Loading audio…';
    try {
      const track = await client.details(id);
      if (sequence !== request || !dialog.open) return;
      selectedTrack = track; pendingSelection = chosen?.trackId === id ? chosen : clampAudioClip(track);
      timeline?.destroy(); editor.replaceChildren(); library.hidden = true; editor.hidden = false;
      editor.append(action('‹ All audio', () => { stop(); editor.hidden = true; library.hidden = false; }), element('h3', '', track.title), element('p', '', track.artist));
      const waveform = element('div'); editor.append(waveform);
      timeline = createAudioWaveform(waveform, { track, initial: pendingSelection, peaks: track.waveform || [],
        onScrub: stop, onChange: clip => { pendingSelection = { ...pendingSelection, startMs: clip.startMs, durationMs: clip.durationMs }; stop(); } });
      const play = action('Play preview', () => {
        if (audio && !audio.paused) { stop(); play.textContent = 'Play preview'; }
        else preview(pendingSelection, play);
      }, 'music-preview-button');
      editor.append(play);
      for (const [key, label] of [['musicVolume', 'Music volume'], ['originalVolume', 'Original video sound']]) {
        const group = element('label', 'music-volume', label), range = element('input'), output = element('output');
        range.type = 'range'; range.min = '0'; range.max = '1'; range.step = '.01'; range.value = String(pendingSelection[key] ?? 1);
        output.textContent = `${Math.round(Number(range.value) * 100)}%`;
        range.addEventListener('input', () => { pendingSelection[key] = Number(range.value); output.textContent = `${Math.round(Number(range.value) * 100)}%`; if (audio && key === 'musicVolume') audio.volume = Number(range.value); });
        group.append(range, output); editor.append(group);
      }
      editor.append(action('Use audio', () => { chosen = { ...pendingSelection }; stop(); dialog.close(); update(); }, 'music-use-audio'));
      status.textContent = '';
    } catch (error) { status.textContent = error.message; }
  }
  function createDialog() {
    dialog = element('dialog', 'music-dialog'); dialog.setAttribute('aria-label', 'SautiLink Audio');
    const heading = element('header'); heading.append(element('h2', '', 'Audio'), action('×', () => dialog.close(), 'music-close'));
    library = element('section'); search = element('input', 'music-search'); search.type = 'search'; search.placeholder = 'Search audio'; search.setAttribute('aria-label', 'Search audio');
    const tabs = element('div', 'music-tabs'); tabs.setAttribute('role', 'tablist');
    for (const label of ['For you', 'Trending', 'Saved', 'Original audio']) {
      const button = action(label, () => { stop(); tab = label; tabs.querySelectorAll('button').forEach(item => item.setAttribute('aria-selected', String(item === button))); void load(); });
      button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(label === tab)); tabs.append(button);
    }
    list = element('div', 'music-track-list'); library.append(search, tabs, list);
    editor = element('section', 'music-clip-editor'); editor.hidden = true;
    status = element('p', 'music-status'); status.setAttribute('role', 'status');
    dialog.append(heading, library, editor, status); document.body.append(dialog);
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => void load(), 250); });
    dialog.addEventListener('close', () => { request++; controller?.abort(); stop(); timeline?.destroy(); document.dispatchEvent(new CustomEvent('sautilink:music-dialog-toggle')); });
  }
  function open() {
    if (!owner()) return;
    resetAccount();
    if (!dialog) createDialog(); editor.hidden = true; library.hidden = false;
    dialog.showModal(); document.dispatchEvent(new CustomEvent('sautilink:music-dialog-toggle')); void load();
  }
  const tools = document.querySelector('#sauti-composer .composer-tools') || document.querySelector('#sauti-composer .composer-toolbar');
  const button = action('♫ Audio', open, 'composer-audio-button'); button.id = 'sauti-audio-add';
  if (tools) tools.prepend(button); else document.getElementById('sauti-body')?.before(button);
  summary = element('div', 'composer-audio-selection'); summary.hidden = true; document.getElementById('sauti-body')?.after(summary);
  return {
    client, open, get value() { return chosen; },
    set(value) { chosen = value && audioClipUrl(value) ? { ...value } : null; update(); },
    clear() { chosen = null; request++; controller?.abort(); stop(); if (dialog?.open) dialog.close(); resetAccount(); update(); },
    async details(selection) {
      resetAccount();
      if (!dialog) createDialog(); editor.hidden = true; library.hidden = true;
      dialog.showModal(); document.dispatchEvent(new CustomEvent('sautilink:music-dialog-toggle')); editor.hidden = false; editor.replaceChildren(element('h3', '', selection.title), element('p', '', selection.artist));
      const play = action('Play preview', () => preview(selection, play));
      const save = action('Save', () => void saveTrack({ id: selection.trackId }, save));
      editor.append(play, action('Create post with this audio', () => { stop(); dialog.close(); chosen = { ...selection }; update(); onCreate(chosen); }), save);
      status.textContent = '';
      const member = owner(), sequence = ++request;
      try {
        await Promise.allSettled([...saving.values()]);
        const epoch = saveEpoch;
        const result = await client.savedIds();
        if (sequence !== request || member !== owner() || !dialog.open) return;
        if (epoch === saveEpoch) saved = result;
        save.textContent = saved.has(selection.trackId) ? 'Saved' : 'Save';
        save.setAttribute('aria-pressed', String(saved.has(selection.trackId)));
      } catch { if (sequence === request && dialog.open) status.textContent = 'Saved audio could not load. Try again.'; }
    },
  };
}
