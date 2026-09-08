import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Microsoft publisher domain association is valid and points to SautiLink app registration', async () => {
  const source = await read('.well-known/microsoft-identity-association.json');
  const payload = JSON.parse(source);

  assert.deepEqual(payload, {
    associatedApplications: [
      { applicationId: 'd360a260-e217-4448-9eae-d9f95a98674f' },
    ],
  });
});
