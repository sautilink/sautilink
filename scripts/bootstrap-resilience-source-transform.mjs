export function transformBootstrapResilienceSource(sourcePath, source) {
  if (!sourcePath.endsWith('app.js')) return source;

  const blockingProbe = '  await refreshProfileMediaCapability();';
  const nonBlockingProbe = '  void refreshProfileMediaCapability();';

  if (source.includes(blockingProbe)) {
    return source.replace(blockingProbe, nonBlockingProbe);
  }

  if (source.includes(nonBlockingProbe)) return source;

  throw new Error('Could not find the SautiLink profile-media bootstrap probe.');
}
