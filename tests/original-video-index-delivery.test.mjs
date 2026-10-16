import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { transformMediaPerformanceSource } from '../scripts/media-performance-source-transform.mjs';
import { originalVideoIndexObjectKey, originalVideoIndexReceiptObjectKey } from '../src/original-video-index-delivery.js';

const MEDIA = '123e4567-e89b-42d3-a456-426614174000';
const OWNER = '123e4567-e89b-42d3-a456-426614174111';
const POST = '123e4567-e89b-42d3-a456-426614174222';
const apiSource = await readFile(new URL('../src/sauti-media-api.js', import.meta.url), 'utf8');
// Exercise the actual production transform without writing generated source into
// the repository. Tests use deterministic opaque bytes, not private MP4 assets.
const temporary = await mkdtemp(join(tmpdir(), 'sauti-index-http-'));
after(async () => {
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(temporary.startsWith(join(tmpdir(), 'sauti-index-http-')));
  await rm(temporary, { recursive: true, force: true });
});
await writeFile(join(temporary, 'package.json'), '{"type":"module"}');
for (const path of ['profile-media-api.js', 'video-quality-levels.js', 'original-video-index-delivery.js']) {
  await copyFile(new URL(`../src/${path}`, import.meta.url), join(temporary, path));
}
await writeFile(join(temporary, 'sauti-media-api.js'), transformMediaPerformanceSource('src/sauti-media-api.js', apiSource));
const raw = await import('../src/sauti-media-api.js');
const transformed = await import(pathToFileURL(join(temporary, 'sauti-media-api.js')));
const fixtures = [
  { label: 'deterministic-A', derivedSize: 2 * 1024 * 1024 + 497, appendBytes: 496, completeDurationMs: 62860 },
  { label: 'deterministic-B', derivedSize: 3 * 1024 * 1024 + 441, appendBytes: 440, completeDurationMs: 60093 },
].map(record => {
  const bytes = Uint8Array.from({ length: record.derivedSize }, (_, index) => (index * 31 + 17) & 255);
  const sourceSize = bytes.length - record.appendBytes;
  const sourceBytes = bytes.subarray(0, sourceSize);
  return { ...record, sourceSize, bytes, sourceBytes,
    derivedSha256: createHash('sha256').update(bytes).digest('hex'),
    sourceSha256: createHash('sha256').update(sourceBytes).digest('hex') };
});

