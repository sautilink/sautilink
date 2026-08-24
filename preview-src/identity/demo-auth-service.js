import {
  displayNameError,
  emailError,
  normalizeEmail,
  normalizeUsername,
  passwordError,
  usernameError,
} from '../../src/auth-validation.js';

export const DEMO_CODE = '240826';

const wait = (duration = 260) => new Promise((resolve) => window.setTimeout(resolve, duration));

const memberFrom = ({ username = 'yourhandle', displayName = 'SautiLink Member' } = {}) => ({
  id: 'preview-member',
  name: displayName,
  handle: `@${username}`,
  username,
  initials: displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'SM',
  bio: 'Building meaningful connections on SautiLink.',
  location: 'East Africa',
  joined: 'Joined August 2026',
  following: 148,
  followers: 632,
  discoverable: true,
});

function validationFailure(message) {
  return Object.assign(new Error(message), { code: 'VALIDATION_ERROR' });
}

export function createDemoAuthService() {
  let member = null;

  return {
    async signIn({ email, password }) {
      await wait();
      const issue = emailError(email);
      if (issue) throw validationFailure(issue);
      if (!password) throw validationFailure('Enter your password.');
      member = memberFrom();
      return { status: 'member', member };
    },

    async signUp({ username, displayName, email, password }) {
      await wait();
      const cleanUsername = normalizeUsername(username);
      const cleanName = String(displayName || '').trim();
      const cleanEmail = normalizeEmail(email);
      const issue = usernameError(cleanUsername)
        || displayNameError(cleanName)
        || emailError(cleanEmail)
        || passwordError(password, { username: cleanUsername, email: cleanEmail });
      if (issue) throw validationFailure(issue);
      return {
        status: 'verification-required',
        pending: { username: cleanUsername, displayName: cleanName, email: cleanEmail },
      };
    },

    async verifySignup({ pending, code }) {
      await wait();
      if (String(code || '').replace(/\D/g, '') !== DEMO_CODE) {
        throw Object.assign(new Error('That preview code is invalid. Use 240826.'), { code: 'otp_expired' });
      }
      member = memberFrom(pending);
      return { status: 'member', member };
    },

    async resendSignup() {
      await wait(180);
    },

    async recover(email) {
      await wait();
      const issue = emailError(email);
      if (issue) throw validationFailure(issue);
    },

    async updatePassword(password) {
      await wait();
      const issue = passwordError(password);
      if (issue) throw validationFailure(issue);
      member = member || memberFrom();
      return { status: 'member', member };
    },

    async completeOnboarding({ username, displayName }) {
      await wait();
      const cleanUsername = normalizeUsername(username);
      const cleanName = String(displayName || '').trim();
      const issue = usernameError(cleanUsername) || displayNameError(cleanName);
      if (issue) throw validationFailure(issue);
      member = memberFrom({ username: cleanUsername, displayName: cleanName });
      return member;
    },

    async checkUsername(value) {
      await wait(180);
      const username = normalizeUsername(value);
      const issue = usernameError(username);
      return { username, available: !issue && username !== 'already.claimed', issue };
    },

    async signOut() {
      await wait(160);
      member = null;
    },
  };
}
