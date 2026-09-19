function replaceExactOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Runtime performance source transform could not find ${label}.`);
  }
  return source.replace(before, after);
}

function transformAppStartup(source) {
  return replaceExactOnce(
    source,
    `    void ensureSettingsPreferences()
      .then((preferences) => {
        currentSettingsPreferences = preferences;
        if (!messageBadgesEnabled()) syncMessageBadges(0);
        else void refreshMessageBadge();
        if (activeConversation?.id) void startDmConversationRealtime(activeConversation.id);
      })
      .catch(() => { currentSettingsPreferences = null; });
    void refreshNotificationBadge();
    void refreshMessageBadge();
    void syncModerationAccess();`,
    `    void ensureSettingsPreferences()
      .then((preferences) => {
        currentSettingsPreferences = preferences;
        if (!messageBadgesEnabled()) syncMessageBadges(0);
        else void refreshMessageBadge();
        if (activeConversation?.id) void startDmConversationRealtime(activeConversation.id);
      })
      .catch(() => {
        currentSettingsPreferences = null;
        void refreshMessageBadge();
      });
    void refreshNotificationBadge();
    void syncModerationAccess();`,
    'the deferred member service startup block',
  );
}

function transformAssetCaching(source) {
  return replaceExactOnce(
    source,
    `  const protectedMediaDelivery = /^\\/api\\/sauti-media\\/[0-9a-f-]{36}$/i.test(url.pathname);
  if (isApiPath(url.pathname) && !protectedMediaDelivery) {
    headers.set('Cache-Control', 'no-store');
  }`,
    `  const protectedMediaDelivery = /^\\/api\\/sauti-media\\/[0-9a-f-]{36}$/i.test(url.pathname);
  if (isApiPath(url.pathname) && !protectedMediaDelivery) {
    headers.set('Cache-Control', 'no-store');
  }

  const appCodeAsset = /^\\/app\\/assets\\/.+\\.(?:css|js)$/i.test(url.pathname);
  const contentHashedAppAsset = appCodeAsset && /^[a-f0-9]{12}$/i.test(url.searchParams.get('v') || '');
  if (contentHashedAppAsset) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (appCodeAsset) {
    headers.set('Cache-Control', 'no-cache, max-age=0, must-revalidate');
  } else if (url.pathname.startsWith('/app/assets/')) {
    headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  }`,
    'the response cache finalizer',
  );
}

export function transformRuntimePerformanceSource(sourcePath, source) {
  const normalized = String(sourcePath || '').replaceAll('\\', '/');
  if (normalized.endsWith('/src/app.js') || normalized.endsWith('src/app.js')) {
    return transformAppStartup(source);
  }
  if (normalized.endsWith('/src/asset-router.js') || normalized.endsWith('src/asset-router.js')) {
    return transformAssetCaching(source);
  }
  return source;
}
