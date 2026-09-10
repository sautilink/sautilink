export function transformLoginBootSource(sourcePath, source) {
  if (!sourcePath.endsWith('app.js')) return source;

  let output = source;

  // 1) /login|/signup: only leave for Home when a full member profile exists
  const oldRoute = `async function applyLocationRoute() {
  const authRoute = window.location.pathname.match(/^\\/(login|signup)\\/?$/);
  if (authRoute) {
    profileRouteRequest += 1;
    if (currentMember) {
      window.history.replaceState({}, '', '/home');
      showMemberSurface('stream', { syncUrl: false });
      return;
    }
    showSignedOut(authRoute[1]);
    return;
  }`;

  const newRoute = `async function applyLocationRoute() {
  const authRoute = window.location.pathname.match(/^\\/(login|signup)\\/?$/);
  if (authRoute) {
    profileRouteRequest += 1;
    // Explicit auth URLs stay on the sign-in UI until a full member profile is ready.
    // A partial/stale session must not rewrite to /home and leave the boot spinner up.
    if (currentMember?.username) {
      window.history.replaceState({}, '', '/home');
      showMemberSurface('stream', { syncUrl: false });
      return;
    }
    showSignedOut(authRoute[1]);
    return;
  }`;

  if (output.includes(oldRoute)) {
    output = output.replace(oldRoute, newRoute);
  }

  // 2) Stream load timeouts so Home cannot spin forever
  if (!output.includes('streamBootWithTimeout') && output.includes('async function loadStream({ reset = false } = {})')) {
    output = output.replace(
      'async function loadStream({ reset = false } = {})',
      `function streamBootWithTimeout(promise, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const error = new Error('Home feed loading timed out.');
      error.code = 'STREAM_BOOT_TIMEOUT';
      reject(error);
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function loadStream({ reset = false } = {})`,
    );
    output = output.replace(
      'const { data, error: queryError } = await query;',
      'const { data, error: queryError } = await streamBootWithTimeout(query);',
    );
    output = output.replace(
      'const hydrated = await hydrateStreamEvents(page);',
      'const hydrated = await streamBootWithTimeout(hydrateStreamEvents(page), 10000);',
    );
  }

  // 3) Immediate auth UI on /login|/signup; never block boot on media probe
  const oldBoot = `async function bootstrap() {
  configureEmailOtpInputs();
  await refreshProfileMediaCapability();
`;
  const newBoot = `async function bootstrap() {
  const initialAuthRoute = window.location.pathname.match(/^\\/(login|signup)\\/?$/);
  // Explicit /login or /signup must show the auth form immediately — do not wait
  // for session restoration or profile hydration (those can hang or redirect to /home).
  if (initialAuthRoute) {
    showAuthPanel(initialAuthRoute[1]);
  }

  configureEmailOtpInputs();
  void refreshProfileMediaCapability();
`;
  if (output.includes(oldBoot)) {
    output = output.replace(oldBoot, newBoot);
  }

  // 4) Prefer session.user over a second blocking getUser()
  const oldGetUser = `    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      currentMember = null;
      currentMemberId = '';
      currentAccountEmail = '';
      syncAccountSecurityEmail();
      return applyLocationRoute();
    }
`;
  const newGetUser = `    const user = session.user;
    if (!user?.id) {
      currentMember = null;
      currentMemberId = '';
      currentAccountEmail = '';
      syncAccountSecurityEmail();
      return applyLocationRoute();
    }
`;
  if (output.includes(oldGetUser)) {
    output = output.replace(oldGetUser, newGetUser);
  }

  return output;
}
