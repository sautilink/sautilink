const APP_REPLACEMENTS = Object.freeze([
  ['return composerMedia\n    .slice(0, 4)', 'return composerMedia\n    .slice(0, 5)'],
  ['? items.slice(0, 4).filter', '? items.slice(0, 5).filter'],
  ['`${composerMedia.length} / 4`', '`${composerMedia.length} / 5`'],
  ['composerMedia.length >= 4', 'composerMedia.length >= 5'],
  ['Math.max(0, 4 - composerMedia.length)', 'Math.max(0, 5 - composerMedia.length)'],
  ["A post can include up to four media items.", "A post can include up to five media items."],
  ['return Array.isArray(data) ? data.slice(0, 4) : [];', 'return Array.isArray(data) ? data.slice(0, 5) : [];'],
  ['composerMedia.length > 4', 'composerMedia.length > 5'],
  ['composerMedia.length < 4', 'composerMedia.length < 5'],
]);

const POST_API_REPLACEMENTS = Object.freeze([
  ['requestedMedia.length > 4', 'requestedMedia.length > 5'],
  ["A post can include up to four media items.", "A post can include up to five media items."],
]);

function replaceAllExact(source, replacements) {
  let output = source;
  for (const [before, after] of replacements) output = output.replaceAll(before, after);
  return output;
}

export function transformPostMediaSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (normalized.endsWith('/src/app.js') || normalized.endsWith('src/app.js')) {
    return replaceAllExact(source, APP_REPLACEMENTS);
  }
  if (normalized.endsWith('/src/sauti-posts-api.js') || normalized.endsWith('src/sauti-posts-api.js')) {
    return replaceAllExact(source, POST_API_REPLACEMENTS);
  }
  return source;
}
