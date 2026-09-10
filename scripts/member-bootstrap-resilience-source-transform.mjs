export function transformMemberBootstrapResilienceSource(sourcePath, source) {
  if (!sourcePath.endsWith('app.js')) return source;

  let output = source;

  const memberBlockPattern = /function renderMember\(profile, userId = currentMemberId\) \{[\s\S]*?\n\}\n\nasync function loadMember\(user\) \{[\s\S]*?\n\}\n\nasync function completeOnboarding/;
  if (!memberBlockPattern.test(output)) {
    throw new Error('Could not find the SautiLink member bootstrap block.');
  }

  const resilientMemberBlock = `let memberLoadPromise = null;
let memberLoadUserId = '';
const MEMBER_BOOT_TIMEOUT_MS = 4500;
const AUTH_SESSION_BOOT_TIMEOUT_MS = 4500;
const AUTH_ROUTE_REVEAL_MS = 1800;
const MEMBER_REFRESH_DELAY_MS = 700;
const READ_RETRY_ATTEMPTS = 3;
const READ_RETRY_TIMEOUT_MS = 5000;
const READ_RETRY_DELAYS_MS = [0, 180, 650];
const MEMBER_CACHE_PREFIX = 'sautilink.member.cache.v1:';

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

function cachedMemberProfile(userId) {
  if (!userId) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(MEMBER_CACHE_PREFIX + userId) || 'null');
    if (!value || value.id !== userId || !normalizeUsername(value.username || '')) return null;
    return value;
  } catch {
    return null;
  }
}

function cacheMemberProfile(profile, userId = profile?.id) {
  const id = String(userId || profile?.id || '');
  const username = normalizeUsername(profile?.username || '');
  if (!id || !username) return;
  const cached = {
    id,
    username,
    full_name: String(profile?.full_name || profile?.display_name || username).trim() || username,
    display_name: String(profile?.display_name || profile?.full_name || username).trim() || username,
    bio: String(profile?.bio || ''),
    avatar_key: profile?.avatar_key || null,
    updated_at: profile?.updated_at || null,
    location: String(profile?.location || ''),
    website_url: String(profile?.website_url || ''),
    is_discoverable: profile?.is_discoverable !== false,
    is_verified: Boolean(profile?.is_verified),
    verification_badge_type: profile?.verification_badge_type || 'standard',
    followers_count: Number(profile?.followers_count || 0),
    following_count: Number(profile?.following_count || 0),
  };
  try {
    window.localStorage.setItem(MEMBER_CACHE_PREFIX + id, JSON.stringify(cached));
  } catch {
    // Member identity caching is only a resilience optimization.
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
  const cached = cachedMemberProfile(user?.id);
  if (cached) return cached;

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

function readRetryDelay(attempt) {
  return READ_RETRY_DELAYS_MS[Math.min(attempt, READ_RETRY_DELAYS_MS.length - 1)] || 0;
}

function shouldRetryRead(error) {
  if (!error) return false;
  const code = String(error?.code || '').toUpperCase();
  if (code === '42501' || code.startsWith('22') || code.startsWith('23') || code.startsWith('42')) {
    return false;
  }
  return true;
}

async function resilientRead(factory, { attempts = READ_RETRY_ATTEMPTS, timeoutMs = READ_RETRY_TIMEOUT_MS } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const delay = readRetryDelay(attempt);
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    try {
      const result = await memberBootWithTimeout(Promise.resolve().then(factory), timeoutMs);
      if (result?.error) throw result.error;
      return result;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || !shouldRetryRead(error)) throw error;
    }
  }
  throw lastError || new Error('Read failed.');
}

function refreshMemberProfileAfterFallback(user) {
  if (!user?.id) return;
  window.setTimeout(async () => {
    try {
      const [accountResult, socialResult] = await Promise.all([
        resilientRead(() => supabase
          .from('account_profiles')
          .select('username, full_name')
          .eq('id', user.id)
          .maybeSingle()),
        resilientRead(() => supabase
          .from('social_profiles')
          .select('id, username, display_name, bio, avatar_key, updated_at, location, website_url, is_discoverable, is_verified, verification_badge_type, followers_count, following_count')
          .eq('id', user.id)
          .maybeSingle()),
      ]);

      if (currentMemberId !== user.id || !accountResult?.data || !socialResult?.data) return;
      currentMember = { ...accountResult.data, ...socialResult.data };
      cacheMemberProfile(currentMember, user.id);
      try { syncMemberIdentityVisuals(); } catch { /* Core Home remains usable if optional profile UI fails. */ }
    } catch {
      // Fallback identity remains usable; a later focus, navigation, or refresh can hydrate details.
    }
  }, MEMBER_REFRESH_DELAY_MS);
}

function startDeferredMemberServices() {
  window.setTimeout(() => {
    if (!currentMemberId) return;
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
  }, MEMBER_REFRESH_DELAY_MS);
}

function renderMember(profile, userId = currentMemberId) {
  document.body.classList.remove('auth-entry');
  delete document.body.dataset.authMode;
  const displayName = profile.display_name || profile.full_name || profile.username || 'SautiLink member';
  const username = profile.username || 'member';
  currentMember = { ...profile };
  currentMemberId = userId || profile.id || currentMemberId;
  cacheMemberProfile(currentMember, currentMemberId);

  // Reveal the signed-in shell before any optional work. The feed gets first
  // access to the network; messages, badges and moderation hydrate shortly after.
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
  startDeferredMemberServices();
}

async function loadMemberOnce(user) {
  if (!user?.id) {
    showSignedOut('login');
    setMessage(byId('login-message'), 'Your session could not be opened. Sign in again.');
    return;
  }

  currentAccountEmail = normalizeEmail(user?.email || '');
  syncAccountSecurityEmail();

  let accountResult;
  try {
    accountResult = await resilientRead(() => supabase
      .from('account_profiles')
      .select('username, full_name')
      .eq('id', user.id)
      .maybeSingle(), { timeoutMs: MEMBER_BOOT_TIMEOUT_MS });
  } catch {
    const fallback = memberFallbackProfile(user);
    if (fallback) {
      renderMember(fallback, user.id);
      refreshMemberProfileAfterFallback(user);
      void loadDeletionRequestState();
      await applyLocationRoute();
      return;
    }

    // A valid auth session must not be treated as signed out just because a
    // profile read had a transient backend failure.
    const cachedSession = cachedAuthSession();
    if (cachedSession?.user?.id === user.id) {
      window.setTimeout(() => {
        if (!currentMember && memberLoadUserId !== user.id) void loadMember(user);
      }, MEMBER_REFRESH_DELAY_MS);
      return;
    }

    showSignedOut('login');
    setMessage(byId('login-message'), 'Your session could not be confirmed. Please sign in again.');
    return;
  }

  const account = accountResult?.data || null;
  if (!account) {
    const suggestedUsername = normalizeUsername(user.user_metadata?.username || '');
    const suggestedName = String(user.user_metadata?.full_name || suggestedUsername).trim();
    byId('onboarding-username').value = suggestedUsername;
    byId('onboarding-name').value = suggestedName;
    setMessage(byId('onboarding-message'), '', '');
    showAuthPanel('onboarding');
    return;
  }

  let socialResult;
  try {
    socialResult = await resilientRead(() => supabase
      .from('social_profiles')
      .select('id, username, display_name, bio, avatar_key, updated_at, location, website_url, is_discoverable, is_verified, verification_badge_type, followers_count, following_count')
      .eq('id', user.id)
      .maybeSingle(), { timeoutMs: MEMBER_BOOT_TIMEOUT_MS });
  } catch {
    const fallback = memberFallbackProfile(user, account);
    if (fallback) {
      renderMember(fallback, user.id);
      refreshMemberProfileAfterFallback(user);
      void loadDeletionRequestState();
      await applyLocationRoute();
      return;
    }

    const cachedSession = cachedAuthSession();
    if (cachedSession?.user?.id === user.id) {
      window.setTimeout(() => {
        if (!currentMember && memberLoadUserId !== user.id) void loadMember(user);
      }, MEMBER_REFRESH_DELAY_MS);
      return;
    }

    showSignedOut('login');
    setMessage(byId('login-message'), 'Your session could not be confirmed. Please sign in again.');
    return;
  }

  const social = socialResult?.data || null;
  if (!social) {
    const fallback = memberFallbackProfile(user, account);
    if (fallback) {
      renderMember(fallback, user.id);
      refreshMemberProfileAfterFallback(user);
      void loadDeletionRequestState();
      await applyLocationRoute();
      return;
    }
    showAuthPanel('onboarding');
    return;
  }

  const hydratedMember = { ...account, ...social };
  cacheMemberProfile(hydratedMember, user.id);
  renderMember(hydratedMember, user.id);
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

  const streamBlockPattern = /async function loadStream\(\{ reset = false \} = \{\}\) \{[\s\S]*?\n\}\n\nfunction sautiCardsForPost/;
  if (!streamBlockPattern.test(output)) {
    throw new Error('Could not find the SautiLink Home feed loader.');
  }

  const resilientStreamBlock = `async function loadStream({ reset = false } = {}) {
  if (!currentMember || streamLoading) return;
  streamLoading = true;
  const requestId = ++streamRequest;
  const loading = byId('stream-loading');
  const error = byId('stream-error');
  const loadMore = byId('stream-load-more');
  const feed = byId('stream-feed');
  const hadRenderedFeed = feed.childElementCount > 0;

  if (reset) {
    streamCursor = null;
    if (!hadRenderedFeed) {
      clearHomeFeedMediaState();
      feed.replaceChildren();
      byId('stream-empty').hidden = true;
      byId('stream-welcome').hidden = false;
    }
  }

  error.hidden = true;
  loading.hidden = !reset;
  loadMore.disabled = true;

  try {
    const streamResult = await resilientRead(() => {
      let query = supabase
        .from('social_stream_events')
        .select('event_type, post_id, actor_id, event_at, event_key')
        .order('event_at', { ascending: false })
        .order('event_key', { ascending: false })
        .limit(STREAM_PAGE_SIZE + 1);

      if (streamCursor) {
        query = query.or(
          'event_at.lt.' + streamCursor.createdAt
          + ',and(event_at.eq.' + streamCursor.createdAt
          + ',event_key.lt.' + streamCursor.id + ')'
        );
      }
      return query;
    }, { attempts: READ_RETRY_ATTEMPTS, timeoutMs: READ_RETRY_TIMEOUT_MS });

    if (requestId !== streamRequest) return;

    const rows = Array.isArray(streamResult?.data) ? streamResult.data : [];
    streamHasMore = rows.length > STREAM_PAGE_SIZE;
    const page = rows.slice(0, STREAM_PAGE_SIZE);
    const last = page[page.length - 1];
    if (last) streamCursor = { createdAt: last.event_at, id: last.event_key };

    const hydrated = await resilientRead(
      () => hydrateStreamEvents(page),
      { attempts: READ_RETRY_ATTEMPTS, timeoutMs: READ_RETRY_TIMEOUT_MS + 2000 },
    );
    if (requestId !== streamRequest) return;
    renderStreamRows(hydrated, { reset });
  } catch {
    if (requestId !== streamRequest) return;

    // Never blank a feed the member was already reading because a background
    // refresh had a transient failure. Only show the blocking error if this
    // page genuinely has no usable feed yet.
    if (hadRenderedFeed) {
      error.hidden = true;
      byId('stream-more').hidden = !streamHasMore;
    } else {
      feed.replaceChildren();
      error.hidden = false;
      byId('stream-more').hidden = true;
    }
  } finally {
    if (requestId === streamRequest) {
      streamLoading = false;
      loading.hidden = true;
      loadMore.disabled = false;
    }
  }
}

function sautiCardsForPost`;

  output = output.replace(streamBlockPattern, resilientStreamBlock);

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
