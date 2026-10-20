import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const app = await read('src/app.js');
const formats = await read('src/composer-formats.js');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.dataset = {}; this.attrs = new Map(); this.listeners = new Map();
    this.copy = ''; this.className = ''; this.value = ''; this.hidden = false;
    this.disabled = false; this.pauseCalls = 0; this.isConnected = true;
  }
  get textContent() { return this.copy + this.children.map((child) => child.textContent).join(''); }
  get lastElementChild() { return this.children.at(-1) || null; }
  set textContent(value) { this.copy = String(value); this.children = []; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  append(...children) { children.forEach((child) => this.insertBefore(child, null)); }
  prepend(...children) { [...children].reverse().forEach((child) => this.insertBefore(child, this.children[0] || null)); }
  before(child) { this.parentNode.insertBefore(child, this); }
  after(child) { this.parentNode.insertBefore(child, this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null); }
  insertBefore(child, before) {
    child.remove(); child.parentNode = this;
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, child);
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceChildren(...children) { this.children.forEach((child) => { child.parentNode = null; }); this.children = []; this.copy = ''; this.append(...children); }
  matches(selector) {
    if (selector === ':disabled') return this.disabled;
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    if (selector.startsWith('[')) {
      const key = selector.slice(6, -1).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      return key in this.dataset;
    }
    return this.tagName.toLowerCase() === selector;
  }
  querySelectorAll(selector) {
    if (selector.includes(' ')) {
      const [first, ...rest] = selector.split(' ');
      return this.querySelectorAll(first).flatMap((child) => child.querySelectorAll(rest.join(' ').replace(/^>\s*/, '')));
    }
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) { this.listeners.get(event.type)?.forEach((listener) => listener(event)); return true; }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click' }); }
  focus() { this.ownerDocument.activeElement = this; }
  pause() { this.pauseCalls += 1; }
}

function mediaHarness() {
  const list = new Element(); const panel = new Element(); const count = new Element(); const add = new Element();
  const document = { activeElement: null, createElement: (tag) => new Element(tag) };
  let requests = 0; const deferred = []; const revoked = [];
  const context = {
    document, navigator: { onLine: true }, currentMember: { id: 'member' }, composerMedia: [],
    byId: (id) => ({ 'sauti-media-list': list, 'sauti-media-queue': panel, 'sauti-media-count': count, 'sauti-media-add': add })[id],
    composerMediaStatusLabel: (item) => item.status,
    fetchSautiMediaBlobUrl: () => { requests += 1; return new Promise((resolve, reject) => deferred.push({ resolve, reject })); },
    URL: { revokeObjectURL: (url) => revoked.push(url) },
  };
  const code = app.slice(app.indexOf('async function ensureComposerMediaPreview('), app.indexOf('function uploadWithProgress('));
  const render = runInNewContext(`${code}\nrenderComposerMedia;`, context);
  return { context, list, panel, count, add, document, render, deferred, revoked, get requests() { return requests; } };
}

test('composer media keeps the same playable video and focused alt field through upload transitions and reordering', () => {
  const h = mediaHarness();
  const item = { localId: 'one', name: 'Clip.mp4', mediaKind: 'video', localUrl: 'blob:one', status: 'uploading', progress: 3, altText: '' };
  const image = { localId: 'two', name: 'Photo.webp', mediaKind: 'image', localUrl: 'blob:two', status: 'ready', altText: 'Photo' };
  h.context.composerMedia = [item, image]; h.render();
  const row = h.list.children[0]; const video = row.querySelector('video'); const alt = row.querySelector('input');
  assert.equal(video.controls, true); assert.equal(video.playsInline, true);
  const builtInControls = new Element(); builtInControls.className = 'sl-media-controls';
  row.querySelector('.composer-media-preview').append(builtInControls);
  video.currentTime = 8.2; video.paused = false;
  h.document.activeElement = alt; alt.value = 'Typing an accessible description'; alt.selectionStart = 9;
  for (const status of ['uploading', 'finalizing', 'ready']) {
    item.status = status; item.progress += 10; h.render();
    assert.equal(h.list.children[0], row); assert.equal(row.querySelector('video'), video);
    assert.equal(video.currentTime, 8.2); assert.equal(video.pauseCalls, 0);
    assert.equal(row.querySelector('.sl-media-controls'), builtInControls);
    assert.equal(row.querySelector('input'), alt); assert.equal(alt.selectionStart, 9);
    assert.equal(alt.value, 'Typing an accessible description');
  }
  h.context.composerMedia = [image, item]; h.render();
  assert.equal(h.list.children[1], row); assert.equal(row.querySelector('video'), video);
  item.status = 'error'; h.render(); assert.equal(row.querySelector('[data-media-retry]').hidden, false);
  h.context.composerMedia = [image]; h.render();
  assert.equal(video.pauseCalls, 1); assert.equal(h.list.children.length, 1);
  assert.equal(h.count.textContent, '1 / 4');
});

