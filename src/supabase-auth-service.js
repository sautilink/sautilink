import { createClient } from '@supabase/supabase-js';
import {
  displayNameError,
  emailError,
  normalizeEmail,
  normalizeUsername,
  passwordError,
  usernameError,
} from './auth-validation.js';

const DEFAULT_STORAGE_KEY = 'sautilink.auth.session';

function configurationError(message) {
  return Object.assign(new Error(message), { code: 'SAUTILINK_AUTH_CONFIGURATION' });
}

export function createSautiLinkBrowserClient({ url, publishableKey, storageKey = DEFAULT_STORAGE_KEY }) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(url || ''))) {
    throw configurationError('A valid hosted Supabase project URL is required.');
  }
  if (!String(publishableKey || '').startsWith('sb_publishable_')) {
    throw configurationError('A Supabase publishable key is required.');
  }

  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey,
    },
  });
}

function memberFromRows(account, social) {
  const name = social.display_name || account.full_name || social.username;
  const createdAt = social.created_at ? new Date(social.created_at) : null;
  const joined = createdAt && !Number.isNaN(createdAt.valueOf())
    ? `Joined ${createdAt.toLocaleDateString('en', { month: 'long', year: 'numeric' })}`
    : 'SautiLink member';

  return {
    id: social.id,
    name,
    handle: `@${social.username}`,
    username: social.username,
    initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'S',
    bio: social.bio || 'Building meaningful connections on SautiLink.',
    location: social.location || 'East Africa',
    joined,
    following: 0,
    followers: 0,
    discoverable: Boolean(social.is_discoverable),
  };
}

export function createSupabaseAuthService({ client, usernameEndpoint, redirectUrl, fetchImpl = globalThis.fetch }) {
  if (!client?.auth || typeof client.from !== 'function' || typeof client.rpc !== 'function') {
    throw configurationError('A Supabase client is required.');
  }

  const loadMember = async (user) => {
    const { data: account, error: accountError } = await client
      .from('account_profiles')
      .select('id, username, full_name')
      .eq('id', user.id)
      .maybeSingle();
    if (accountError) throw accountError;

    if (!account) {
      const username = normalizeUsername(user.user_metadata?.username || '');
      const displayName = String(user.user_metadata?.full_name || username).trim();
      return { status: 'onboarding', user, suggested: { username, displayName } };
    }

    const { data: social, error: socialError } = await client
      .from('social_profiles')
      .select('id, username, display_name, bio, location, is_discoverable, created_at')
      .eq('id', user.id)
      .maybeSingle();
    if (socialError) throw socialError;
    if (!social) throw Object.assign(new Error('SOCIAL_PROFILE_UNAVAILABLE'), { code: 'SOCIAL_PROFILE_UNAVAILABLE' });

    return { status: 'member', user, member: memberFromRows(account, social) };
  };

  const completeOnboarding = async ({ username, displayName }) => {
    const cleanUsername = normalizeUsername(username);
    const cleanDisplayName = String(displayName || '').trim();
    const usernameIssue = usernameError(cleanUsername);
    const nameIssue = displayNameError(cleanDisplayName);
    if (usernameIssue || nameIssue) throw Object.assign(new Error(usernameIssue || nameIssue), { code: 'VALIDATION_ERROR' });

    const { data, error } = await client.rpc('complete_social_onboarding', {
      p_username: cleanUsername,
      p_display_name: cleanDisplayName,
    });
    if (error) throw error;
    const profile = Array.isArray(data) ? data[0] : data;
    if (!profile) throw Object.assign(new Error('SOCIAL_PROFILE_UNAVAILABLE'), { code: 'SOCIAL_PROFILE_UNAVAILABLE' });
    return memberFromRows(
      { full_name: cleanDisplayName },
      { ...profile, display_name: profile.display_name || cleanDisplayName },
    );
  };

  return {
    async bootstrap() {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) return { status: 'signed-out' };

      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) return { status: 'signed-out' };
      return loadMember(userData.user);
    },

    async signIn({ email, password }) {
      const cleanEmail = normalizeEmail(email);
      const issue = emailError(cleanEmail);
      if (issue || !password) throw Object.assign(new Error(issue || 'Enter your password.'), { code: 'VALIDATION_ERROR' });
      const { data, error } = await client.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) throw error;
      return loadMember(data.user);
    },

    async signUp({ username, displayName, email, password }) {
      const cleanUsername = normalizeUsername(username);
      const cleanDisplayName = String(displayName || '').trim();
      const cleanEmail = normalizeEmail(email);
      const issue = usernameError(cleanUsername)
        || displayNameError(cleanDisplayName)
        || emailError(cleanEmail)
        || passwordError(password, { username: cleanUsername, email: cleanEmail });
      if (issue) throw Object.assign(new Error(issue), { code: 'VALIDATION_ERROR' });

      const { data, error } = await client.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { username: cleanUsername, full_name: cleanDisplayName } },
      });
      if (error) throw error;
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw Object.assign(new Error('already registered'), { code: 'user_already_exists' });
      }

      if (data.session) {
        return { status: 'member', user: data.user, member: await completeOnboarding({ username: cleanUsername, displayName: cleanDisplayName }) };
      }
      return {
        status: 'verification-required',
        pending: { email: cleanEmail, username: cleanUsername, displayName: cleanDisplayName },
      };
    },

    async verifySignup({ pending, code }) {
      const token = String(code || '').replace(/\D/g, '');
      if (!pending?.email || token.length < 6 || token.length > 10) {
        throw Object.assign(new Error('Enter the complete verification code.'), { code: 'VALIDATION_ERROR' });
      }
      const { data, error } = await client.auth.verifyOtp({ email: pending.email, token, type: 'email' });
      if (error) throw error;
      return {
        status: 'member',
        user: data.user,
        member: await completeOnboarding({ username: pending.username, displayName: pending.displayName }),
      };
    },

    async resendSignup(email) {
      const cleanEmail = normalizeEmail(email);
      if (emailError(cleanEmail)) throw Object.assign(new Error('Enter a valid email address.'), { code: 'VALIDATION_ERROR' });
      const { error } = await client.auth.resend({ type: 'signup', email: cleanEmail });
      if (error) throw error;
    },

    async recover(email) {
      const cleanEmail = normalizeEmail(email);
      const issue = emailError(cleanEmail);
      if (issue) throw Object.assign(new Error(issue), { code: 'VALIDATION_ERROR' });
      if (!redirectUrl) throw configurationError('A recovery redirect URL is required.');
      const { error } = await client.auth.resetPasswordForEmail(cleanEmail, { redirectTo: redirectUrl });
      if (error) throw error;
    },

    async updatePassword(password) {
      const issue = passwordError(password);
      if (issue) throw Object.assign(new Error(issue), { code: 'VALIDATION_ERROR' });
      const { data, error } = await client.auth.updateUser({ password });
      if (error) throw error;
      return loadMember(data.user);
    },

    completeOnboarding,
    loadMember,

    async checkUsername(value, { signal } = {}) {
      const username = normalizeUsername(value);
      const issue = usernameError(username);
      if (issue) return { username, available: false, issue };
      if (!usernameEndpoint || typeof fetchImpl !== 'function') throw configurationError('A username availability endpoint is required.');

      const response = await fetchImpl(usernameEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'check_username', username }),
        signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || 'Availability check failed.');
      return { username, available: Boolean(payload?.data?.available), issue: '' };
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },

    onAuthStateChange(handler) {
      const { data } = client.auth.onAuthStateChange((event, session) => handler(event, session));
      return () => data.subscription.unsubscribe();
    },
  };
}
