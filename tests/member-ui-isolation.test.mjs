import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Walk rule blocks recursively so responsive rules are checked too. Commas in
// :is()/attribute selectors belong to the selector, not a separate CSS rule.
function styleSelectors(css) {
  const selectors = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let cursor = 0; cursor < source.length;) {
    const open = source.indexOf('{', cursor);
    if (open < 0) break;
    let end = open + 1;
    let depth = 1;
    for (; depth && end < source.length; end++) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}') depth--;
    }
    const prelude = source.slice(cursor, open).trim();
    if (/^@(media|supports|layer|container)\b/.test(prelude)) {
      selectors.push(...styleSelectors(source.slice(open + 1, end - 1)));
    } else if (!prelude.startsWith('@')) {
      let start = 0;
      let nesting = 0;
      for (let i = 0; i <= prelude.length; i++) {
        if ('(['.includes(prelude[i])) nesting++;
        if (')]'.includes(prelude[i])) nesting--;
        if (i === prelude.length || (prelude[i] === ',' && nesting === 0)) {
          selectors.push(prelude.slice(start, i).trim());
          start = i + 1;
        }
      }
    }
    cursor = end;
  }
  return selectors;
}

test('member presentation remains gated away from every account-entry state', async () => {
  for (const file of ['member-ios.css', 'member-ios-surfaces.css', 'member-ios-icons.css']) {
    const selectors = styleSelectors(await read(`app/assets/${file}`));
    assert.ok(selectors.length > 0, `${file} must contain scoped presentation rules`);
    for (const selector of selectors) {
      assert.match(selector, /body(?:\.[\w-]+)*:not\(\.auth-entry\):has\(#member-view:not\(\[hidden\]\)\)/, `${file}: unguarded rule ${selector}`);
    }
  }
});

test('member icon helper leaves account entry untouched until the member surface opens', async () => {
  const source = await read('app/assets/member-ios-icons.js');
  const member = { hidden: true };
  let authEntry = true;
  const observers = [];
  const queries = [];
  const writes = [];
  const paths = [0, 1].map(() => ({
    value: 'original',
    getAttribute() { return this.value; },
    setAttribute(name, value) { writes.push(name); this.value = value; },
  }));
  const document = {
    readyState: 'complete',
    body: { classList: { contains(name) { return name === 'auth-entry' && authEntry; } } },
    getElementById(id) { assert.equal(id, 'member-view'); return member; },
    querySelector(selector) { queries.push(selector); return { querySelector() { return paths[queries.length - 1]; } }; },
    addEventListener() {},
    removeEventListener() {},
  };
  runInNewContext(source, {
    document,
    Element: class {},
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    },
  });
  assert.deepEqual(queries, []);
  assert.deepEqual(paths.map(path => path.value), ['original', 'original']);
  member.hidden = false;
  observers[0].callback();
  assert.deepEqual(queries, [], 'visible member HTML must still respect the auth-entry state');
  authEntry = false;
  observers[0].callback();
  assert.equal(writes.length, 2);
  assert.ok(paths.every(path => path.value !== 'original'));
  assert.ok(queries.every(selector => !/auth|login|signup/.test(selector)));
});