test('recovered media deduplicates preview fetches and discards results from replaced draft items', async () => {
  const h = mediaHarness();
  const item = { localId: 'restored', id: 'remote-id', mediaKind: 'video', status: 'ready' };
  h.context.composerMedia = [item]; h.render(); h.render(); h.render();
  assert.equal(h.requests, 1);
  h.context.composerMedia = [{ ...item }]; h.render();
  assert.equal(h.requests, 2, 'a replacement draft item starts its own preview without waiting for an obsolete fetch');
  h.deferred[0].resolve('blob:stale');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.revoked, ['blob:stale']);
  assert.equal(h.context.composerMedia[0].localUrl, undefined);
  h.render(); assert.equal(h.requests, 2);
  h.deferred[1].resolve('blob:current');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.list.querySelector('video').src, 'blob:current');
  assert.equal(h.list.querySelector('video').controls, true);
});

function choiceHarness() {
  const observers = []; let originalWrites = 0; let changes = 0;
  const document = { activeElement: null, createElement: (tag) => { const node = new Element(tag); node.ownerDocument = document; return node; }, createTextNode: (text) => { const node = new Element('text'); node.textContent = text; return node; } };
  class Select extends Element {
    constructor() { super('select'); this.options = []; }
  }
  const valueDescriptor = { configurable: true, get() { return this.options.find((option) => option.selected)?.value || ''; },
    set(value) { originalWrites += 1; this.options?.forEach((option) => { option.selected = option.value === value; }); } };
  Object.defineProperty(Select.prototype, 'value', valueDescriptor);
  Object.defineProperty(Select.prototype, 'selectedIndex', { configurable: true, get() { return this.options.findIndex((option) => option.selected); },
    set(value) { this.options.forEach((option, index) => { option.selected = index === value; }); } });
  const select = new Select();
  Object.defineProperty(select, 'value', { ...valueDescriptor }); // Existing built-in adapter descriptor.
  const option = (value, label, extra = {}) => ({ value, label, textContent: label, parentElement: select, selected: false, ...extra });
  select.options = [option('public', 'Public', { selected: true }), option('followers', 'Followers'), option('mentioned', 'Only people mentioned')];
  const host = new Element();
  const code = formats.slice(formats.indexOf('function composerChoiceOptions('), formats.indexOf('function installNativeComposerPresentation('));
  const install = runInNewContext(`${code}\ninstallComposerChoices;`, {
    document, HTMLSelectElement: Select,
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
    composerSectionIcon: () => new Element('svg'), Event: class { constructor(type) { this.type = type; } },
  });
  select.addEventListener('change', () => { changes += 1; });
  const refresh = install(select, 'Audience', 'globe', host);
  return { select, host, document, observers, option, refresh, get originalWrites() { return originalWrites; }, get changes() { return changes; } };
}

test('native audience chips preserve all Web options, dynamic Room options and disabled gates', () => {
  const h = choiceHarness();
  const chips = h.host.querySelectorAll('button');
  assert.deepEqual(chips.map((chip) => chip.dataset.composerChoice), ['public', 'followers', 'mentioned']);
  chips[1].click();
  assert.equal(h.select.value, 'followers'); assert.equal(h.originalWrites, 2); assert.equal(h.changes, 1);
  assert.equal(chips[1].getAttribute('aria-checked'), 'true');
  assert.equal(chips[1].dataset.active, 'true'); assert.equal(chips[0].dataset.active, 'false');
  const group = { tagName: 'OPTGROUP', label: 'Room', disabled: false };
  h.select.options.push(h.option('circle:private', 'Developers', { parentElement: group })); h.refresh();
  const room = h.host.querySelectorAll('button')[3];
  assert.equal(room.textContent, 'Room: Developers'); room.click(); assert.equal(h.select.value, 'circle:private');
  group.disabled = true; h.observers[0](); assert.equal(room.disabled, true);
  h.select.disabled = true; h.refresh(); assert.ok(h.host.querySelectorAll('button').every((chip) => chip.disabled));
  h.select.disabled = false; group.disabled = false; h.select.value = 'mentioned';
  assert.equal(h.host.querySelectorAll('button')[2].getAttribute('aria-checked'), 'true');
  const retained = h.host.querySelectorAll('button')[0]; h.refresh(); h.refresh();
  assert.equal(h.host.querySelectorAll('button')[0], retained);
});

