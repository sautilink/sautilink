import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('edit profile media upload actions use icons without changing their controls', async () => {
  const source = await read('src/profile-media-upload-icons.js');

  assert.match(source, /profile-avatar-upload-button/);
  assert.match(source, /profile-header-upload-button/);
  assert.match(source, /Upload profile photo/);
  assert.match(source, /Upload header image/);
  assert.match(source, /data-profile-media-upload-icon/);
  assert.match(source, /M12 15V4/);
  assert.match(source, /button\.replaceChildren\(profileMediaUploadIcon\(\)\)/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /button\.dataset\.defaultLabel = currentText/);
  assert.match(source, /aria-label/);
  assert.match(source, /aria-busy/);
  assert.doesNotMatch(source, /profile-professional-category|verification|Sautify|login|signup/i);
});

test('profile media upload icon module is included in regular and production app bundles', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const productionBuild = await read('scripts/build-production-release.mjs');

  assert.match(packageJson.scripts['build:app'], /profile-media-upload-icons\.js/);
  assert.match(productionBuild, /profile-media-upload-icons\.js/);
});

const mediaActions = [
  ['profile-avatar-upload-button', 'Upload profile photo', 'upload-0-1'],
  ['profile-header-upload-button', 'Upload header image', 'upload-0-1'],
  ['profile-avatar-remove-button', 'Remove profile photo', 'delete-0-2'],
  ['profile-header-remove-button', 'Remove header image', 'delete-0-2'],
];