function setup(fixture = fixtures[0], change = () => {}) {
  fixture ||= fixtures[0];
  const row = { id: MEDIA, owner_id: OWNER, post_id: POST,
    object_key: `sauti/test-only/${MEDIA}.mp4`, media_kind: 'video', content_type: 'video/mp4',
    size_bytes: fixture.sourceSize, width: 1080, height: 1920, duration_ms: 147,
    upload_status: 'attached', expires_at: null, finalized_at: '2026-10-16T00:00:00Z' };
  const key = originalVideoIndexObjectKey(row.object_key);
  const receiptKey = originalVideoIndexReceiptObjectKey(row.object_key);
  // Synthetic ETags are local R2 stubs ONLY; activation manifest remains inactive.
  const receipt = { originalIndexVersion: '1', sourceEtag: 'test-source-etag', derivedEtag: 'test-derived-etag',
    sourceSize: String(fixture.sourceSize), sourceSha256: fixture.sourceSha256,
    derivedSize: String(fixture.derivedSize), derivedSha256: fixture.derivedSha256,
    completeDurationMs: String(fixture.completeDurationMs), durationHeadersRepaired: 'true',
    timelineComplete: 'true', mdatPreserved: 'true', ownerId: OWNER, mediaId: MEDIA };
  const source = { size: fixture.sourceSize, etag: 'test-source-etag' };
  const candidate = { size: fixture.derivedSize, etag: 'test-derived-etag',
    httpMetadata: { contentType: 'video/mp4' } };
  const calls = [], state = { row, key, receipt, source, candidate, allow: true, mismatch: false,
    missing: false, error: null, errorAt: 'source', bodyRangeMismatch: false, cancelled: false,
    receiptMissing: false, receiptThrows: false, receiptContent: null, receiptSize: null, receiptStream: null,
    legacyVariant: false, legacyBytes: new Uint8Array([7, 6, 5, 4]) };
  const legacyObject = () => ({ body: state.legacyBytes, size: state.legacyBytes.length,
    etag: 'synthetic-existing-variant', writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); } });
  const env = { SAUTI_MEDIA: {
    async head(wanted) {
      calls.push({ op: 'head', key: wanted });
      if (state.error && ((state.errorAt === 'candidate' && wanted === key)
        || (state.errorAt === 'source' && wanted === row.object_key))) throw state.error;
      if (wanted === key) return state.missing ? null : candidate;
      if (wanted === row.object_key) return source;
      if (wanted === `${row.object_key}.video-v2-q360.mp4`) return state.legacyVariant ? legacyObject() : null;
      throw new Error('Unexpected transform/other object lookup');
    },
    async get(wanted, options) {
      calls.push({ op: 'get', key: wanted, options });
      if (wanted === receiptKey) {
        if (state.receiptThrows) throw new Error('Optional receipt unavailable');
        if (state.receiptMissing) return null;
        const body = new TextEncoder().encode(state.receiptContent ?? JSON.stringify(receipt));
        return { body: state.receiptStream || body, size: state.receiptSize ?? body.length,
          httpMetadata: { contentType: 'application/json' } };
      }
      if (wanted === row.object_key) return { body: fixture.sourceBytes, size: fixture.sourceSize,
        writeHttpMetadata(h) { h.set('Content-Type', 'video/mp4'); } };
      if (wanted === `${row.object_key}.video-v2-q360.mp4`) return state.legacyVariant ? legacyObject() : null;
      assert.equal(wanted, key);
      if (state.error && state.errorAt === 'derivedGet') throw state.error;
      assert.deepEqual(options.onlyIf, { etagMatches: 'test-derived-etag' });
      if (state.mismatch) return { ...candidate }; // R2 failed If-Match: metadata, no body.
      const range = options.range;
      let body = range ? fixture.bytes.slice(range.offset, range.offset + range.length) : fixture.bytes;
      if (state.bodyRangeMismatch) body = new ReadableStream({
        cancel() { state.cancelled = true; },
      });
      return { ...candidate, body, ...(range ? { range: state.bodyRangeMismatch
        ? { offset: 0, length: range.length } : range } : {}) };
    },
    async put() { assert.fail('Read-existing delivery cannot write R2'); },
    async delete() { assert.fail('Playback cannot delete R2'); },
  }, MEDIA: { input() { assert.fail('Verified original must not enter capped transformation'); } } };
  if (change) change(state);
  return { ...state, state, env, calls, sourceBytes: fixture.sourceBytes };
}

const request = (headers = {}, extra = {}) => new Request(
  `https://sautilink.com/api/sauti-media/${MEDIA}${extra.query || ''}`,
  { method: extra.method || 'GET', headers: { Authorization: 'Bearer synthetic.qa.token', ...headers } });

async function run(api, fixture, change, action) {
  const previous = globalThis.fetch;
  const context = setup(fixture, change);
  globalThis.fetch = async () => Response.json(context.state.allow ? [context.row] : []);
  try { return await action(context, (req = request()) => api.handleSautiMediaRequest(req, context.env)); }
  finally { globalThis.fetch = previous; }
}

