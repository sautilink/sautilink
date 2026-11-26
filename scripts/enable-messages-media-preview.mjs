import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stageRoot = resolve(projectRoot, 'dist-preview-site');
const headersPath = resolve(stageRoot, '_headers');
const appHtmlPath = resolve(stageRoot, 'app/index.html');

const cspMarker = "img-src 'self' https://stickers.sautilink.com data: blob:; script-src";
const cspReplacement = "img-src 'self' https://stickers.sautilink.com https://music.sautilink.com data: blob:; media-src 'self' https://music.sautilink.com blob:; script-src";
const connectMarker = "connect-src 'self'";
const connectReplacement = "connect-src 'self' wss://test.sautilink.com https://music.sautilink.com";
const permissionsMarker = 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()';
const permissionsReplacement = 'Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()';

let appHtml = await readFile(appHtmlPath, 'utf8');
let appHtmlChanged = false;
if (!appHtml.includes("media-src 'self'")) {
  if (!appHtml.includes(cspMarker)) throw new Error('Staging Messages media CSP marker is missing.');
  appHtml = appHtml.replace(cspMarker, cspReplacement);
  appHtmlChanged = true;
}
if (!appHtml.includes('wss://test.sautilink.com')) {
  if (!appHtml.includes(connectMarker)) throw new Error('Staging Messages connect-src marker is missing.');
  appHtml = appHtml.replace(connectMarker, connectReplacement);
  appHtmlChanged = true;
}
if (appHtmlChanged) await writeFile(appHtmlPath, appHtml);

let headers = await readFile(headersPath, 'utf8');
const appBlockStart = headers.indexOf('/app/*');
if (appBlockStart < 0) throw new Error('Staging /app/* headers block is missing.');
const nextBlock = headers.indexOf('\n\n', appBlockStart);
const appBlockEnd = nextBlock < 0 ? headers.length : nextBlock;
const prefix = headers.slice(0, appBlockStart);
let appBlock = headers.slice(appBlockStart, appBlockEnd);
const remainder = headers.slice(appBlockEnd);

if (!appBlock.includes("media-src 'self'")) {
  if (!appBlock.includes(cspMarker)) throw new Error('Staging /app/* CSP marker is missing.');
  appBlock = appBlock.replace(cspMarker, cspReplacement);
}
if (!appBlock.includes('wss://test.sautilink.com')) {
  if (!appBlock.includes(connectMarker)) throw new Error('Staging /app/* connect-src marker is missing.');
  appBlock = appBlock.replace(connectMarker, connectReplacement);
}
if (!appBlock.includes('microphone=(self)')) {
  if (!appBlock.includes(permissionsMarker)) throw new Error('Staging /app/* microphone policy marker is missing.');
  appBlock = appBlock.replace(permissionsMarker, permissionsReplacement);
}

headers = `${prefix}${appBlock}${remainder}`;
await writeFile(headersPath, headers);

console.log('Enabled scoped Messages microphone, blob media and same-origin realtime WebSocket support in staged /app/* output.');
