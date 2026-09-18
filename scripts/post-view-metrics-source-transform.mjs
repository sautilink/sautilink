function transformAppSource(source) {
  const anchor = "let currentMemberId = '';";
  if (!source.includes(anchor)) {
    throw new Error('Post view metrics source transform could not find the current member anchor.');
  }

  const importLine = "import { installProfessionalDashboard } from './professional-dashboard.js';\n";
  const withImport = source.includes(importLine)
    ? source
    : `${importLine}${source}`;

  const withInstall = withImport.replace(
    anchor,
    `${anchor}\ninstallPostViewMetrics({\n  supabase,\n  getCurrentMemberId: () => currentMemberId,\n});\ninstallProfessionalDashboard({\n  supabase,\n  getCurrentMemberId: () => currentMemberId,\n});\ninstallProfessionalDashboardRouting();`,
  );

  const routeAnchor = 'async function applyLocationRoute() {';
  if (!withInstall.includes(routeAnchor)) {
    throw new Error('Professional Dashboard routing transform could not find applyLocationRoute().');
  }

  const routingHelpers = `let professionalDashboardHistoryInternal = false;

function professionalDashboardRouteKind(pathname = window.location.pathname) {
  const normalized = String(pathname || '/').replace(/\\/+$/, '') || '/';
  if (normalized === '/dashboard') return 'insights';
  if (normalized === '/dashboard/tools') return 'tools';
  if (/^\\/dashboard\\/(?:tools\\/)?moneti[sz]ation$/i.test(normalized)) return 'monetisation';
  return '';
}

function professionalDashboardCanonicalPath(kind) {
  if (kind === 'monetisation') return '/dashboard/tools/monetisation';
  if (kind === 'tools') return '/dashboard/tools';
  return '/dashboard';
}

function professionalDashboardSetTab(kind) {
  const tab = document.querySelector(\`[data-dashboard-tab="\${kind === 'monetisation' ? 'monetisation' : 'insights'}"]\`);
  if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
}

function openProfessionalDashboardRoute(kind, { canonicalize = true } = {}) {
  if (!currentMember?.username) return false;
  showMemberSurface('profile', { syncUrl: false });
  const dashboardButton = document.getElementById('profile-dashboard-button');
  if (!dashboardButton) return false;
  dashboardButton.click();
  professionalDashboardSetTab(kind);

  if (canonicalize && kind === 'monetisation') {
    const canonicalPath = professionalDashboardCanonicalPath(kind);
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState({}, '', canonicalPath);
    }
  }
  return true;
}

function installProfessionalDashboardRouting() {
  document.addEventListener('click', (event) => {
    if (professionalDashboardHistoryInternal) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest('#profile-dashboard-button')) {
      const path = '/dashboard';
      if (window.location.pathname !== path) window.history.pushState({}, '', path);
      return;
    }

    const tab = target.closest('[data-dashboard-tab]');
    if (tab && !document.getElementById('professional-dashboard-surface')?.hidden) {
      const path = professionalDashboardCanonicalPath(tab.dataset.dashboardTab === 'monetisation' ? 'monetisation' : 'insights');
      if (window.location.pathname !== path) window.history.pushState({}, '', path);
      return;
    }

    if (target.closest('.professional-dashboard-back')) {
      const username = String(currentMember?.username || '').trim();
      if (username) {
        const path = memberProfilePath(username);
        if (window.location.pathname !== path) window.history.pushState({}, '', path);
      }
    }
  }, true);

  window.addEventListener('popstate', () => {
    if (professionalDashboardRouteKind(window.location.pathname)) return;
    const surface = document.getElementById('professional-dashboard-surface');
    if (!surface || surface.hidden) return;
    const back = surface.querySelector('.professional-dashboard-back');
    if (!back) return;
    professionalDashboardHistoryInternal = true;
    try {
      back.click();
    } finally {
      professionalDashboardHistoryInternal = false;
    }
  });
}
`;

  return withInstall.replace(
    routeAnchor,
    `${routingHelpers}\n${routeAnchor}\n  const professionalDashboardRoute = professionalDashboardRouteKind(window.location.pathname);\n  if (professionalDashboardRoute) {\n    profileRouteRequest += 1;\n    if (currentMember?.username && openProfessionalDashboardRoute(professionalDashboardRoute)) return;\n    if (!currentMember) {\n      showSignedOut('login');\n      return;\n    }\n  }`,
  );
}

export function transformPostViewMetricsSource(sourcePath, source) {
  const normalized = String(sourcePath || '').replaceAll('\\', '/');
  if (normalized.endsWith('/src/app.js') || normalized.endsWith('src/app.js')) {
    return transformAppSource(source);
  }
  return source;
}
