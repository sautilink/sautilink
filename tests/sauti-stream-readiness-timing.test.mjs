import assert from 'node:assert/strict';
import test from 'node:test';
import Hls from 'hls.js';
import { readinessLoader } from '../src/sauti-stream-readiness.js';

const MEDIA = '11111111-1111-4111-8111-111111111111';

async function sampleCachedFragment({ size, duration, bitrate = 240000, parseMs = 5, clock = 5000 }) {
  const previousSelf = globalThis.self;
  globalThis.self = globalThis;
  const hls = new Hls({ enableWorker: false, autoStartLoad: false, startLevel: 0 });
  let delivered = 0, stats;
  class NetworkLoader extends Hls.DefaultConfig.loader {
    load() { assert.fail('an authorized memory hit must not start another network request'); }
  }
  const Loader = readinessLoader(NetworkLoader, {
    resource() { return { size, duration, data: new ArrayBuffer(size), isCurrent: () => true }; },
  }, MEDIA);
  const loader = new Loader(Hls.DefaultConfig);
  try {
    loader.load({ url: 'authorized-memory-fragment', responseType: 'arraybuffer', rangeStart: 0, rangeEnd: 0 }, {}, {
      onSuccess(response, measured) {
        delivered++; stats = measured;
        assert.equal(response.data.byteLength, size);
      },
    });
    assert.equal(delivered, 0, 'SDK callbacks stay asynchronous');
    await Promise.resolve();
    assert.equal(delivered, 1, 'recorded network duration must not delay cached delivery');
    assert.ok(stats.loading.start >= 0);
    assert.ok(stats.loading.start <= stats.loading.first && stats.loading.first <= stats.loading.end);
    assert.equal(stats.loading.end, clock);
    stats.parsing.end = stats.loading.end + parseMs;
    const frag = { type: 'main', sn: 1, level: 0, bitrate, stats };
    // These are the installed SDK's actual ABR handlers and EWMA estimator,
    // including its TTFB subtraction and special low-bitrate fragment path.
    hls.abrController.onFragLoaded(Hls.Events.FRAG_LOADED, { frag });
    hls.abrController.onFragBuffered(Hls.Events.FRAG_BUFFERED, { frag, stats });
    return { stats, estimate: stats.bwEstimate, canEstimate: hls.abrController.bwEstimator.canEstimate() };
  } finally {
    loader.destroy(); hls.destroy();
    if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf;
  }
}

test('an actual SDK ABR sample uses the retained network duration instead of a zero-time memory transfer', async (t) => {
  assert.equal(Hls.version, '1.7.3');
  t.mock.method(globalThis.performance, 'now', () => 5000);
  const { stats, estimate, canEstimate } = await sampleCachedFragment({ size: 100000, duration: 1000 });
  assert.deepEqual(stats.loading, { start: 4000, first: 4000, end: 5000 });
  assert.equal(canEstimate, true);
  assert.ok(estimate >= 790000 && estimate <= 800000,
    `100KB fetched in one second must estimate about800kbps, not the former160Mbps: ${estimate}`);
});

test('very small and low-bitrate cached fragments retain finite, conservative real SDK bandwidth samples', async (t) => {
  t.mock.method(globalThis.performance, 'now', () => 5000);
  for (const size of [1, 64, 1000]) {
    const { stats, estimate, canEstimate } = await sampleCachedFragment({ size, duration: 1000, bitrate: 64000 });
    assert.equal(stats.loading.end - stats.loading.first, 1000);
    assert.equal(canEstimate, true, 'a measured one-second transfer retains its estimator weight');
    assert.ok(Number.isFinite(estimate) && Math.abs(estimate - size * 8) < 0.01,
      `the low-bitrate path must use original transfer time even for ${size}bytes: ${estimate}`);
  }
});

test('cache timestamps remain ordered with short, missing or invalid recorded durations and a fresh performance clock', async (t) => {
  t.mock.method(globalThis.performance, 'now', () => 2);
  for (const duration of [0, 1, 1000, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { stats, estimate } = await sampleCachedFragment({ size: 1, duration, bitrate: 64000, clock: 2 });
    assert.ok(Number.isFinite(stats.loading.start) && Number.isFinite(stats.loading.first) && Number.isFinite(stats.loading.end));
    assert.ok(stats.loading.start >= 0 && stats.loading.end - stats.loading.first >= 1);
    assert.ok(Number.isFinite(estimate));
  }
});
