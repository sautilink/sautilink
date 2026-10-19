import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareOriginalVideoIndex } from '../scripts/prepare-original-video-index.mjs';
import { fixture } from './fixtures/original-mp4-index-fixture.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function isolated(operation) {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'sauti-index-cli-'));
  assert.ok(resolve(root).startsWith(parent + sep));
  try { await operation(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function args(root, hash) {
  return ['--input', join(root, 'input.mp4'), '--output', join(root, 'indexed.mp4'),
    '--receipt', join(root, 'prepared.json'), '--expected-sha256', hash];
}
test('operator CLI prepares a new complete copy, inactive report, and preserves source', async () => {
  await isolated(async root => {
    const input = fixture(); await writeFile(join(root, 'input.mp4'), input);
    const report = await prepareOriginalVideoIndex(args(root, sha(input)));
    const output = new Uint8Array(await readFile(join(root, 'indexed.mp4')));
    assert.equal(report.sourceSha256, sha(input)); assert.equal(report.derivedSha256, sha(output));
    assert.equal(report.completeDurationMs, 4000); assert.equal(report.sourceEtag, null);
    assert.equal(report.derivedEtag, null); assert.equal(report.ownerId, null); assert.equal(report.mediaId, null);
    assert.match(report.activation, /^INACTIVE_/); assert.equal(report.providerCalls, 0);
    assert.deepEqual(new Uint8Array(await readFile(join(root, 'input.mp4'))), input);
    const receipt = JSON.parse(await readFile(join(root, 'prepared.json'), 'utf8'));
    assert.equal(receipt.derivedSha256, sha(output)); assert.equal(receipt.mdatPreserved, true);
    const allowed = new Set(report.headerPatches.flatMap(p => Array.from({ length: p.length }, (_, n) => p.offset + n)));
    for (let i = 0; i < input.length; i++) if (!allowed.has(i)) assert.equal(output[i], input[i]);
  });
});
test('wrong source SHA produces no derived artifact or report', async () => {
  await isolated(async root => {
    await writeFile(join(root, 'input.mp4'), fixture());
    await assert.rejects(prepareOriginalVideoIndex(args(root, '0'.repeat(64))), /SOURCE_HASH_MISMATCH/);
    assert.deepEqual(await readdir(root), ['input.mp4']);
  });
});
test('unsupported input produces no output', async () => {
  await isolated(async root => {
    const bytes = new Uint8Array([1, 2, 3]); await writeFile(join(root, 'input.mp4'), bytes);
    await assert.rejects(prepareOriginalVideoIndex(args(root, sha(bytes))), /UNSUPPORTED_OR_INVALID_MP4/);
    assert.deepEqual(await readdir(root), ['input.mp4']);
  });
});
for (const file of ['indexed.mp4', 'prepared.json']) {
  test(`existing ${file} is preserved byte-for-byte without any new output`, async () => {
    await isolated(async root => {
      const source = fixture(); await writeFile(join(root, 'input.mp4'), source);
      await writeFile(join(root, file), 'KEEP_EXISTING');
      await assert.rejects(prepareOriginalVideoIndex(args(root, sha(source))), /OUTPUT_MUST_BE_NEW/);
      assert.equal(await readFile(join(root, file), 'utf8'), 'KEEP_EXISTING');
      assert.equal((await readdir(root)).length, 2);
    });
  });
}
test('invalid flags, duplicate paths, and malformed hashes are refused before reads', async () => {
  await assert.rejects(prepareOriginalVideoIndex([]), /INVALID_ARGUMENTS/);
  await isolated(async root => {
    const invalid = args(root, 'not-a-hash');
    await assert.rejects(prepareOriginalVideoIndex(invalid), /INVALID_ARGUMENTS/);
    const same = args(root, '0'.repeat(64)); same[3] = same[1];
    await assert.rejects(prepareOriginalVideoIndex(same), /INVALID_ARGUMENTS/);
    assert.deepEqual(await readdir(root), []);
  });
});
test('actual CLI entry returns a fixed safe error for malformed arguments', () => {
  const script = fileURLToPath(new URL('../scripts/prepare-original-video-index.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--input', 'SENSITIVE_FAKE_PATH'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { status: 'REFUSED', code: 'INVALID_ARGUMENTS', providerCalls: 0 });
  assert.equal(result.stderr.includes('SENSITIVE_FAKE_PATH'), false);
});
