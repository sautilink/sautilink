export const POST_BODY_LIMIT = 2000;

const FORMATS = Object.freeze([
  { marker: '**', tag: 'strong', name: 'bold' },
  { marker: '__', tag: 'u', name: 'underline' },
  { marker: '~~', tag: 's', name: 'strikethrough' },
  { marker: '*', tag: 'em', name: 'italic' },
]);

function nextFormat(source, start) {
  let match = null;
  for (const format of FORMATS) {
    let open = source.indexOf(format.marker, start);
    while (open !== -1) {
      // The single asterisk must not consume a bold delimiter.
      if (format.marker === '*' && (source[open - 1] === '*' || source[open + 1] === '*')) {
        open = source.indexOf(format.marker, open + 1);
        continue;
      }
      const close = source.indexOf(format.marker, open + format.marker.length);
      if (close > open + format.marker.length && !source.slice(open, close).includes('\n')) {
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
    nodes.push({ tag: match.format.tag, children: parsePostFormatting(inner, depth + 1) });
    cursor = match.close + match.format.marker.length;
  }
  return nodes;
}

export function hasPostFormatting(value) {
  return parsePostFormatting(value).some((node) => Boolean(node.tag));
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
