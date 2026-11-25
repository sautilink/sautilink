import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePostAudio } from '../src/post-audio.js';

const track = { id: 'track-1', title: 'Approved title', artist: 'Approved artist', license: {
  startsOn: '2026-01-01', endsOn: null, placements: ['feed'], territories: ['TZ'],
  windowStartMs: 5000, windowEndMs: 60000, maxClipMs: 30000,
} };
const input = { trackId: 'track-1', startMs: 5000, durationMs: 12000, title: 'untrusted title' };
const catalog = async (url, options) => {
  assert.equal(options.redirect, 'manual');
  return Response.json({ track });
};

test('Post audio uses approved metadata and enforces clip, placement, territory and withdrawal', async () => {
  assert.deepEqual(await validatePostAudio(input, 'TZ', catalog), {
    trackId: 'track-1', startMs: 5000, durationMs: 12000, title: 'Approved title', artist: 'Approved artist',
  });
  for (const change of [{ startMs: 0 }, { startMs: 59000 }, { durationMs: 0 },
    { durationMs: 30001 }, { durationMs: 1500.5 }, { trackId: '../private' }]) {
    await assert.rejects(validatePostAudio({ ...input, ...change }, 'TZ', catalog));
  }
  await assert.rejects(validatePostAudio(input, 'KE', catalog));
  await assert.rejects(validatePostAudio(input, 'TZ', async () => new Response(null, { status: 404 })));
  for (const license of [{ placements: ['stories'] }, { endsOn: '2025-01-01' }, { startsOn: '2999-01-01' }]) {
    await assert.rejects(validatePostAudio(input, 'TZ', async () => Response.json({ track: {
      ...track, license: { ...track.license, ...license },
    } })));
  }
  assert.equal(await validatePostAudio(null, 'TZ', catalog), null);
});
