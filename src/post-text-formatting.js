export const POST_BODY_LIMIT = 2000;

const FORMATS = Object.freeze([
  { marker: '**', tag: 'strong', name: 'bold' },
  { marker: '__', tag: 'u', name: 'underline' },
  { marker: '~~', tag: 's', name: 'strikethrough' },
  { marker: '*', tag: 'em', name: 'italic' },
]);

function protectedEntityRanges(source) {
  const ranges = [];
  const urls = Array.from(source.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+/giu));
  for (const match of source.matchAll(/@[a-z0-9][a-z0-9._]*|#[\p{L}\p{N}_]+/giu)) {
    if (urls.some((url) => match.index >= url.index && match.index < url.index + url[0].length)) continue;
    // An opening underline wrapper is outside the entity; its closing pair may
    // be consumed by the raw token scanner and is resolved by nextFormat.
    const before = source.slice(0, match.index).replace(/_{2,}$/, '');
    if (/[\p{L}\p{N}\p{M}._@/\\]$/u.test(before)) continue;
    const token = match[0].startsWith('@') ? match[0].replace(/\.+$/, '') : match[0];
    if (token.startsWith('@') && token.length < 4) continue;
    ranges.push({ start: match.index, end: match.index + token.length });
  }
  return ranges;
}

function nextFormat(source, start, protectedRanges = []) {
  let match = null;
  for (const format of FORMATS) {
    let open = source.indexOf(format.marker, start);
    while (open !== -1) {
      if (protectedRanges.some((range) => open >= range.start && open < range.end)) {
        open = source.indexOf(format.marker, open + 1);
        continue;
      }
      // The single asterisk must not consume a bold delimiter.
      if (format.marker === '*' && (source[open - 1] === '*' || source[open + 1] === '*')) {
        open = source.indexOf(format.marker, open + 1);
        continue;
      }
      let close = source.indexOf(format.marker, open + format.marker.length);
      while (close !== -1) {
        const entity = protectedRanges.find((range) => close >= range.start && close < range.end);
        if (!entity || (format.marker === '__' && entity.start === open + format.marker.length
          && close + format.marker.length === entity.end)) break;
        close = source.indexOf(format.marker, close + 1);
      }
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

export function parsePostFormatting(value, depth = 0, protectEntities = false) {
  const source = String(value || '');
  if (depth > 4) return [{ text: source }];
  const protectedRanges = protectEntities ? protectedEntityRanges(source) : [];
  const nodes = [];
  let cursor = 0;
  while (cursor < source.length) {
    const match = nextFormat(source, cursor, protectedRanges);
    if (!match) {
      nodes.push({ text: source.slice(cursor) });
      break;
    }
    if (match.open > cursor) nodes.push({ text: source.slice(cursor, match.open) });
    const inner = source.slice(match.open + match.format.marker.length, match.close);
    nodes.push({ tag: match.format.tag, children: parsePostFormatting(inner, depth + 1, protectEntities) });
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
