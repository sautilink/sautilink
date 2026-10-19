import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/member-builtin-media.js', import.meta.url), 'utf8');

function harness({ kind = 'audio', auth = false, existing = false, playError = false } = {}) {
  let doc;
  const callbacks = [];
  const microtasks = [];
  const writes = [];
  const calls = { play: 0, pause: 0, load: 0, fullscreen: 0, pip: 0 };
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = new Map(); this.events = new Map();
      this.textContent = ''; this.value = ''; this.open = false; this.paused = true; this.ended = false;
      this.currentTime = 12; this.duration = 90; this.volume = 0.7; this.muted = false; this.playbackRate = 1.25;
      this.currentSrc = ''; this.srcObject = null; this.readyState = 4; this.error = null; this.disablePictureInPicture = false;
      this.controlsList = { contains: name => (this.getAttribute('controlslist') || '').split(/\s+/).includes(name) };
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      };
    }
    get textContent() { return this._text || ''; }
    set textContent(value) { this._text = String(value); writes.push(['text', value]); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get hidden() { return this.attributes.has('hidden'); }
    set hidden(value) { value ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
    get disabled() { return this.attributes.has('disabled'); }
    set disabled(value) { value ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }
    get controls() { return this.attributes.has('controls'); }
    set controls(value) { value ? this.setAttribute('controls', '') : this.removeAttribute('controls'); }
    get parentElement() { return this.parentNode; }
    get isConnected() { return this === doc.body || Boolean(this.parentNode?.isConnected); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); writes.push([name, value]); }
    removeAttribute(name) { if (this.attributes.delete(name)) writes.push([name, null]); }
    hasAttribute(name) { return this.attributes.has(name); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    after(node) { node.remove(); const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this) + 1, 0, node); node.parentNode = parent; }
    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
    replaceChildren(...nodes) { this.children.forEach(node => { node.parentNode = null; }); this.children = []; this.append(...nodes); }
    closest(selector) {
      for (let node = this; node; node = node.parentNode) {
        if (selector.split(',').some(part => { part = part.trim(); return part.startsWith('.') ? node.classList.contains(part.slice(1)) : part.startsWith('#') ? node.id === part.slice(1) : part === '[data-sl-built-in="media"]' && node.getAttribute('data-sl-built-in') === 'media'; })) return node;
      }
      return null;
    }
    querySelector(selector) {
      if (selector === 'source[src]') return this.all().find(node => node.tagName === 'SOURCE' && node.hasAttribute('src')) || null;
      throw new Error(`Unexpected selector ${selector}`);
    }
    all() { return [this, ...this.children.flatMap(node => node.all())]; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    addEventListener(event, callback) { if (!this.events.has(event)) this.events.set(event, new Set()); this.events.get(event).add(callback); }
    removeEventListener(event, callback) { this.events.get(event)?.delete(callback); }
    fire(type, extra = {}) {
      const event = { type, target: this, stopPropagation() {}, preventDefault() { this.prevented = true; }, ...extra };
      for (const callback of this.events.get(type) || []) callback(event);
      return event;
    }
    click() { if (!this.disabled && !this.hidden) this.fire('click'); }
    focus() { doc.activeElement = this; }
    play() { calls.play++; if (playError) return Promise.reject(new Error('blocked')); this.paused = false; this.fire('play'); this.fire('playing'); return Promise.resolve(); }
    pause() { calls.pause++; this.paused = true; this.fire('pause'); }
    load() { calls.load++; throw new Error('Presentation must not load media'); }
  }
  doc = {
    body: new Node('body'), readyState: 'complete', events: new Map(), pictureInPictureEnabled: true,
    createElement: tag => new Node(tag), createElementNS: (_namespace, tag) => new Node(tag),
    getElementById(id) { return this.body.all().find(node => node.id === id) || null; },
    querySelectorAll(selector) {
      assert.equal(selector, 'audio[controls], video[controls]');
      return this.body.all().filter(node => ['AUDIO', 'VIDEO'].includes(node.tagName) && node.controls);
    },
    addEventListener(type, callback) { this.events.set(type, callback); },
    exitFullscreen() { this.fullscreenElement = null; this.events.get('fullscreenchange')?.(); return Promise.resolve(); },
    exitPictureInPicture() { this.pictureInPictureElement = null; return Promise.resolve(); },
  };
  if (auth) doc.body.classList.add('auth-entry');
  const member = new Node('main'); member.id = 'member-view'; doc.body.append(member);
  const host = new Node('section'); member.append(host);
  if (existing) host.classList.add('sauti-media-tile');
  host.requestFullscreen = () => { calls.fullscreen++; doc.fullscreenElement = host; doc.events.get('fullscreenchange')?.(); return Promise.resolve(); };
  const media = new Node(kind); media.setAttribute('src', '/sample-media'); media.setAttribute('controls', 'controls'); host.append(media);
  media.requestPictureInPicture = () => { calls.pip++; doc.pictureInPictureElement = media; media.fire('enterpictureinpicture'); return Promise.resolve(); };
  const window = { location: { href: 'http://localhost:4177/', origin: 'http://localhost:4177' } };
  runInNewContext(source, { document: doc, window, URL, queueMicrotask: callback => microtasks.push(callback), MutationObserver: class { constructor(callback) { callbacks.push(callback); } observe() {} } });
  const find = className => host.all().find(node => node.classList.contains(className));
  const mutate = () => {
    callbacks.forEach(callback => callback([{ target: doc.body }]));
    let count = 0; while (microtasks.length) { assert.ok(count++ < 10, 'bounded refresh'); microtasks.shift()(); }
  };
  return { Node, doc, member, host, media, window, calls, find, mutate, writes };
}

