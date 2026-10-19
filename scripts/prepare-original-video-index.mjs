// Local operator tool only. No API credentials, provider calls, or source mutation.
import { createHash } from 'node:crypto';
import { lstat, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOriginalMp4Index } from './lib/original-mp4-index.mjs';

const MAX_BYTES = 100_000_000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = code => { throw new Error(code); };
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
async function requireNew(path) {
  try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  reject('OUTPUT_MUST_BE_NEW');
}
function parse(args) {
  const values = new Map(), allowed = new Set(['--input', '--output', '--receipt', '--expected-sha256']);
  if (args.length !== 8) reject('INVALID_ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || values.has(args[i]) || !args[i + 1]) reject('INVALID_ARGUMENTS');
    values.set(args[i], args[i + 1]);
  }
  const sha256 = values.get('--expected-sha256');
  if (!/^[0-9a-f]{64}$/.test(sha256 || '')) reject('INVALID_ARGUMENTS');
  const input = resolve(values.get('--input')), output = resolve(values.get('--output')), receipt = resolve(values.get('--receipt'));
  if (samePath(input, output) || samePath(input, receipt) || samePath(output, receipt)
    || !output.toLowerCase().endsWith('.mp4') || !receipt.toLowerCase().endsWith('.json')) reject('INVALID_ARGUMENTS');
  return { input, output, receipt, sha256 };
}

export async function prepareOriginalVideoIndex(args) {
  const options = parse(args);
  await requireNew(options.output); await requireNew(options.receipt);
  const handle = await open(options.input, 'r');
  let input;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size <= 0 || stat.size > MAX_BYTES) reject('SOURCE_FILE_REQUIRED');
    input = new Uint8Array(stat.size); let bytes = 0;
    while (bytes < input.length) {
      const part = await handle.read(input, bytes, input.length - bytes, bytes);
      if (!part.bytesRead) reject('SOURCE_CHANGED_DURING_READ'); bytes += part.bytesRead;
    }
    const overflow = new Uint8Array(1);
    if ((await handle.read(overflow, 0, 1, bytes)).bytesRead) reject('SOURCE_CHANGED_DURING_READ');
  } finally { await handle.close(); }
  if (hash(input) !== options.sha256) reject('SOURCE_HASH_MISMATCH');
  const result = buildOriginalMp4Index(input, { repairDurationHeaders: true });
  if (!result) reject('UNSUPPORTED_OR_INVALID_MP4');
  const allowed = new Set();
  for (const patch of result.headerPatches) {
    if (!Number.isInteger(patch.offset) || ![4, 8].includes(patch.length) || patch.offset < 0
      || patch.offset + patch.length > input.length) reject('INVALID_HEADER_PATCH');
    for (let i = patch.offset; i < patch.offset + patch.length; i++) allowed.add(i);
  }
  for (let i = 0; i < input.length; i++) if (!allowed.has(i) && input[i] !== result.bytes[i]) reject('NON_DURATION_BYTES_CHANGED');
  const report = {
    status: 'LOCAL_DERIVATIVE_PREPARED_NOT_ACTIVATED', originalIndexVersion: '1',
    sourceSize: input.length, sourceSha256: hash(input), derivedSize: result.bytes.length,
    derivedSha256: hash(result.bytes), completeDurationMs: result.completeDurationMs,
    appendedBytes: result.appendedSize, durationHeadersRepaired: true, timelineComplete: true,
    mdatPreserved: true, headerPatches: result.headerPatches, tracks: result.tracks, fragments: result.fragments,
    indexEntries: result.entries,
    activation: 'INACTIVE_REQUIRES_APPROVED_SOURCE_AND_DERIVED_FULL_GET_HASH_ETAG_BINDING',
    sourceEtag: null, derivedEtag: null, ownerId: null, mediaId: null,
    providerCalls: 0,
  };
  // Exclusive writes prevent overwrite, including symlink destinations. A failed
  // receipt write may leave an inactive copy; never delete a user's path to retry.
  await writeFile(options.output, result.bytes, { flag: 'wx' });
  await writeFile(options.receipt, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}

if (process.argv[1] && samePath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  prepareOriginalVideoIndex(process.argv.slice(2)).then(report => {
    process.stdout.write(JSON.stringify({ status: report.status, sourceSha256: report.sourceSha256,
      derivedSha256: report.derivedSha256, derivedSize: report.derivedSize,
      completeDurationMs: report.completeDurationMs, providerCalls: 0 }) + '\n');
  }).catch(error => {
    const known = new Set(['INVALID_ARGUMENTS', 'OUTPUT_MUST_BE_NEW', 'SOURCE_FILE_REQUIRED',
      'SOURCE_CHANGED_DURING_READ', 'SOURCE_HASH_MISMATCH', 'UNSUPPORTED_OR_INVALID_MP4',
      'INVALID_HEADER_PATCH', 'NON_DURATION_BYTES_CHANGED']);
    process.stderr.write(JSON.stringify({ status: 'REFUSED', code: known.has(error?.message) ? error.message : 'LOCAL_IO_FAILED', providerCalls: 0 }) + '\n');
    process.exitCode = 1;
  });
}
