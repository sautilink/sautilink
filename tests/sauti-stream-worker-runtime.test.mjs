import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import vm from 'node:vm';
import Hls from 'hls.js';
import { stageStreamHlsRuntime } from '../scripts/stage-stream-hls-runtime.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const withoutMap = (value) => value.replace(/^\/\/# sourceMappingURL=[^\r\n]+$/gm, '');

test('stages the exact pinned runtime and standalone worker without maps; the worker completes the SDK init protocol', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sauti-hls-worker-'));
  try {
    const packageDirectory = resolve(directory, 'node_modules/hls.js');
    await mkdir(resolve(packageDirectory, 'dist'), { recursive: true });
    const metadata = await read('node_modules/hls.js/package.json');
    const runtime = await read('node_modules/hls.js/dist/hls.min.js');
    const worker = await read('node_modules/hls.js/dist/hls.worker.js');
    const license = await read('node_modules/hls.js/LICENSE');
    await Promise.all([
      writeFile(resolve(packageDirectory, 'package.json'), metadata),
      writeFile(resolve(packageDirectory, 'dist/hls.min.js'), runtime),
      writeFile(resolve(packageDirectory, 'dist/hls.worker.js'), worker),
      writeFile(resolve(packageDirectory, 'LICENSE'), license),
    ]);
    await stageStreamHlsRuntime(directory);
    const target = resolve(directory, 'app/assets/vendor');
    const stagedWorker = await readFile(resolve(target, 'hls.worker-1.7.3.js'), 'utf8');
    assert.equal(await readFile(resolve(target, 'hls-1.7.3.min.js'), 'utf8'), withoutMap(runtime));
    assert.equal(stagedWorker, withoutMap(worker));
    assert.equal(await readFile(resolve(target, 'hls-1.7.3.LICENSE.txt'), 'utf8'), license);
    assert.deepEqual((await readdir(target)).sort(), ['hls-1.7.3.LICENSE.txt', 'hls-1.7.3.min.js', 'hls.worker-1.7.3.js']);
    let receive;
    const messages = [];
    vm.runInNewContext(stagedWorker, {
      self: { addEventListener(type, callback) { assert.equal(type, 'message'); receive = callback; },
        postMessage(message) { messages.push(message); } },
      console, performance, TextDecoder, TextEncoder, URL,
    }, { timeout: 3000 });
    assert.equal(typeof receive, 'function');
    receive({ data: { cmd: 'init', instanceNo: 0, id: 'main', typeSupported: { mpeg: true, mp3: true, ac3: true },
      config: JSON.stringify({ ...Hls.DefaultConfig, debug: false }) } });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].event, 'init');
    assert.equal(messages[0].instanceNo, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an unreviewed SDK version fails closed before staging either runtime or worker', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sauti-hls-unpinned-'));
  try {
    await mkdir(resolve(directory, 'node_modules/hls.js'), { recursive: true });
    await writeFile(resolve(directory, 'node_modules/hls.js/package.json'), JSON.stringify({ version: '1.7.4' }));
    await assert.rejects(stageStreamHlsRuntime(directory), /UNPINNED_HLS_RUNTIME/);
    await assert.rejects(readdir(resolve(directory, 'app/assets/vendor')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