test('custom controls preserve native media identity, sources, position and playback state without loading', () => {
  const h = harness();
  assert.equal(h.host.children[0], h.media, 'original remains the direct child');
  assert.equal(h.media.getAttribute('src'), '/sample-media');
  assert.equal(h.media.currentTime, 12); assert.equal(h.media.duration, 90);
  assert.equal(h.media.volume, 0.7); assert.equal(h.media.playbackRate, 1.25); assert.equal(h.media.paused, true);
  assert.equal(h.media.controls, false);
  assert.deepEqual(h.calls, { play: 0, pause: 0, load: 0, fullscreen: 0, pip: 0 });
  assert.equal(h.find('sl-media-time').textContent, '0:12 / 1:30');
  assert.equal(h.find('sl-media-seek').getAttribute('aria-valuetext'), '0:12 of 1:30');
});

test('play, pause, seeking, mute, volume and speed act on the original node and retain native events', async () => {
  const h = harness(); let plays = 0;
  h.media.addEventListener('play', () => plays++);
  h.find('sl-media-play').click();
  assert.equal(plays, 1); assert.equal(h.media.paused, false);
  assert.equal(h.find('sl-media-play').getAttribute('aria-label'), 'Pause audio');
  h.find('sl-media-play').click(); assert.equal(h.media.paused, true);
  h.find('sl-media-seek').value = '46.5'; h.find('sl-media-seek').fire('input');
  assert.equal(h.media.currentTime, 46.5);
  h.find('sl-media-mute').click(); assert.equal(h.media.muted, true);
  h.find('sl-media-volume').value = '0.35'; h.find('sl-media-volume').fire('input');
  assert.equal(h.media.volume, 0.35); assert.equal(h.media.muted, false);
  h.find('sl-media-rates').children.find(node => node.getAttribute('data-rate') === '1.5').click();
  assert.equal(h.media.playbackRate, 1.5);
  h.media.currentTime = 80; h.media.fire('timeupdate');
  assert.equal(h.find('sl-media-time').textContent, '1:20 / 1:30');
  h.media.volume = 0; h.media.fire('volumechange');
  assert.equal(h.find('sl-media-mute').getAttribute('aria-label'), 'Unmute audio');
  assert.equal(h.calls.load, 0);
});

test('video display actions are explicit, capability-gated and existing SautiLink players are excluded', () => {
  const h = harness({ kind: 'video' });
  assert.equal(h.find('sl-media-fullscreen').hidden, false);
  assert.equal(h.find('sl-media-pip').hidden, false);
  assert.equal(h.calls.fullscreen + h.calls.pip, 0);
  h.find('sl-media-fullscreen').click(); assert.equal(h.calls.fullscreen, 1);
  h.find('sl-media-fullscreen').click(); assert.equal(h.doc.fullscreenElement, null);
  h.find('sl-media-pip').click(); assert.equal(h.calls.pip, 1);
  h.media.disablePictureInPicture = true; h.media.setAttribute('controlslist', 'nofullscreen'); h.mutate();
  assert.equal(h.find('sl-media-pip').hidden, true); assert.equal(h.find('sl-media-fullscreen').hidden, true);
  const prior = harness({ kind: 'video', existing: true });
  assert.equal(prior.find('sl-media-controls'), undefined);
  assert.equal(prior.media.controls, true);
});

