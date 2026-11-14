import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const at = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const scriptPath = 'app/assets/self-xss-console-warning.js';
const scriptTag = '<script src="/app/assets/self-xss-console-warning.js?v=20261115-1" defer></script>';

test('self-XSS notice displays a SautiLink-branded safety warning without clearing logs', async () => {
  const script = await at(scriptPath);
  const calls = [];
  const consoleStub = {
    log: (...args) => calls.push(args),
    clear: () => { throw new Error('Must not clear developer console'); },
    error: () => { throw new Error('Must not emit an error'); },
  };
  assert.doesNotMatch(script, /eval\s*\(|document\.write|fetch\s*\(/);
  runInNewContext(script, { console: consoleStub });
  assert.equal(calls.length, 4);
  assert.match(calls[0][0], /%cStop!/);
  assert.match(calls[1][0], /SautiLink account/);
  assert.match(calls[2][0], /Never paste code/);
  assert.match(calls[3][0], /sautilink\.com\/help/);
});

test('warning is loaded exactly once by the shared login, signup and member shell and the website entry', async () => {
  const [appHtml, rootHtml, router, productionBuild] = await Promise.all([
    at('app/index.html'),
    at('index.html'),
    at('src/asset-router.js'),
    at('scripts/build-production-release.mjs'),
  ]);
  for (const html of [appHtml, rootHtml]) {
    assert.equal(html.split(scriptTag).length - 1, 1, 'load once per document');
    assert.ok(html.includes('src="/app/assets/self-xss-console-warning.js?v=20261115-1" defer'));
  }
  assert.ok(router.includes("const shellUrl = new URL('/app/', url)"), 'login and signup serve shared app shell');
  assert.ok(productionBuild.includes("await cp(resolve(projectRoot, 'app'), resolve(siteRoot, 'app'), { recursive: true });"));
});
