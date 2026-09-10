export function transformMemberBootstrapResilienceSource(sourcePath, source) {
  if (!sourcePath.endsWith('app.js')) return source;

  let output = source;

  const memberBlockPattern = /function renderMember\(profile, userId = currentMemberId\) \{[\s\S]*?\n\}\n\nasync function loadMember\(user\) \{[\s\S]*?\n\}\n\nasync function completeOnboarding/;
  if (!memberBlockPattern.test(output)) {
    throw new Error('Could not find the SautiLink member bootstrap block.');
  }

  const resilientMemberBlock = `let memberLoadPromise = null;
let memberLoadUserId = '';
const MEMBER_BOOT_TIMEOUT_MS = 6500;
const AUTH_SESSION_BOOT_TIMEOUT_MS = 4500;
const AUTH_ROUTE_REVEAL_MS = 1800;

function cachedAuthSession() {
  try {
    const stored = JSON.parse(window.localStorage.getItem('sautilink.auth.session') || 'null');
    const session = stored?.currentSession || stored?.session || stored;
    if (!session?.user?.id || !session?.access_token) return null;
    const expiresAt = Number(session.expires_at || 0);
    if (expiresAt > 0 && (expiresAt * 1000) <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function authSessionBootWithTimeout(promise, timeoutMs = AUTH_SESSION_BOOT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const error = new Error('Session restoration timed out.');
      error.code = 'AUTH_SESSION_BOOT_TIMEOUT';
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

function memberFallbackProfile(user, account = null) {
  const createdAt = Date.parse(String(user?.created_at || ''));
  const establishedAccount = Boolean(account)
    || !Number.isFinite(createdAt)
    || (Date.now() - createdAt) > 5 * 60 * 1000;
  const username = normalizeUsername(account?.username || user?.user_metadata?.username || '');
  if (!establishedAccount || !username) return null;
  const displayName = String(
    account?.full_name
      || user?.user_metadata?.full_name
      || user?.user_metadata?.name
      || username,
  ).trim() || username;

  return {
    id: user.id,
    username,
    full_name: displayName,
    display_name: displayName,
    bio: '',
    avatar_key: null,
    updated_at: null,
    location: '',
    website_url: '',
    is_discoverable: true,
    is_verified: false,
    verification_badge_type: 'standard',
    followers_count: 0,
    following_count: 0,
  };
}

function memberBootWithTimeout(promise, timeoutMs = MEMBER_BOOT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const error = new Error('Member profile loading timed out.');
      error.code = 'MEMBER_BOOT_TIMEOUT';
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

function refreshMemberProfileAfterFallback(user) {
  if (!user?.id) return;
  window.setTimeout(async () => {
    try {
      const [accountResult, socialResult] = await Promise.all([
        supabase
          .from('account_profiles')
          .select('username, full_name')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('social_profiles')
          .select('id, username, display_name, bio, avatar_key, updated_at, location, website_url, is_discoverable, is_verified, verification_badge_type, followers_count, following_count')
          .eq('id', user.id)
          .maybeSingle(),
      ]);

      if (currentMemberId !== user.id || accountResult.error || socialResult.error || !accountResult.data || !socialResult.data) return;
      currentMember = { ...accountResult.data, ...socialResult.data };
      try { syncMemberIdentityVisuals(); } catch { /* Core Home remains usable if optional profile UI fails. */ }
    } catch {
      // Fallback identity remains usable; a later navigation or refresh can hydrate details.
    }
  }, 0);
}

function renderMember(profile, userId = currentMemberId) {
  document.body.classList.remove('auth-entry');
  delete document.body.dataset.authMode;
  const displayName = profile.display_name || profile.full_name || profile.username || 'SautiLink member';
  const username = profile.username || 'member';
  currentMember = { ...profile };
  currentMemberId = userId || profile.id || currentMemberId;

  // Make the signed-in shell usable before optional profile decoration runs. A
  // missing/stale profile sub-element must never trap the whole app on the boot spinner.
  loadingView.hidden = true;
  authView.hidden = true;
  memberView.hidden = false;
  railAccount.hidden = false;
  mobileSignoutButton.hidden = false;
  document.querySelectorAll('[data-open-sauti-composer]').forEach((button) => { button.disabled = false; });
  if (byId('sauti-body')) byId('sauti-body').disabled = false;
  if (byId('sauti-media-add')) byId('sauti-media-add').disabled = false;

  try { showMemberSurface('stream', { syncUrl: false }); } catch { /* Keep core shell visible. */ }

  try {
    renderProfileAvatar(byId('member-avatar'), currentMember, displayName);
    renderProfileAvatar(byId('rail-avatar'), currentMember, displayName);
    setInlineVerifiedName(byId('member-display-name'), displayName, currentMember);
    if (byId('member-username')) byId('member-username').textContent = '@' + username;
    setInlineVerifiedName(byId('rail-name'), displayName, currentMember);
    if (byId('rail-username')) byId('rail-username').textContent = '@' + username;
    if (byId('member-first-name')) byId('member-first-name').textContent = displayName.split(/\\s+/)[0];
  } catch {
    // Identity decoration is non-critical to opening Home.
  }

  try { renderProfile(currentMember); } catch { /* Profile card can hydrate later. */ }
  try { void prepareComposer(); } catch { /* Composer preparation is best effort at boot. */ }
  try { syncComposerOnlineState(); } catch { /* Home feed must still open. */ }

  void loadStream({ reset: true });
  void ensureDmInboxRealtime();
  void ensureSettingsPreferences()
    .then((preferences) => {
      currentSettingsPreferences = preferences;
      if (!messageBadgesEnabled()) syncMessageBadges(0);
      else void refreshMessageBadge();
      if (activeConversation?.id) void startDmConversationRealtime(activeConversation.id);
    })
    .catch(() => { currentSettingsPreferences = null; });
  void refreshNotificationBadge();
  void refreshMessageBadge();
  void syncModerationAccess();
}

async function loadMemberOnce(user) {
  if (!user?.id) {
    showSignedOut('login');
    setMessage(byId('login-message'), 'Your session could not be opened. Sign in again.');
    return;
  }

  currentAccountEmail = normalizeEmail(user?.email || '');
  syncAccountSecurityEmail();

  const accountRequest = supabase
    .from('account_profiles')
    .select('username, full_name')
    .eq('id', user.id)
    .maybeSingle();

  let accountResult;
  try {
    accountResult = await memberBootWithTimeout(accountRequest);
  } catch (error) {
    const fallback = memberFallbackProfile(user);
    if (error?.code === 'MEMBER_BOOT_TIMEOUT' && fallback) {
      renderMember(fallback, user.id);
      refreshMemberProfileAfterFallback(user);
      await applyLocationRoute();
      return;
    }
    showSignedOut('login');
    setMessage(byId('login-message'), 'Your session opened, but your profile could not be loaded. Try again.');
    return;
  }

  const { data: account, error: accountError } = accountResult || {};
  if (accountError) {
    showSignedOut('login');
    setMessage(byId('login-message'), 'Your session opened, but your profile could not be loaded. Try again.');
    return;
  }

  if (!account) {
    const suggestedUsername = normalizeUsername(user.user_metadata?.username || '');
    const suggestedName = String(user.user_metadata?.full_name || suggestedUsername).trim();
    byId('onboarding-username').value = suggestedUsername;
    byId('onboarding-name').value = suggestedName;
    setMessage(byId('onboarding-message'), '', '');
    showAuthPanel('onboarding');
    return;
  }

  const socialRequest = supabase
    .from('social_profiles')
    .select('id, username, display_name, bio, avatar_key, updated_at, location, website_url, is_discoverable, is_verified, verification_badge_type, followers_count, following_count')
    .eq('id', user.id)
    .maybeSingle();

  let socialResult;
  try {
    socialResult = await memberBootWithTimeout(socialRequest);
  } catch (error) {
    const fallback = memberFallbackProfile(user, account);
    if (error?.code === 'MEMBER_BOOT_TIMEOUT' && fallback) {
      renderMember(fallback, user.id);
      refreshMemberProfileAfterFallback(user);
      await applyLocationRoute();
      return;
    }
    showSignedOut('login');
    setMessage(byId('login-message'), 'Your account is secure, but social profile setup is unavailable right now.');
    return;
  }

  const { data: social, error: socialError } = socialResult || {};
  if (socialError || !social) {
    showSignedOut('login');
    setMessage(byId('login-message'), 'Your account is secure, but social profile setup is unavailable right now.');
    return;
  }

  renderMember({ ...account, ...social }, user.id);
  void loadDeletionRequestState();
  await applyLocationRoute();
}

async function loadMember(user) {
  const userId = String(user?.id || '');
  if (memberLoadPromise && memberLoadUserId === userId) return memberLoadPromise;

  memberLoadUserId = userId;
  memberLoadPromise = loadMemberOnce(user).finally(() => {
    if (memberLoadUserId === userId) {
      memberLoadPromise = null;
      memberLoadUserId = '';
    }
  });
  return memberLoadPromise;
}

async function completeOnboarding`;

  output = output.replace(memberBlockPattern, resilientMemberBlock);

  const bootstrapStart = `async function bootstrap() {
  configureEmailOtpInputs();`;
  const resilientBootstrapStart = `async function bootstrap() {
  const initialAuthRoute = window.location.pathname.match(/^\\/(login|signup)\\/?$/);
  if (initialAuthRoute) {
    window.setTimeout(() => {
      if (!loadingView.hidden) showAuthPanel(initialAuthRoute[1]);
    }, AUTH_ROUTE_REVEAL_MS);
  }
  configureEmailOtpInputs();`;
  const loginBootstrapStart = `async function bootstrap() {
  const initialAuthRoute = window.location.pathname.match(/^\\/(login|signup)\\/?$/);
  // Explicit /login or /signup must show the auth form immediately — do not wait
  // for session restoration or profile hydration (those can hang or redirect to /home).
  if (initialAuthRoute) {
    showAuthPanel(initialAuthRoute[1]);
  }

  configureEmailOtpInputs();`;
  if (!output.includes(bootstrapStart)) {
    if (!output.includes(resilientBootstrapStart) && !output.includes(loginBootstrapStart)) {
      throw new Error('Could not find the SautiLink bootstrap start.');
    }
  } else {
    output = output.replace(bootstrapStart, resilientBootstrapStart);
  }

  const getSessionBlock = `    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {`;
  const resilientGetSessionBlock = `    let sessionResult;
    try {
      sessionResult = await authSessionBootWithTimeout(supabase.auth.getSession());
    } catch {
      const cachedSession = cachedAuthSession();
      const fallback = memberFallbackProfile(cachedSession?.user);
      if (cachedSession?.user?.id && fallback) {
        renderMember(fallback, cachedSession.user.id);
        refreshMemberProfileAfterFallback(cachedSession.user);
        void applyLocationRoute();
        return;
      }
      currentMember = null;
      currentMemberId = '';
      currentAccountEmail = '';
      syncAccountSecurityEmail();
      return applyLocationRoute();
    }
    const { data: { session } = {}, error } = sessionResult || {};
    if (error || !session) {`;
  if (!output.includes(getSessionBlock)) {
    if (!output.includes(resilientGetSessionBlock)) {
      throw new Error('Could not find the SautiLink bootstrap getSession block.');
    }
  } else {
    output = output.replace(getSessionBlock, resilientGetSessionBlock);
  }

  const getUserBlock = `    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      currentMember = null;
      currentMemberId = '';
      currentAccountEmail = '';
      syncAccountSecurityEmail();
      return applyLocationRoute();
    }
`;
  const sessionUserBlock = `    const user = session.user;
    if (!user?.id) {
      currentMember = null;
      currentMemberId = '';
      currentAccountEmail = '';
      syncAccountSecurityEmail();
      return applyLocationRoute();
    }
`;

  if (!output.includes(getUserBlock)) {
    if (!output.includes(sessionUserBlock)) {
      throw new Error('Could not find the SautiLink bootstrap getUser block.');
    }
  } else {
    output = output.replace(getUserBlock, sessionUserBlock);
  }

  return output;
}
