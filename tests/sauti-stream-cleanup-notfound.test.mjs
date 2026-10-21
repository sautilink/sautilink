import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteStreamAsset } from '../src/sauti-stream-provider.js';

test('confirmed missing provider assets finish idempotent cleanup for typed and actual binding errors', async () => {
  const cases = [Object.assign(new Error('missing'), { name: 'NotFoundError' }),
    { status: 404 }, { statusCode: 404 },
    new Error('Not Found: The requested resource or operation was not found.')];
  for (const error of cases) {
    let calls = 0;
    const env = { STREAM: { video(id) { assert.equal(id, 'a'.repeat(32));
      return { async delete() { calls++; throw error; } }; } } };
    assert.equal(await deleteStreamAsset(env, 'a'.repeat(32)), true);
    assert.equal(calls, 1);
  }
});

test('denied, uncertain and similar-looking errors keep cleanup pending', async () => {
  for (const error of [new Error('Forbidden'), new Error('STREAM_OPERATION_TIMEOUT'),
    { status: 403 }, { status: 500 }, new Error('Not Found'),
    new Error('Not Found: The requested resource or operation was not found. Retry later.'),
    'Not Found: The requested resource or operation was not found.']) {
    const env = { STREAM: { video() { return { async delete() { throw error; } }; } } };
    assert.equal(await deleteStreamAsset(env, 'a'.repeat(32)), false);
  }
});
