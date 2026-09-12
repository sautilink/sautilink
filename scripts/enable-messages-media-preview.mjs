import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stageRoot = resolve(projectRoot, 'dist-preview-site');
const headersPath = resolve(stageRoot, '_headers');
const appHtmlPath = resolve(stageRoot, 'app/index.html');

const cspMarker = "img-src 'self' data: blob:; script-src";
const cspReplacement = "img-src 'self' data: blob:; media-src 'self' blob:; script-src";
const permissionsMarker = 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()';
const permissionsReplacement = 'Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()';

let appHtml = await readFile(appHtmlPath, 'utf8');
if (!appHtml.includes("media-src 'self' blob:")) {
  if (!appHtml.includes(cspMarker)) throw new Error('Staging Messages media CSP marker is missing.');
  appHtml = appHtml.replace(cspMarker, cspReplacement);
  await writeFile(appHtmlPath, appHtml);
}

let headers = await readFile(headersPath, 'utf8');
const appBlockEnd = headers.indexOf('\n\n', headers.indexOf('/app/*'));
if (appBlockEnd < 0) throw new Error('Staging /app/* headers block is missing.');
let appBlock = headers.slice(0, appBlockEnd);
const remainder = headers.slice(appBlockEnd);
if (!appBlock.includes("media-src 'self' blob:")) {
  if (!appBlock.includes(cspMarker)) throw new Error('Staging /app/* CSP marker is missing.');
  appBlock = appBlock.replace(cspMarker, cspReplacement);
}
if (!appBlock.includes('microphone=(self)')) {
  if (!appBlock.includes(permissionsMarker)) throw new Error('Staging /app/* microphone policy marker is missing.');
  appBlock = appBlock.replace(permissionsMarker, permissionsReplacement);
}
headers = `${appBlock}${remainder}`;
await writeFile(headersPath, headers);

console.log('Enabled scoped Messages microphone and blob media support in staged /app/* output.');
