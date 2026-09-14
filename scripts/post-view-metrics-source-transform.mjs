function transformAppSource(source) {
  const anchor = "let currentMemberId = '';";
  if (!source.includes(anchor)) {
    throw new Error('Post view metrics source transform could not find the current member anchor.');
  }

  return source.replace(
    anchor,
    `${anchor}\ninstallPostViewMetrics({\n  supabase,\n  getCurrentMemberId: () => currentMemberId,\n});`,
  );
}

export function transformPostViewMetricsSource(sourcePath, source) {
  const normalized = String(sourcePath || '').replaceAll('\\\\', '/');
  if (normalized.endsWith('/src/app.js') || normalized.endsWith('src/app.js')) {
    return transformAppSource(source);
  }
  return source;
}
