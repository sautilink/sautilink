import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('installed Chrome app accepts shares into the existing composer', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  const html = await read('app/index.html');
  const app = await read('src/app.js');
  assert.match(html, /<link rel="manifest" href="\\/manifest\\.json\\?v=20261007-sharetarget1">/);
  assert.deepEqual(manifest.share_target, {
    action: '/share-target', method: 'POST', enctype: 'multipart/form-data',
    params: {
      title: 'title', text: 'text', url: 'url', files: [{
        name: 'media', accept: ['image/jpeg', '.jpg', '.jpeg', 'image/png', '.png', 'image/webp', '.webp', 'video/mp4', '.mp4'],
      }],
    },
  });
  assert.match(html, /id="sauti-camera-file"[^>]*capture="environment"/);
  assert.match(html, /id="sauti-camera-add"/);
  assert.match(app, /prepareComposer\(\)\.then\(receivePendingPwaShare\)/);
  assert.match(app, /openSautiComposer\(\{ focus: false \}\)/);
  assert.match(app, /addComposerFiles\(files\)/);
  assert.match(app, /finishPwaShare\(id\)/);
});

test('share receiver stores text and files locally and requires review before posting', async () => {
  const handlers = new Map();
  const saved = new Map();
  const db = {
    createObjectStore: () => {}, close: () => {},
    transaction: () => {
      const transaction = {
        objectStore: () => ({ put: (value, key) => {
          saved.set(key, value);
          queueMicrotask(() => transaction.oncomplete());
        } }),
      };
      return transaction;
    },
  };
  const indexedDB = { open: () => {
    const request = { result: db };
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
    return request;
  } };
  const worker = await read('sw.js');
  vm.runInNewContext(worker, {
    URL, Request, Response, indexedDB, crypto,
    self: { location: { origin: 'https://sautilink.com' }, addEventListener: (name, callback) => handlers.set(name, callback) },
  });
  const form = new FormData();
  form.set('title', 'Interesting article');
  form.set('text', 'Take a look');
  form.set('url', 'https://example.com/story');
  form.append('media', new File(['jpeg'], 'picture.jpg', { type: 'image/jpeg' }));
  let pending;
  handlers.get('fetch')({
    request: new Request('https://sautilink.com/share-target', { method: 'POST', body: form }),
    respondWith: (promise) => { pending = promise; },
  });
  const response = await pending;
  assert.equal(response.status, 303);
  const id = new URL(response.headers.get('location')).searchParams.get('shared');
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(saved.get(id).body, 'Interesting article\nTake a look\nhttps://example.com/story');
  assert.equal(saved.get(id).files.length, 1);

  const overlong = new FormData();
  overlong.set('text', 'x'.repeat(501));
  handlers.get('fetch')({
    request: new Request('https://sautilink.com/share-target', { method: 'POST', body: overlong }),
    respondWith: (promise) => { pending = promise; },
  });
  assert.equal((await pending).status, 413);
  assert.equal(saved.size, 1);
});