test('composer chips use radio keyboard navigation and silent draft restoration keeps selection current', () => {
  const h = choiceHarness(); const choices = h.host.querySelector('.composer-native-chips');
  const chips = choices.querySelectorAll('button');
  h.document.activeElement = chips[0];
  choices.dispatchEvent({ type: 'keydown', key: 'End', preventDefault() {} });
  assert.equal(h.select.value, 'mentioned'); assert.equal(h.document.activeElement, chips[2]);
  h.select.selectedIndex = 1;
  assert.equal(chips[1].getAttribute('aria-checked'), 'true'); assert.equal(chips[1].tabIndex, 0);
});

test('native composer arrangement retains the original submit, media actions and identity nodes', () => {
  const make = (tag, className = '') => { const node = new Element(tag); node.className = className; return node; };
  const dialog = make('dialog'); const form = make('form'); const header = make('header');
  const content = make('div'); const body = make('div', 'composer-body'); const author = make('div', 'composer-author');
  const avatar = make('span', 'avatar'); const submit = make('button'); submit.disabled = true;
  const tools = make('div', 'composer-tools'); const camera = make('button'); camera.onclick = () => 'camera'; tools.append(camera);
  const actions = make('div', 'composer-actions'); const drafts = make('button'); actions.append(tools, drafts);
  const queue = make('section'); const meta = make('div', 'composer-meta');
  const preview = make('div', 'composer-media-preview'); const video = make('video'); preview.append(video); queue.append(preview);
  const audience = make('select'); const replies = make('select');
  const nodes = { 'sauti-composer-dialog': dialog, 'sauti-audience': audience, 'sauti-reply-access': replies,
    'member-avatar': avatar, 'sauti-submit': submit, 'sauti-media-queue': queue };
  header.append(submit); body.append(author, queue, meta, actions); content.append(avatar, body); form.append(header, content); dialog.append(form);
  const documentEvents = new Map();
  const document = { getElementById: (id) => nodes[id], createElement: (tag) => make(tag),
    addEventListener: (type, callback) => documentEvents.set(type, callback) };
  const window = {}; let refreshes = 0;
  const code = formats.slice(formats.indexOf('function installNativeComposerPresentation('), formats.indexOf('function setPickerMode('));
  const install = runInNewContext(`${code}\ninstallNativeComposerPresentation;`, {
    document, window, installComposerChoices: () => () => { refreshes += 1; },
    installComposerViewport: () => ({ refresh() {} }),
    MutationObserver: class { observe() {} },
  });
  install(); const count = body.children.length; install();
  assert.equal(body.children.length, count); assert.equal(author.children[0], avatar);
  assert.equal(submit.parentNode.className, 'composer-native-publish'); assert.equal(submit.disabled, true);
  assert.equal(tools.parentNode, body); assert.equal(body.children.indexOf(tools) + 1, body.children.indexOf(queue));
  assert.equal(body.children[body.children.indexOf(meta) - 1]?.id, 'composer-native-choices', 'audience and reply choices stay immediately before composer metadata without a quote preview');
  assert.equal(tools.children[0], camera); assert.equal(camera.onclick(), 'camera');
  assert.equal(drafts.parentNode, actions); window.SautiLinkComposerPresentation.refresh(); assert.equal(refreshes, 2);
  dialog.dispatchEvent({ type: 'close' }); assert.equal(video.pauseCalls, 1);
  document.hidden = true; documentEvents.get('visibilitychange')(); assert.equal(video.pauseCalls, 2);
});

