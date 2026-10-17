import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePostFormatting } from '../src/post-text-formatting.js';

const aware = (value) => parsePostFormatting(value, 0, true);
const plain = (text) => ({ text });
const styled = (tag, text) => ({ tag, children: [plain(text)] });

test('entity-aware mode protects raw underscores while default formatting stays unchanged', () => {
  assert.deepEqual(aware('@cloud__engine__ #__Sauti__'), [plain('@cloud__engine__ #__Sauti__')]);
  assert.deepEqual(parsePostFormatting('@cloud__engine__'), [plain('@cloud'), styled('u', 'engine')]);
  assert.deepEqual(aware('**Bold** *Italic* __Underline__ ~~Strike~~'), parsePostFormatting('**Bold** *Italic* __Underline__ ~~Strike~~'));
});

test('outer formatting keeps complete entity targets and underline wrapper intent', () => {
  assert.deepEqual(aware('**@cloud__engine__**'), [styled('strong', '@cloud__engine__')]);
  assert.deepEqual(aware('__@foo__'), [styled('u', '@foo')]);
  assert.deepEqual(aware('__#Tag__'), [styled('u', '#Tag')]);
  assert.deepEqual(aware('__@foo__.'), [styled('u', '@foo'), plain('.')]);
  assert.deepEqual(aware('__@cloud__engine____'), [styled('u', '@cloud__engine__')]);
  assert.deepEqual(aware('**__@cloud__engine____**'), [{ tag: 'strong', children: [styled('u', '@cloud__engine__')] }]);
  assert.deepEqual(aware('__hello @cloud__engine__ world__'), [styled('u', 'hello @cloud__engine__ world')]);
  assert.deepEqual(aware('__hello @foo__'), [plain('__hello @foo__')], 'ambiguous suffix must not silently change the account target');
});

test('full-length wrapped identifiers are protected before entity length validation', () => {
  const handle = `@${'a'.repeat(20)}__${'b'.repeat(6)}__`;
  const hashtag = `#${'a'.repeat(58)}__bb__`;
  assert.deepEqual(aware(`__${handle}__`), [styled('u', handle)]);
  assert.deepEqual(aware(`__${hashtag}__`), [styled('u', hashtag)]);
  assert.deepEqual(aware('josé@example.com __plain__'), [plain('josé@example.com '), styled('u', 'plain')]);
});
