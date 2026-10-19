import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  for (const file of ['member-ios.css', 'member-ios-surfaces.css', 'member-ios-icons.css', 'member-animated-icons.css', 'member-profile-tabs.css', 'member-builtin-controls.css', 'member-builtin-dialogs.css', 'member-builtin-color.css', 'member-builtin-files.css', 'member-builtin-media.css', 'member-comment-sheet.css']) {
    const selectors = styleSelectors(await read(`app/assets/${file}`));
    assert.ok(selectors.length > 0, `${file} must contain scoped presentation rules`);
    for (const selector of selectors) {
      assert.match(selector, /body(?:\.[\w-]+)*:not\(\.auth-entry\):has\(#member-view:not\(\[hidden\]\)\)/, `${file}: unguarded rule ${selector}`);
    }
  }
});