test('profile photo and cover actions expose icon-only controls before scripts run', async () => {
  const html = await read('app/index.html');
  for (const [id, label, icon] of mediaActions) {
    const button = html.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/button>`));
    assert.ok(button, `${id} remains the existing action`);
    const opening = button[0].slice(0, button[0].indexOf('>') + 1);
    assert.match(opening, /\btype="button"/);
    assert.match(opening, /\bdisabled\b/);
    assert.ok(opening.includes(`aria-label="${label}"`), `${id} needs a descriptive accessible name`);
    assert.ok(opening.includes(`title="${label}"`), `${id} needs a tooltip`);
    if (id.includes('-upload-')) assert.match(opening, /data-default-label="Upload"/);
    assert.match(button[1], /<svg\b[^>]*aria-hidden="true"/);
    assert.match(button[1], /<svg\b[^>]*focusable="false"/);
    assert.ok(button[1].includes(`data-sl-icon-name="${icon}"`), `${id} uses the animated icon catalog`);
    assert.equal(button[1].replace(/<[^>]*>/g, '').trim(), '', `${id} has no visible action wording`);
  }
});

function actionHarness() {
  const buttons = new Map();
  const pending = new Set();
  const observers = [];
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.disabled = false;
      this.text = '';
    }
    get firstElementChild() { return this.children[0] || null; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.children = []; this.changed(); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...children) { this.children.push(...children); this.changed(); }
    replaceChildren(...children) { this.text = ''; this.children = children; this.changed(); }
    matches(selector) {
      const marker = selector.match(/^svg\[data-profile-media-(upload|remove)-icon="true"\]$/)?.[1];
      return this.tag === 'svg' && Boolean(marker)
        && (this.dataset[`profileMedia${marker === 'upload' ? 'Upload' : 'Remove'}Icon`] === 'true'
          || this.getAttribute(`data-profile-media-${marker}-icon`) === 'true');
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    click() { if (!this.disabled) this.listeners.get('click')?.(); }
    changed() { for (const observer of observers) if (observer.target === this) pending.add(observer); }
  }
  return {
    buttons,
    Element,
    document: {
      createElementNS: (_namespace, tag) => new Element(tag),
      getElementById: (id) => buttons.get(id),
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target) { this.target = target; }
    },
    flush() {
      let deliveries = 0;
      while (pending.size) {
        assert.ok(++deliveries < 30, 'icon observers must settle');
        const batch = [...pending];
        pending.clear();
        for (const observer of batch) observer.callback([]);
      }
    },
  };
}

test('media icons survive the real upload and removal busy/reset writes without replacing controls', async () => {
  const [presentation, app] = await Promise.all([read('src/profile-media-upload-icons.js'), read('src/app.js')]);
  const harness = actionHarness();
  let finishHeaders;
  const context = vm.createContext({
    document: harness.document,
    MutationObserver: harness.MutationObserver,
    byId: (id) => harness.buttons.get(id),
    profileMediaReady: true,
    renderedProfileOwner: true,
    currentMember: { username: 'sample', display_name: 'Sample' },
    profileMediaPresence: { avatar: true, header: true },
    setMessage: () => {},
    profileMediaHeaders: () => new Promise((resolve) => { finishHeaders = resolve; }),
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    loadProfileMedia: async () => {},
    refreshCurrentMemberAvatar: async () => {},
    updateProfileMediaControls: () => {
      for (const slot of ['avatar', 'header']) harness.buttons.get(`profile-${slot}-remove-button`).disabled = false;
    },
  });
  vm.runInContext(presentation.slice(0, presentation.indexOf('function ensureProfileMediaEditorStylesheet')), context);
  for (const name of ['setProfileMediaBusy', 'removeProfileMedia']) {
    const declaration = app.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))?.[0];
    assert.ok(declaration, `${name} must use the production implementation`);
    vm.runInContext(declaration, context);
  }
  let clicks = 0;
  for (const [id, label] of mediaActions) {
    const upload = id.includes('-upload-');
    const button = new harness.Element('button');
    button.disabled = true;
    button.setAttribute('aria-label', label);
    button.title = label;
    if (upload) button.dataset.defaultLabel = 'Upload';
    button.append(upload ? context.profileMediaUploadIcon() : context.profileMediaRemoveIcon());
    button.addEventListener('click', () => { clicks++; });
    harness.buttons.set(id, button);
    const watcher = upload ? context.watchProfileMediaUploadButton : context.watchProfileMediaRemoveButton;
    watcher({ id, label });
    harness.flush();
    assert.equal(button.disabled, true, 'enhancement preserves readiness');
  }
  const assertIcon = (id, label, busy) => {
    const button = harness.buttons.get(id);
    assert.equal(button.children.length, 1);
    assert.equal(button.firstElementChild.tag, 'svg');
    assert.equal(button.firstElementChild.getAttribute('aria-hidden'), 'true');
    assert.equal(button.firstElementChild.getAttribute('focusable'), 'false');
    assert.equal(button.textContent, '');
    assert.equal(button.getAttribute('aria-label'), busy ? busy : label);
    assert.equal(button.getAttribute('aria-busy'), busy ? 'true' : null);
    assert.equal(button.title, label);
  };
  for (const slot of ['avatar', 'header']) {
    const uploadId = `profile-${slot}-upload-button`;
    const removeId = `profile-${slot}-remove-button`;
    const uploadButton = harness.buttons.get(uploadId);
    const removeButton = harness.buttons.get(removeId);
    const uploadLabel = mediaActions.find(([id]) => id === uploadId)[1];
    const removeLabel = mediaActions.find(([id]) => id === removeId)[1];
    context.setProfileMediaBusy(slot, true, 'Uploading…');
    harness.flush();
    assertIcon(uploadId, uploadLabel, 'Uploading…');
    assert.equal(uploadButton.disabled, true);
    context.setProfileMediaBusy(slot, false);
    harness.flush();
    assertIcon(uploadId, uploadLabel, false);
    assert.equal(uploadButton.disabled, false);
    assert.equal(uploadButton.dataset.defaultLabel, 'Upload');

    const removal = context.removeProfileMedia(slot);
    harness.flush();
    assertIcon(removeId, removeLabel, 'Removing…');
    assert.equal(removeButton.disabled, true);
    finishHeaders({ Authorization: 'sample-only' });
    await removal;
    harness.flush();
    assertIcon(removeId, removeLabel, false);
    assert.equal(removeButton.disabled, false);
    assert.equal(harness.buttons.get(uploadId), uploadButton);
    assert.equal(harness.buttons.get(removeId), removeButton);
    uploadButton.click();
    removeButton.click();
  }
  assert.equal(clicks, 4, 'the original action listeners remain attached');
});