test('native composer styling stays scoped, compact and keeps the existing upload limits', async () => {
  const css = await read('app/assets/composer-native.css');
  assert.match(css, /#sauti-body[\s\S]*?font-size: 16px;[\s\S]*?line-height: 22px;/);
  assert.match(css, /\.composer-media-preview :is\(img, video\)[\s\S]*?height: 210px;[\s\S]*?object-fit: contain/);
  assert.match(formats, /SHORT_VIDEO_LIMIT_SECONDS = 60/);
  assert.match(formats, /MAX_TRIMMABLE_VIDEO_SECONDS = 120/);
  assert.match(formats, /fileInput\.addEventListener\('change', validateSelectedShortVideo, true\)/);
  assert.match(formats, /installNativeComposerPresentation\(\)/);
  assert.match(formats, /footer\.append\(submit\)/);
  assert.match(formats, /composer-native\.css\?v=20261020-v1111/);
  assert.doesNotMatch(app.slice(app.indexOf('async function ensureComposerMediaPreview('), app.indexOf('function uploadWithProgress(')), /\/api\/|currentAuthorizationHeader|supabase/);
});

test('the polished poll retains two required choices, four-choice limit and remaining input values when removing an option', () => {
  const root = new Element(); const textarea = new Element('textarea'); root.append(textarea);
  const document = { activeElement: null,
    createElement(tag) { const node = new Element(tag); node.ownerDocument = this; return node; },
    createTextNode(text) { const node = this.createElement('text'); node.textContent = text; return node; },
    getElementById(id) {
      return [...root.querySelectorAll('section'), ...root.querySelectorAll('button')].find((node) => node.id === id) || null;
    },
  };
  const code = formats.slice(formats.indexOf('function optionRow('), formats.indexOf('function buildPollTool('));
  const build = runInNewContext(`${code}\nbuildPollEditor;`, {
    document, POLL_MIN_OPTIONS: 2, POLL_MAX_OPTIONS: 4, POLL_OPTION_MAX_LENGTH: 80,
    pollEditor: () => document.getElementById('sauti-poll-editor'),
    composerSectionIcon: () => document.createElement('svg'),
  });
  const editor = build(textarea); editor.hidden = false;
  const options = editor.querySelector('.composer-poll-options');
  const add = document.getElementById('sauti-poll-add-option');
  const count = editor.querySelector('.composer-poll-count');
  assert.equal(options.children.length, 2); assert.equal(count.textContent, '2 / 4 options');
  assert.ok(options.children.every((row) => !row.querySelector('button')), 'the two required choices cannot be removed');
  add.click(); add.click(); add.click();
  assert.equal(options.children.length, 4); assert.equal(add.disabled, true);
  assert.equal(count.textContent, '4 / 4 options');
  const retained = options.children[3].querySelector('input'); retained.value = 'Keep my choice';
  assert.equal(retained.maxLength, 80);
  assert.equal(document.activeElement, retained);
  options.children[2].querySelector('button').click();
  assert.equal(options.children.length, 3); assert.equal(add.disabled, false);
  assert.equal(options.children[2].querySelector('input'), retained);
  assert.equal(retained.value, 'Keep my choice'); assert.equal(retained.getAttribute('aria-label'), 'Poll option 3');
  assert.equal(options.children[2].querySelector('.composer-poll-number').textContent, '03');
  assert.equal(options.children[2].querySelector('button').getAttribute('aria-label'), 'Remove poll option 3');
  assert.equal(count.textContent, '3 / 4 options');
  editor.querySelector('.composer-poll-remove').click();
  assert.equal(editor.hidden, true); assert.equal(options.children.length, 2);
  assert.equal(count.textContent, '2 / 4 options');
  assert.ok(options.querySelectorAll('input').every((input) => input.value === ''));
});

test('preparing several existing video attachments retains every selected trimmed clip', async () => {
  const first = { name: 'first.mp4', type: 'video/mp4' }; const second = { name: 'second.mp4', type: 'video/mp4' };
  const photo = { name: 'photo.webp', type: 'image/webp' }; const trimmed = [];
  const input = { files: [first, photo, second], dataset: {}, value: 'selection', dispatchEvent(event) { this.event = event; } };
  const code = formats.slice(formats.indexOf('async function validateSelectedShortVideo('), formats.indexOf('function updateMediaCopy('));
  const validate = runInNewContext(`${code}\nvalidateSelectedShortVideo;`, {
    SHORT_VIDEO_LIMIT_SECONDS: 60, MAX_TRIMMABLE_VIDEO_SECONDS: 120,
    videoDuration: async () => 62,
    promptVideoTrim: async (file) => { const clip = { ...file, name: `${file.name}-trimmed` }; trimmed.push(clip); return clip; },
    DataTransfer: class { constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; } },
    Event: class { constructor(type) { this.type = type; } }, composerMessage: () => assert.fail('valid clips should prepare'),
  });
  let stopped = 0;
  await validate({ currentTarget: input, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped += 1; } });
  assert.deepEqual(input.files, [trimmed[0], photo, trimmed[1]]);
  assert.equal(input.event.type, 'change'); assert.equal(input.dataset.shortVideoValidated, 'true'); assert.equal(stopped, 1);
  await validate({ currentTarget: input }); assert.equal(input.dataset.shortVideoValidated, undefined);
});

