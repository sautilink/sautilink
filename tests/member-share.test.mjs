import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformMemberShareSource } from '../scripts/member-share-source-transform.mjs';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const rooms = await readFile(new URL('../src/rooms-facebook-ui.js', import.meta.url), 'utf8');
const transformed = transformMemberShareSource('src/app.js', app);
function runShare(name, choice, deviceAvailable = true, shareError = null, navigationAbort = false) {
  const start = transformed.indexOf(`async function ${name}(`);
  const end = transformed.indexOf('\n}\n', start) + 2;
  const calls = { copied: [], shared: [], toasts: [], choices: [], focused: 0 };
  const button = { disabled: false, isConnected: true, closest: () => null, focus: () => { calls.focused++; } };
  const sandbox = {
    URL,
    document: { body: { classList: { contains: () => navigationAbort } }, getElementById: () => ({ hidden: false }) },
    window: { location: { origin: 'https://example.test' }, SautiMemberDialogs: { choose: async (...args) => { calls.choices.push(args); if (navigationAbort) throw { name: 'AbortError' }; return choice; } } },
    navigator: deviceAvailable ? { share: async (payload) => { calls.shared.push(payload); if (shareError) throw shareError; } } : {},
    sautiShareUrl: (id) => `https://example.test/post/${id}`,
    shortVideoPath: (id) => `/videos/${id}`,
    copyShareText: async (url) => { calls.copied.push(url); },
    showToast: (...args) => { calls.toasts.push(args); },
  };
  const share = runInNewContext(`${transformed.slice(start, end)}; ${name}`, sandbox);
  return { calls, button, execute: () => share(name === 'shareSautiLink' ? { dataset: { postId: 'sample' } } : 'sample', button) };
}
test('post and video sharing first use the built-in chooser and preserve links', async () => {
  for (const name of ['shareSautiLink', 'shareShortVideoLink']) {
    const cancel = runShare(name, null);
    await cancel.execute();
    assert.equal(cancel.calls.copied.length + cancel.calls.shared.length, 0);
    assert.equal(cancel.button.disabled, false);
    assert.equal(cancel.calls.focused, 1);
    const copy = runShare(name, 'copy');
    await copy.execute();
    assert.deepEqual(copy.calls.copied, [`https://example.test/${name === 'shareSautiLink' ? 'post' : 'videos'}/sample`]);
    assert.equal(copy.calls.shared.length, 0);
    assert.equal(copy.button.disabled, false);
    assert.equal(copy.calls.focused, 1);
    const native = runShare(name, 'device');
    await native.execute();
    assert.equal(native.calls.shared.length, 1);
    assert.equal(native.calls.copied.length, 0);
    const unavailable = runShare(name, 'copy', false);
    await unavailable.execute();
    assert.equal(unavailable.calls.choices[0][1].length, 1);
  }
});
test('cancelling device sharing does not copy a link or show an error', async () => {
  const operation = runShare('shareSautiLink', 'device', true, { name: 'AbortError' });
  await operation.execute();
  assert.equal(operation.calls.copied.length, 0);
  assert.equal(operation.calls.toasts.length, 0);
  assert.equal(operation.button.disabled, false);
});
test('navigation or auth abort neither shares nor shifts focus into the previous member view', async () => {
  const operation = runShare('shareSautiLink', null, true, null, true);
  await operation.execute();
  assert.equal(operation.calls.copied.length + operation.calls.shared.length + operation.calls.toasts.length + operation.calls.focused, 0);
  assert.equal(operation.button.disabled, false);
});
test('share transforms are idempotent, narrowly scoped and fail when upstream actions move', () => {
  const roomOutput = transformMemberShareSource('src/rooms-facebook-ui.js', rooms);
  assert.equal(transformMemberShareSource('src/app.js', transformed), transformed);
  assert.equal(transformMemberShareSource('src/rooms-facebook-ui.js', roomOutput), roomOutput);
  assert.equal(transformMemberShareSource('src/whatsapp-otp-auth.js', app), app);
  assert.throws(() => transformMemberShareSource('src/app.js', app.replace('async function shareSautiLink(', 'async function movedShare(')), /could not find/);
});