for (const [kind, api] of [['raw', raw], ['production-transformed', transformed]]) {
  for (const fixture of fixtures) {
    test(`${kind}: ${fixture.label} complete indexed MP4 and truthful duration/size/ETag for requested quality`, async () => {
      await run(api, fixture, null, async (c, handle) => {
        const response = await handle(request({}, { query: '?quality=360' }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Content-Length'), String(fixture.derivedSize));
        assert.equal(response.headers.get('X-Sauti-Video-Duration-Ms'), String(fixture.completeDurationMs));
        assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'original-index-v1');
        assert.equal(response.headers.get('X-Sauti-Video-Quality'), 'original');
        assert.equal(response.headers.get('ETag'), `"sauti-original-index-v1-${fixture.derivedSha256}"`);
        assert.match(response.headers.get('Cache-Control'), /^private,/);
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), fixture.bytes);
        assert.equal(c.calls.filter(x => x.op === 'get' && x.key === c.key).length, 1);
        if (kind === 'production-transformed') assert.match(response.headers.get('Server-Timing'), /access;dur=.*total;dur=/);
      });
    });

    for (const [range, expectedOffset, expectedLength] of [
      ['bytes=0-', 0, 1048576], ['bytes=64-127', 64, 64],
      [`bytes=${fixture.derivedSize - fixture.appendBytes}-`, fixture.derivedSize - fixture.appendBytes, fixture.appendBytes],
      ['bytes=-256', fixture.derivedSize - 256, 256],
      [`bytes=${fixture.derivedSize - 1}-999999999`, fixture.derivedSize - 1, 1],
    ]) {
      test(`${kind}: ${fixture.label} exact range ${range}`, async () => {
        await run(api, fixture, null, async (c, handle) => {
          const response = await handle(request({ Range: range }));
          assert.equal(response.status, 206);
          assert.equal(response.headers.get('Content-Range'), `bytes ${expectedOffset}-${expectedOffset + expectedLength - 1}/${fixture.derivedSize}`);
          assert.equal(response.headers.get('Content-Length'), String(expectedLength));
          assert.deepEqual(new Uint8Array(await response.arrayBuffer()), fixture.bytes.slice(expectedOffset, expectedOffset + expectedLength));
        });
      });
    }
  }

  for (const value of ['bytes=', 'bytes=-0', 'bytes=7-4', 'bytes=0-1,8-9', 'items=0-1',
    `bytes=${fixtures[0].derivedSize}-`, 'bytes=99999999999999999999999-']) {
    test(`${kind}: invalid/out-of-bounds range ${value} is 416 without GET`, async () => {
      await run(api, null, null, async (c, handle) => {
        const response = await handle(request({ Range: value }));
        assert.equal(response.status, 416);
        assert.equal(response.headers.get('Content-Range'), `bytes */${fixtures[0].derivedSize}`);
        assert.equal((await response.arrayBuffer()).byteLength, 0);
        assert.equal(c.calls.filter(x => x.op === 'get' && x.key === c.key).length, 0);
      });
    });
  }

  test(`${kind}: HEAD ignores Range and returns the selected full representation without GET`, async () => {
    await run(api, null, null, async (c, handle) => {
      const response = await handle(request({ Range: 'bytes=999999999-' }, { method: 'HEAD' }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Content-Length'), String(fixtures[0].derivedSize));
      assert.equal(await response.text(), '');
      assert.equal(c.calls.filter(x => x.op === 'get' && x.key === c.key).length, 0);
    });
  });

  test(`${kind}: conditional validators are authorized and source-validated before 304/206`, async () => {
    await run(api, null, null, async (c, handle) => {
      const etag = `"sauti-original-index-v1-${fixtures[0].derivedSha256}"`;
      for (const value of [etag, `W/${etag}`, '*']) {
        assert.equal((await handle(request({ 'If-None-Match': value }))).status, 304);
      }
      assert.equal(c.calls.filter(x => x.op === 'get' && x.key === c.key).length, 0);
      assert.equal((await handle(request({ Range: 'bytes=1-9', 'If-Range': etag }))).status, 206);
      for (const value of [`W/${etag}`, '"other"', 'Fri, 16 Oct 2026 12:00:00 GMT']) {
        const response = await handle(request({ Range: 'bytes=1-9', 'If-Range': value }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.has('Content-Range'), false);
        await response.body.cancel();
      }
    });
  });

  for (const [name, change] of [
    ['missing', s => { s.missing = true; }],
    ['wrong source ETag', s => { s.source.etag = 'changed-original'; }],
    ['wrong source size', s => { s.source.size++; }],
    ['wrong derived ETag', s => { s.receipt.derivedEtag = 'replaced-derived'; }],
    ['unsupported receipt version', s => { s.receipt.originalIndexVersion = '2'; }],
    ['wrong owner', s => { s.receipt.ownerId = POST; }],
    ['wrong media', s => { s.receipt.mediaId = POST; }],
    ['unverified timeline', s => { s.receipt.timelineComplete = 'false'; }],
    ['unrepaired duration', s => { s.receipt.durationHeadersRepaired = 'false'; }],
    ['invalid SHA', s => { s.receipt.derivedSha256 = 'untrusted'; }],
    ['wrong derived size', s => { s.candidate.size++; }],
    ['wrong content type', s => { s.candidate.httpMetadata.contentType = 'text/html'; }],
  ]) {
    test(`${kind}: ${name} candidate cannot replace an original request`, async () => {
      await run(api, null, change, async (c, handle) => {
        const response = await handle(request());
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'original');
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), c.sourceBytes);
        assert.equal(c.calls.some(x => /video-v\d-q/.test(x.key)), false);
      });
    });
  }

  for (const [duration, expectedVariant] of [[0, 'original'], [null, 'original'],
    [115, 'video-v2;q=360'], [1000, 'video-v2;q=360'], ['not-numeric', 'original']]) {
    test(`${kind}: absent index preserves legacy quality eligibility for metadata duration ${duration}`, async () => {
      await run(api, null, s => { s.missing = true; s.row.duration_ms = duration; s.legacyVariant = true; }, async (c, handle) => {
        const response = await handle(request({}, { query: '?quality=360' }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('X-Sauti-Media-Variant'), expectedVariant);
      });
    });
  }

  for (const missing of [true, false]) {
    test(`${kind}: 478x850/114ms existing360 survives ${missing ? 'missing index' : 'invalid receipt'}`, async () => {
      await run(api, null, s => {
        s.row.width = 478; s.row.height = 850; s.row.duration_ms = 114;
        s.missing = missing; s.legacyVariant = true;
        if (!missing) s.receiptContent = '{"originalIndexVersion":"unsupported"}';
      }, async (c, handle) => {
        const response = await handle(request({}, { query: '?quality=360' }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'video-v2;q=360');
        assert.equal(response.headers.get('X-Sauti-Video-Quality'), '360p');
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), c.state.legacyBytes);
        assert.equal(c.calls.some(x => x.op === 'get' && x.key === c.row.object_key), false);
        assert.ok(c.calls.some(x => x.op === 'get' && x.key === `${c.row.object_key}.video-v2-q360.mp4`));
      });
    });
  }

  test(`${kind}: RLS denial and anonymous video do not probe R2`, async () => {
    await run(api, null, s => { s.allow = false; }, async (c, handle) => {
      assert.equal((await handle()).status, 404);
      assert.equal(c.calls.length, 0);
    });
    await run(api, null, null, async (c, handle) => {
      assert.equal((await handle(new Request(`https://sautilink.com/api/sauti-media/${MEDIA}`))).status, 401);
      assert.equal(c.calls.length, 0);
    });
  });

  test(`${kind}: cookie authorization uses the same RLS lookup and indexed representation`, async () => {
    await run(api, null, null, async (c, handle) => {
      globalThis.fetch = async (_url, init) => {
        assert.equal(init.headers.Authorization, 'Bearer synthetic.cookie.token');
        return Response.json([c.row]);
      };
      const response = await handle(new Request(`https://sautilink.com/api/sauti-media/${MEDIA}`,
        { headers: { Cookie: '__Secure-sautilink-media-session=synthetic.cookie.token', Range: 'bytes=0-1' } }));
      assert.equal(response.status, 206);
    });
  });

  test(`${kind}: candidate replacement after HEAD fails safely without splicing/fallback`, async () => {
    await run(api, null, s => { s.mismatch = true; }, async (c, handle) => {
      const response = await handle(request({ Range: 'bytes=0-100' }));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'MEDIA_REPRESENTATION_CHANGED');
      assert.equal(c.calls.filter(x => x.op === 'get' && x.key === c.key).length, 1);
    });
  });

  for (const [name, change] of [
    ['missing', s => { s.receiptMissing = true; }],
    ['throws', s => { s.receiptThrows = true; }],
    ['malformed JSON', s => { s.receiptContent = '{'; }],
    ['wrong schema', s => { s.receiptContent = '[]'; }],
    ['oversized metadata', s => { s.receiptSize = 4097; }],
    ['oversized actual stream', s => {
      s.receiptSize = 100;
      s.receiptStream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); },
        cancel() { s.cancelled = true; } });
    }],
    ['truncated body', s => { s.receiptSize = 1000; }],
  ]) {
    test(`${kind}: ${name} sidecar cannot activate derived playback`, async () => {
      await run(api, null, change, async (c, handle) => {
        const response = await handle(request());
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'original');
        assert.equal(c.calls.some(x => x.op === 'get' && x.key === c.key), false);
        if (name === 'oversized actual stream') assert.equal(c.state.cancelled, true);
      });
    });
  }

  test(`${kind}: absent derivative never reads a receipt`, async () => {
    await run(api, null, s => { s.missing = true; }, async (c, handle) => {
      assert.equal((await handle()).status, 200);
      assert.equal(c.calls.some(x => x.key.endsWith('.receipt.json')), false);
    });
  });

  test(`${kind}: unexpected R2 range metadata fails safely`, async () => {
    await run(api, null, s => { s.bodyRangeMismatch = true; }, async (c, handle) => {
      assert.equal((await handle(request({ Range: 'bytes=100-110' }))).status, 503);
      assert.equal(c.state.cancelled, true);
    });
  });

  test(`${kind}: same thrown R2 error receives a fixed derived-delivery phase`, async () => {
    const sentinel = new Error('SENSITIVE synthetic provider detail');
    await run(api, null, s => { s.error = sentinel; }, async (c, handle) => {
      await assert.rejects(handle(), error => error === sentinel);
      const diagnostic = api.mediaDeliveryFailureDiagnostic(sentinel);
      assert.equal(diagnostic.delivery_phase, 'ORIGINAL_R2_HEAD');
      assert.equal(JSON.stringify(diagnostic).includes('SENSITIVE'), false);
    });
  });

  test(`${kind}: optional derivative probe failure cannot break the original path`, async () => {
    await run(api, null, s => { s.error = new Error('optional cache unavailable'); s.errorAt = 'candidate'; }, async (c, handle) => {
      const response = await handle(request());
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('X-Sauti-Media-Variant'), 'original');
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), c.sourceBytes);
    });
  });

  test(`${kind}: selected derived GET error is preserved, never replaced by original bytes`, async () => {
    const sentinel = new TypeError('synthetic private storage detail');
    await run(api, null, s => { s.error = sentinel; s.errorAt = 'derivedGet'; }, async (c, handle) => {
      await assert.rejects(handle(), error => error === sentinel);
      assert.equal(api.mediaDeliveryFailureDiagnostic(sentinel).delivery_phase, 'ORIGINAL_INDEX_R2_GET');
      assert.equal(c.calls.some(x => x.op === 'get' && x.key === c.row.object_key), false);
    });
  });

  for (const [name, change] of [
    ['ready unattached upload', s => { s.row.upload_status = 'ready'; s.row.post_id = null; }],
    ['image', s => { s.row.media_kind = 'image'; s.row.content_type = 'image/jpeg'; }],
  ]) {
    test(`${kind}: ${name} does not probe derivative or sidecar`, async () => {
      await run(api, null, change, async (c, handle) => {
        assert.equal((await handle()).status, 200);
        assert.equal(c.calls.some(x => x.op === 'head' || x.key.endsWith('.receipt.json')), false);
      });
    });
  }

  test(`${kind}: protected pending Room route remains outside this API`, async () => {
    await run(api, null, null, async (c, handle) => {
      assert.equal(await handle(new Request(`https://sautilink.com/api/rooms/${POST}/post-submissions/${POST}/media/${MEDIA}`)), null);
      assert.equal(c.calls.length, 0);
    });
  });

  test(`${kind}: deleting a video includes derived cache cleanup, images are unchanged`, () => {
    const c = setup();
    assert.ok(api.sautiMediaObjectKeys(c.row).includes(c.key));
    assert.ok(api.sautiMediaObjectKeys(c.row).includes(originalVideoIndexReceiptObjectKey(c.row.object_key)));
    assert.deepEqual(api.sautiMediaObjectKeys({ ...c.row, media_kind: 'image' }), [c.row.object_key]);
  });
}