test('the shared trim dialog can export consecutive clips while keeping controls locked only during each export', async () => {
  const fields = Object.fromEntries(['preview', 'start', 'end', 'start-output', 'end-output', 'summary', 'status', 'use']
    .map((name) => [`[data-trim-${name}]`, new Element(name === 'preview' ? 'video' : 'input')]));
  const preview = fields['[data-trim-preview]'];
  preview.removeAttribute = (name) => { if (name === 'src') preview.src = ''; };
  const use = fields['[data-trim-use]'];
  const cancels = [new Element('button'), new Element('button')];
  const revoked = []; const exports = [];
  let closes = 0; let opens = 0; let resolveExport;
  const dialog = {
    open: false,
    querySelector: (selector) => fields[selector],
    querySelectorAll: () => cancels,
    showModal() { this.open = true; opens += 1; },
    close() { this.open = false; closes += 1; },
  };
  const code = formats.slice(formats.indexOf('function promptVideoTrim('), formats.indexOf('async function validateSelectedShortVideo('));
  const prompt = runInNewContext(`${code}\npromptVideoTrim;`, {
    trimDialog: () => dialog, MIN_TRIM_SECONDS: 1, SHORT_VIDEO_LIMIT_SECONDS: 60,
    formatTrimTime: String,
    URL: { createObjectURL: (file) => `blob:${file.name}`, revokeObjectURL: (url) => revoked.push(url) },
    trimVideoFile: (file, start, end, onProgress) => {
      exports.push({ file, start, end });
      onProgress(50);
      return new Promise((resolve) => { resolveExport = resolve; });
    },
  });
  const click = (button) => button.disabled ? undefined : button.onclick();
  for (const [name, duration] of [['first.mp4', 90], ['second.mp4', 95]]) {
    const file = { name };
    const result = prompt(file, duration);
    assert.equal(dialog.open, true);
    assert.equal(use.disabled, false, 'each fresh clip must allow export');
    assert.ok(cancels.every((button) => !button.disabled), 'each fresh clip must allow cancellation');
    assert.equal(fields['[data-trim-status]'].textContent, '');
    const exporting = click(use);
    assert.equal(use.disabled, true);
    assert.ok(cancels.every((button) => button.disabled));
    assert.equal(fields['[data-trim-status]'].textContent, 'Trimming… 50%');
    assert.equal(click(use), undefined, 'a repeated click cannot start another encoder');
    cancels.forEach(click);
    dialog.oncancel({ preventDefault() {} });
    assert.equal(dialog.open, true, 'Escape cannot interrupt an active export');
    const clip = { name: `${name}-trimmed` };
    resolveExport(clip);
    await exporting;
    assert.equal(await result, clip);
    assert.equal(dialog.open, false);
    assert.equal(preview.src, '');
  }
  assert.equal(opens, 2);
  assert.equal(closes, 2);
  assert.equal(preview.pauseCalls, 2);
  assert.deepEqual(exports, [
    { file: { name: 'first.mp4' }, start: 0, end: 60 },
    { file: { name: 'second.mp4' }, start: 0, end: 60 },
  ]);
  assert.deepEqual(revoked, ['blob:first.mp4', 'blob:second.mp4']);
});