test('live metadata, hidden/error states and failed playback keep usable controls without changing the source', async () => {
  const h = harness({ playError: true });
  h.media.duration = Infinity; h.media.fire('durationchange');
  assert.equal(h.find('sl-media-seek').disabled, true);
  assert.equal(h.find('sl-media-time').textContent, '0:12 / Live');
  h.media.fire('waiting'); assert.equal(h.find('sl-media-status').textContent, 'Loading…');
  h.find('sl-media-play').click(); await Promise.resolve();
  assert.equal(h.find('sl-media-status').textContent, 'Playback could not start. Try again.');
  h.media.error = { code: 4 }; h.media.fire('error');
  assert.equal(h.find('sl-media-play').disabled, true); assert.equal(h.find('sl-media-status').textContent, 'Media is unavailable.');
  h.media.hidden = true; h.mutate(); assert.equal(h.find('sl-media-controls').hidden, true);
  assert.equal(h.media.getAttribute('src'), '/sample-media'); assert.equal(h.calls.load, 0);
});

test('auth and dynamic teardown restore native controls without pausing, moving or resurrecting media', () => {
  const auth = harness({ auth: true }); assert.equal(auth.find('sl-media-controls'), undefined);
  assert.equal(auth.media.getAttribute('controls'), 'controls');
  const h = harness(); const media = h.media; const node = h.find('sl-media-controls');
  h.doc.body.classList.add('auth-entry'); h.mutate();
  assert.equal(media.parentElement, h.host); assert.equal(media.getAttribute('controls'), 'controls');
  assert.equal(h.find('sl-media-controls'), undefined); assert.equal(node.parentElement, null);
  assert.equal(h.calls.pause + h.calls.play + h.calls.load, 0);
  h.doc.body.classList.remove('auth-entry'); h.mutate(); assert.ok(h.find('sl-media-controls'));
  media.remove(); h.mutate(); assert.equal(media.parentElement, null); assert.equal(h.find('sl-media-controls'), undefined);
  assert.equal(media.controls, true);
  const moved = harness(); const newHost = new moved.Node('section'); moved.member.append(newHost); newHost.append(moved.media); moved.mutate();
  assert.equal(moved.media.parentElement, newHost); assert.equal(moved.find('sl-media-controls'), undefined);
  assert.equal(newHost.children[0], moved.media); assert.equal(newHost.children[1].classList.contains('sl-media-controls'), true);
});

test('an existing player taking ownership removes only adapter chrome and preserves its controls decision', () => {
  const h = harness({ kind: 'video' });
  h.media.setAttribute('data-sauti-video-player-ready', 'true'); h.media.controls = false; h.mutate();
  assert.equal(h.find('sl-media-controls'), undefined); assert.equal(h.media.controls, false);
  assert.equal(h.media.parentElement, h.host);
});

test('download retains existing media access and playback options close outside or on Escape', () => {
  const h = harness();
  assert.equal(h.find('sl-media-download').getAttribute('href'), 'http://localhost:4177/sample-media');
  assert.equal(h.find('sl-media-download').hidden, false);
  h.media.setAttribute('controlslist', 'nodownload'); h.mutate(); assert.equal(h.find('sl-media-download').hidden, true);
  h.media.removeAttribute('controlslist'); h.media.setAttribute('src', 'https://other.test/file'); h.mutate(); assert.equal(h.find('sl-media-download').hidden, true);
  h.media.setAttribute('src', 'blob:http://localhost:4177/protected-voice-note'); h.mutate(); assert.equal(h.find('sl-media-download').hidden, false);
  const settings = h.find('sl-media-settings'); settings.open = true;
  h.doc.events.get('pointerdown')({ target: h.member }); assert.equal(settings.open, false);
  settings.open = true; h.find('sl-media-controls').fire('keydown', { key: 'Escape' });
  assert.equal(settings.open, false); assert.equal(h.doc.activeElement.getAttribute('aria-label'), 'Playback options');
  assert.equal(h.calls.load + h.calls.play, 0);
});

test('stable refresh performs no DOM writes that could feed another presentation observer', () => {
  const h = harness(); h.writes.length = 0;
  h.window.SautiMemberMedia.refresh(); h.window.SautiMemberMedia.refresh(); h.mutate();
  assert.deepEqual(h.writes, []);
  h.media.removeAttribute('src'); h.media.srcObject = {}; h.mutate();
  assert.equal(h.find('sl-media-download').hidden, true);
  assert.equal(h.find('sl-media-download').getAttribute('href'), null, 'stream sources must not download the HTML page');
  h.media.srcObject = null;
  const child = new h.Node('source'); child.setAttribute('src', '/child-source.wav'); h.media.append(child); h.mutate();
  assert.equal(h.find('sl-media-download').getAttribute('href'), 'http://localhost:4177/child-source.wav');
});
