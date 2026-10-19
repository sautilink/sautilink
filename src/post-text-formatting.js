export const POST_BODY_LIMIT = 2000;

const FORMATS = Object.freeze([
  { marker: '**', tag: 'strong', name: 'bold' },
  { marker: '__', tag: 'u', name: 'underline' },
  { marker: '~~', tag: 's', name: 'strikethrough' },
  { marker: '*', tag: 'em', name: 'italic' },
]);
const PARSE_FORMATS = [{ marker: '***', tag: 'strong', innerTag: 'em' }, ...FORMATS];

function nextFormat(source, start) {
  // URLs, hashtags and usernames may legitimately contain these characters.
  // Delimiters outside their text can still style the complete entity.
  const entities = Array.from(source.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+|#[\p{L}\p{N}_]+|@[a-z0-9][a-z0-9._]*/giu), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const insideEntity = (index) => entities.find((entity) => index >= entity.start && index < entity.end);
  const multiplicationOperators = new Set();
  for (const expression of source.matchAll(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\*\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)){2,}/g)) {
    for (const operator of expression[0].matchAll(/\*/g)) multiplicationOperators.add(expression.index + operator.index);
  }
  let match = null;
  for (const format of PARSE_FORMATS) {
    let open = source.indexOf(format.marker, start);
    while (open !== -1) {
      // The single asterisk must not consume a bold delimiter.
      if (insideEntity(open)
        || (format.marker === '*' && multiplicationOperators.has(open))
        || (format.marker === '*' && (source[open - 1] === '*' || source[open + 1] === '*'))) {
        open = source.indexOf(format.marker, open + format.marker.length);
        continue;
      }
      let close = source.indexOf(format.marker, open + format.marker.length);
      while (close !== -1) {
        const entity = insideEntity(close);
        const entitySuffix = entity ? source.slice(close + format.marker.length, entity.end) : '';
        if (!(format.marker === '*' && (source[close - 1] === '*' || source[close + 1] === '*'))
          && (!entity || /^[.,!?;:)\]}]*$/.test(entitySuffix))) break;
        close = source.indexOf(format.marker, close + format.marker.length);
      }
      if (close > open + format.marker.length && !source.slice(open, close).includes('\n')
        && source.slice(open + format.marker.length, close).trim()) {
        if (!match || open < match.open || (open === match.open && format.marker.length > match.format.marker.length)) {
          match = { format, open, close };
        }
        break;
      }
      open = source.indexOf(format.marker, open + format.marker.length);
    }
  }
  return match;
}

export function parsePostFormatting(value, depth = 0) {
  const source = String(value || '');
  if (depth > 4) return [{ text: source }];
  const nodes = [];
  let cursor = 0;
  while (cursor < source.length) {
    const match = nextFormat(source, cursor);
    if (!match) {
      nodes.push({ text: source.slice(cursor) });
      break;
    }
    if (match.open > cursor) nodes.push({ text: source.slice(cursor, match.open) });
    const inner = source.slice(match.open + match.format.marker.length, match.close);
    const children = parsePostFormatting(inner, depth + 1);
    nodes.push({
      tag: match.format.tag,
      children: match.format.innerTag ? [{ tag: match.format.innerTag, children }] : children,
    });
    cursor = match.close + match.format.marker.length;
  }
  return nodes;
}

export function hasPostFormatting(value) {
  return parsePostFormatting(value).some((node) => Boolean(node.tag));
}

// Share metadata and text-only previews need the visible caption, without the
// editor's delimiters. Use the same grammar as rich captions so literal and
// unmatched characters are retained rather than stripping every asterisk.
export function postTextPlainText(value) {
  const project = (nodes) => nodes.map((node) => (
    node.tag ? project(node.children) : node.text
  )).join('');
  return project(parsePostFormatting(value));
}

export function insertPostFormatting(textarea, name) {
  const format = FORMATS.find((item) => item.name === name);
  if (!format || !textarea || textarea.disabled) return false;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selection = textarea.value.slice(start, end);
  const wrapped = `${format.marker}${selection || 'text'}${format.marker}`;
  if (textarea.value.length - selection.length + wrapped.length > POST_BODY_LIMIT) return false;
  textarea.setRangeText(wrapped, start, end, 'select');
  const innerStart = start + format.marker.length;
  textarea.setSelectionRange(innerStart, innerStart + (selection || 'text').length);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  return true;
}