test('video trimming preserves a real capture failure instead of masking it during cleanup', async () => {
  const revoked = []; let paused = 0; let released = false;
  const video = { duration: 62, pause() { paused += 1; }, removeAttribute(name) { if (name === 'src') released = true; } };
  const code = formats.slice(formats.indexOf('async function trimVideoFile('), formats.indexOf('function trimDialog('));
  const trim = runInNewContext(`${code}\ntrimVideoFile;`, {
    supportedMp4RecorderType: () => 'video/mp4',
    HTMLMediaElement: { prototype: { captureStream: () => ({ getVideoTracks: () => [], getTracks: () => [] }) } },
    URL: { createObjectURL: () => 'blob:input', revokeObjectURL: (value) => revoked.push(value) },
    document: { createElement: () => video }, window: { clearTimeout() {}, cancelAnimationFrame() {} },
    waitForMediaEvent: async () => {},
  });
  await assert.rejects(trim({ name: 'clip.mp4' }, 1, 2), /could not read the selected video track/);
  assert.equal(paused, 1); assert.equal(released, true); assert.deepEqual(revoked, ['blob:input']);
});

test('composer follows the visual keyboard viewport only while open and releases listeners on close or auth entry', () => {
  const eventTarget = () => ({ listeners: new Map(),
    addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); },
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); },
    emit(type) { this.listeners.get(type)?.forEach((callback) => callback()); },
    count(type) { return this.listeners.get(type)?.size || 0; } });
  const viewport = Object.assign(eventTarget(), { height: 720, offsetTop: 0 });
  const frames = new Map(); let serial = 0; const observers = []; const style = new Map();
  const window = Object.assign(eventTarget(), { visualViewport: viewport, innerHeight: 820,
    requestAnimationFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id) });
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); };
  let auth = false; const member = { hidden: false };
  const document = { body: { classList: { contains: () => auth } }, getElementById: () => member, documentElement: { clientHeight: 820 } };
  const dialog = Object.assign(eventTarget(), { open: false, style: {
    getPropertyValue: (name) => style.get(name) || '', setProperty: (name, value) => style.set(name, value), removeProperty: (name) => style.delete(name),
  } });
  const code = formats.slice(formats.indexOf('function installComposerViewport('), formats.indexOf('function installNativeComposerPresentation('));
  const install = runInNewContext(`${code}\ninstallComposerViewport;`, { window, document,
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} } });
  const controller = install(dialog); assert.equal(install(dialog), controller);
  assert.equal(viewport.count('resize'), 0); assert.equal(style.size, 0); assert.equal(observers.length, 1);
  dialog.open = true; observers[0]();
  assert.equal(viewport.count('resize'), 1); assert.equal(viewport.count('scroll'), 1); assert.equal(window.count('resize'), 1);
  viewport.height = 352; viewport.offsetTop = 24; viewport.emit('resize'); viewport.emit('scroll'); window.emit('resize');
  assert.equal(frames.size, 1, 'keyboard resize and scroll are coalesced'); flush();
  assert.equal(style.get('--composer-viewport-height'), '352px'); assert.equal(style.get('--composer-viewport-top'), '24px');
  viewport.emit('resize'); dialog.open = false; dialog.emit('close');
  assert.equal(frames.size, 0); assert.equal(style.size, 0); assert.equal(viewport.count('resize'), 0); assert.equal(viewport.count('scroll'), 0); assert.equal(window.count('resize'), 0);
  dialog.open = true; auth = true; observers[0](); assert.equal(frames.size, 0); assert.equal(style.size, 0);
  auth = false; observers[0](); flush(); assert.equal(viewport.count('resize'), 1);
  member.hidden = true; observers[0](); assert.equal(style.size, 0); assert.equal(viewport.count('resize'), 0);
  member.hidden = false; observers[0](); window.emit('pagehide'); assert.equal(frames.size, 0); assert.equal(viewport.count('resize'), 0);
  window.emit('pageshow'); flush(); assert.equal(viewport.count('resize'), 1); assert.equal(window.count('pagehide'), 1);
});

