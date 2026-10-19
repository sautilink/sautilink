import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const directory = new URL('../app/assets/fonts/post-preview/', import.meta.url);
const read = (name) => readFile(new URL(name, directory));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('the post preview font is a valid sized WOFF2 with matching build provenance', async () => {
  const expectedFiles = ['SautiLinkPostPreview-Regular.woff2', 'OFL-Inter.txt', 'OFL-NotoEmoji.txt', 'NOTICE.md', 'provenance.json'];
  assert.deepEqual((await readdir(directory)).sort(), expectedFiles.sort(), 'Only the font and its exact license/provenance files are deployed');
  const report = JSON.parse(await read('provenance.json'));
  assert.equal(report.file, 'SautiLinkPostPreview-Regular.woff2');
  const font = await read(report.file);
  assert.equal(font.toString('ascii', 0, 4), 'wOF2');
  assert.equal(font.readUInt32BE(4), 0x00010000, 'The derivative retains TrueType outlines');
  assert.equal(font.readUInt32BE(8), font.length, 'The WOFF2 header reports the actual file length');
  assert.ok(font.readUInt16BE(12) > 10, 'The static font must retain its outline and layout tables');
  assert.ok(font.length > 10_000 && font.length < 2_000_000, 'The share renderer font stays within its documented 2 MB budget');
  assert.equal(report.bytes, font.length);
  assert.equal(report.sha256, sha256(font));
  assert.equal(report.family, 'SautiLink Post Preview');
  assert.equal(report.weight, 400);
  assert.equal(report.unitsPerEm, 2048);
  assert.deepEqual(report.verifiedEmoji, ['U+1F525', 'U+1F680', 'U+1F440']);
  assert.ok(report.mappedCodepoints > 2_000);
});

test('the post preview font preserves both original licenses and pinned source provenance', async () => {
  const report = JSON.parse(await read('provenance.json'));
  const inter = await readFile(new URL('../assets/fonts/inter/InterVariable.woff2', import.meta.url));
  const interLicense = await readFile(new URL('../assets/fonts/inter/OFL.txt', import.meta.url));
  assert.equal(report.sources.inter.file, 'assets/fonts/inter/InterVariable.woff2');
  assert.equal(report.sources.inter.sha256, sha256(inter));
  assert.deepEqual(await read('OFL-Inter.txt'), interLicense);
  const notoLicense = await read('OFL-NotoEmoji.txt');
  assert.equal(sha256(notoLicense), report.sources.notoLicense.sha256);
  assert.match(report.sources.notoEmoji.url, /\/47d54ca1ebb14fd864695f1d39dc734f39017c33\/ofl\/notoemoji\/NotoEmoji%5Bwght%5D\.ttf$/);
  for (const license of [interLicense, notoLicense]) {
    assert.match(license.toString('utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
  }
  const notice = (await read('NOTICE.md')).toString('utf8');
  assert.match(notice, /SautiLinkPostPreview-Regular\.woff2/);
  assert.match(notice, /Inter/);
  assert.match(notice, /Noto Emoji/);
  assert.match(notice, /OFL-Inter\.txt/);
  assert.match(notice, /OFL-NotoEmoji\.txt/);
});
