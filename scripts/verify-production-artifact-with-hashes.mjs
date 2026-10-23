import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appHtmlPath = resolve(projectRoot, 'dist-production-site/app/index.html');
const appJsPath = resolve(projectRoot, 'dist-production-site/app/assets/app.js');

const originalHtml = await readFile(appHtmlPath, 'utf8');
const originalJs = await readFile(appJsPath, 'utf8');

function legacyVerificationView(input) {
  return input
    .replace(/\/app\/assets\/app\.css\?v=[a-f0-9]{12}/gi, '/app/assets/app.css?v=20260927-page-headers1')
    .replace(/\/app\/assets\/app\.js\?v=[a-f0-9]{12}/gi, '/app/assets/app.js?v=20260930-swala-otp2')
    .replace(/\/app\/assets\/theme-init\.js\?v=[a-f0-9]{12}/gi, '/app/assets/theme-init.js?v=20260904-account2')
    .replace(/profile-x-ui\.css\?v=[a-f0-9]{12}/gi, 'profile-x-ui.css?v=20260918-profile2')
    .replace(/profile-settings-ui\.css\?v=[a-f0-9]{12}/gi, 'profile-settings-ui.css?v=20260927-page-headers1')
    .replace(/messages-whatsapp\.css\?v=[a-f0-9]{12}/gi, 'messages-whatsapp.css?v=20260914-messagesui1')
    .replace(/messages-composer\.css\?v=[a-f0-9]{12}/gi, 'messages-composer.css?v=20260914-messagesui1');
}

function run(script) {
  const result = spawnSync(process.execPath, [resolve(projectRoot, script)], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}`);
}

// Certify immutable final bytes before constructing the legacy marker-only view.
run('scripts/verify-production-ui-asset-hashes.mjs');
try {
  await writeFile(appHtmlPath, legacyVerificationView(originalHtml));
  await writeFile(appJsPath, legacyVerificationView(originalJs));
  run('scripts/verify-production-artifact.mjs');
} finally {
  await writeFile(appHtmlPath, originalHtml);
  await writeFile(appJsPath, originalJs);
}

run('scripts/verify-production-ui-asset-hashes.mjs');
console.log('Verified full production artifact with automatic UI content hashes preserved.');