function trimAudioHarness({ resumeFails = false, constructorFails = false } = {}) {
  const track = (kind) => ({ kind, stops: 0, stop() { this.stops += 1; } });
  const videoTrack = track('video'); const audioTrack = track('audio'); const generatedAudio = track('audio');
  class MediaStream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getVideoTracks() { return this.tracks.filter((item) => item.kind === 'video'); }
    getAudioTracks() { return this.tracks.filter((item) => item.kind === 'audio'); }
  }
  const original = new MediaStream([videoTrack, audioTrack]); const contexts = []; const revoked = [];
  class AudioContext {
    constructor(options) {
      this.options = options; this.state = 'suspended'; this.closed = 0; contexts.push(this);
      this.source = { disconnects: 0, connect: (destination) => { this.connected = destination; }, disconnect() { this.disconnects += 1; } };
      this.output = { stream: new MediaStream([generatedAudio]), disconnects: 0, disconnect() { this.disconnects += 1; } };
    }
    createMediaStreamSource(stream) { this.input = stream; return this.source; }
    createMediaStreamDestination() { return this.output; }
    async resume() { if (resumeFails) throw new Error('Audio graph could not resume'); this.state = 'running'; }
    async close() { this.closed += 1; this.state = 'closed'; }
  }
  const video = { duration: 62, pause() {}, removeAttribute() {} };
  const code = formats.slice(formats.indexOf('async function prepareTrimRecordingStream('), formats.indexOf('function trimDialog('));
  const functions = runInNewContext(`${code}\n({ prepareTrimRecordingStream, trimVideoFile });`, {
    window: { AudioContext, clearTimeout() {}, cancelAnimationFrame() {} }, MediaStream,
    supportedMp4RecorderType: () => 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    HTMLMediaElement: { prototype: { captureStream: () => original } },
    URL: { createObjectURL: () => 'blob:audio-source', revokeObjectURL: (url) => revoked.push(url) },
    document: { createElement: () => video }, waitForMediaEvent: async () => {},
    MediaRecorder: class { constructor() { if (constructorFails) throw new Error('Encoder configuration failed'); } },
  });
  return { ...functions, original, videoTrack, audioTrack, generatedAudio, contexts, revoked, MediaStream };
}

test('MP4 trimming resamples captured audio to 48kHz while retaining the original video and sound graph', async () => {
  const h = trimAudioHarness(); const recording = await h.prepareTrimRecordingStream(h.original); const context = h.contexts[0];
  assert.equal(context.options.sampleRate, 48_000); assert.equal(context.input, h.original);
  assert.equal(context.connected, context.output); assert.equal(recording.stream.getVideoTracks()[0], h.videoTrack);
  assert.equal(recording.stream.getAudioTracks()[0], h.generatedAudio); assert.equal(recording.stream.getAudioTracks().length, 1);
  assert.equal(h.audioTrack.stops, 0); assert.equal(h.videoTrack.stops, 0);
  await recording.release(); assert.equal(context.source.disconnects, 1); assert.equal(context.output.disconnects, 1);
  assert.equal(h.generatedAudio.stops, 1); assert.equal(context.closed, 1);
});

test('video-only trimming keeps its source stream without creating an unnecessary audio context', async () => {
  const h = trimAudioHarness(); const silent = new h.MediaStream([h.videoTrack]);
  const recording = await h.prepareTrimRecordingStream(silent); assert.equal(recording.stream, silent);
  assert.equal(h.contexts.length, 0); await recording.release(); assert.equal(h.videoTrack.stops, 0);
});

test('audio graph and owned tracks are cleaned if audio preparation or encoder construction fails', async () => {
  const failedResume = trimAudioHarness({ resumeFails: true });
  await assert.rejects(failedResume.prepareTrimRecordingStream(failedResume.original), /could not resume/);
  assert.equal(failedResume.contexts[0].closed, 1); assert.equal(failedResume.generatedAudio.stops, 1);
  assert.equal(failedResume.contexts[0].source.disconnects, 1); assert.equal(failedResume.audioTrack.stops, 0);
  const failedRecorder = trimAudioHarness({ constructorFails: true });
  await assert.rejects(failedRecorder.trimVideoFile({ name: 'source.mp4' }, 1, 3), /Encoder configuration failed/);
  assert.equal(failedRecorder.contexts[0].closed, 1); assert.equal(failedRecorder.generatedAudio.stops, 1);
  assert.equal(failedRecorder.audioTrack.stops, 1); assert.equal(failedRecorder.videoTrack.stops, 1);
  assert.deepEqual(failedRecorder.revoked, ['blob:audio-source']);
});
