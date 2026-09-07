function replaceExactOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Video player source transform could not find ${label}.`);
  }
  return source.replace(before, after);
}

export function transformVideoPlayerSource(filePath, source) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (!normalized.endsWith('/src/app.js') && !normalized.endsWith('src/app.js')) return source;

  let output = source;

  output = replaceExactOnce(
    output,
    `  homeVideoVisibility.forEach((_ratio, video) => {
    if (video !== activeVideo) video.pause();
  });
  if (activeVideo) activeVideo.play().catch(() => {
    // Muted autoplay can still be declined by browser or device preferences.
  });`,
    `  homeVideoVisibility.forEach((_ratio, video) => {
    if (video !== activeVideo) {
      delete video.dataset.sautiUserPaused;
      video.pause();
    }
  });
  if (activeVideo && activeVideo.dataset.sautiUserPaused !== 'true') activeVideo.play().catch(() => {
    // Muted autoplay can still be declined by browser or device preferences.
  });`,
    'Home autoplay user-pause guard',
  );

  return output;
}
