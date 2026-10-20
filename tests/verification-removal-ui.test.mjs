import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformVerificationCaseFlowSource } from '../scripts/verification-case-flow-source-transform.mjs';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const production = transformVerificationCaseFlowSource('src/app.js', source);

function feature(name, text = production) {
  const start = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(text)?.index;
  assert.notEqual(start, undefined, name);
  const end = text.indexOf('\n}', start);
  assert.ok(end > start, name);
  return text.slice(start, end + 2);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness({ verified = true, caseItem = null } = {}) {
  const nodes = new Map();
  const calls = { confirm: [], api: [], messages: [], events: [], visuals: 0, identity: 0, refresh: [], badges: 0 };
  const classes = new Set();
  const node = id => {
    if (!nodes.has(id)) {
      const attributes = new Map();
      const toggles = new Map();
      nodes.set(id, {
        hidden: false, disabled: false, textContent: '',
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: name => attributes.get(name),
        removeAttribute: name => attributes.delete(name),
        classList: { toggle: (name, active) => toggles.set(name, active), contains: name => Boolean(toggles.get(name)) },
      });
    }
    return nodes.get(id);
  };
  const currentMember = { id: 'member-a', username: 'amina', display_name: 'Amina', is_verified: verified, verification_badge_type: 'team', bio: 'Kept bio' };
  const result = {
    status: 'removed', user_id: 'member-a', username_unlocked: true,
    profile: { id: 'member-a', username: 'amina', display_name: 'Amina', is_verified: false, verification_badge_type: 'standard' },
  };
  const context = {
    currentMember, currentMemberId: 'member-a', verificationRemovalAction: null,
    verificationRemovalEpoch: 0, identityControlsRequest: 0, verificationCaseRequest: 0,
    currentVerificationCase: caseItem,
    memberView: { hidden: false }, settingsSurface: { hidden: false },
    streamSurface: { hidden: true }, notificationsSurface: { hidden: true }, discoverSurface: { hidden: true },
    savedSurface: { hidden: true }, conversationSurface: { hidden: true }, circlesSurface: { hidden: true },
    activeSautiConversation: null, activeCircle: null,
    document: { body: { classList: { contains: name => classes.has(name) } }, dispatchEvent: event => calls.events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    byId: node,
    window: { SautiMemberDialogs: { confirm: async (...args) => { calls.confirm.push(args); return false; } } },
    crypto: { randomUUID: () => '89ed83c9-e7f3-4070-874a-c30f252d2a9f' },
    settingsApiRequest: async (...args) => { calls.api.push(args); return result; },
    settingsMessage: (...args) => calls.messages.push(args),
    applyVerificationBadgeAsset: () => { calls.badges++; },
    configureProfileVerificationBadge: () => { calls.badges++; },
    syncMemberIdentityVisuals: () => { calls.visuals++; },
    loadIdentityControls: async () => { calls.identity++; },
    loadVerificationCaseStatus: async () => null,
    loadStream: async (...args) => calls.refresh.push(['stream', ...args]),
    loadNotifications: async (...args) => calls.refresh.push(['notifications', ...args]),
    loadDiscover: async (...args) => calls.refresh.push(['discover', ...args]),
    loadSavedSauti: async (...args) => calls.refresh.push(['saved', ...args]),
    loadConversation: async (...args) => calls.refresh.push(['conversation', ...args]),
    loadCircleStream: async (...args) => calls.refresh.push(['circle', ...args]),
  };
  const helpers = [
    'syncVerificationRemovalControl', 'resetVerificationRemovalControl', 'refreshVerificationRemovalSurfaces',
    'normalizedVerificationCase', 'verificationReapplyLocked', 'verificationReapplyDate', 'identityDate',
    'verificationCaseStatusCopy', 'verificationCaseNote', 'renderVerificationCaseStatus',
    'syncVerificationRequestStatus', 'removeOwnVerification',
  ].map(name => feature(name)).join('\n');
  runInNewContext(`${helpers}\nthis.run = removeOwnVerification; this.sync = syncVerificationRemovalControl; this.reset = resetVerificationRemovalControl; this.status = renderVerificationCaseStatus; this.refresh = refreshVerificationRemovalSurfaces;`, context);
  return { context, calls, node, classes, result };
}

test('removal controls are hidden in initial markup and only actual owner checkmarks reveal them', () => {
  assert.match(html, /id="settings-verification-removal" hidden/);
  assert.match(html, /id="settings-verification-remove"[^>]*aria-describedby="settings-verification-removal-note"/);
  for (const verified of [false, undefined, null, 'true', 1]) {
    const h = harness({ verified });
    h.context.currentMember.is_verified = verified;
    h.context.sync(h.context.currentMember);
    assert.equal(h.node('settings-verification-removal').hidden, true, String(verified));
  }
  const h = harness();
  h.context.sync(h.context.currentMember);
  assert.equal(h.node('settings-verification-removal').hidden, false);
  assert.equal(h.node('settings-verification-remove').disabled, false);
  h.context.sync({ ...h.context.currentMember, id: 'another-user' });
  assert.equal(h.node('settings-verification-removal').hidden, true);
  h.context.sync(h.context.currentMember, { loading: true });
  assert.equal(h.node('settings-verification-removal').hidden, true);
  h.context.memberView.hidden = true;
  h.context.sync(h.context.currentMember);
  assert.equal(h.node('settings-verification-removal').hidden, true);
  h.context.memberView.hidden = false;
  h.classes.add('auth-entry');
  h.context.sync(h.context.currentMember);
  assert.equal(h.node('settings-verification-removal').hidden, true);
});

test('production status never grants removal for pending or historical approved applications without a badge', () => {
  for (const status of ['submitted', 'reviewing', 'action_required', 'approved', 'withdrawn']) {
    const h = harness({ verified: false, caseItem: { status } });
    h.context.status(h.context.currentMember);
    assert.equal(h.node('settings-verification-removal').hidden, true, status);
    assert.equal(h.node('settings-verification-badge').hidden, true, status);
    if (status === 'approved' || status === 'withdrawn') {
      assert.equal(h.node('settings-verification-request').hidden, false);
      assert.equal(h.node('settings-verification-request').disabled, false);
      assert.equal(h.node('settings-verification-status').textContent, 'Unverified');
    }
  }
  const h = harness();
  h.context.status(h.context.currentMember);
  assert.equal(h.node('settings-verification-removal').hidden, false);
  assert.equal(h.node('settings-verification-request').hidden, true);
});

test('confirmation explains the full reapplication review, and cancelling or repeated clicks make no request', async () => {
  const h = harness();
  const answer = deferred();
  h.context.window.SautiMemberDialogs.confirm = (...args) => { h.calls.confirm.push(args); return answer.promise; };
  const pending = h.context.run();
  assert.equal(h.node('settings-verification-remove').disabled, true);
  await h.context.run();
  assert.equal(h.calls.confirm.length, 1);
  assert.equal(h.calls.api.length, 0);
  const [message, options] = h.calls.confirm[0];
  assert.match(message, /submit a new application and complete every verification step again/);
  assert.match(message, /Being verified before does not guarantee approval/);
  assert.match(message, /normal change limits/);
  assert.equal(options.cancelLabel, 'Keep verification');
  assert.equal(options.confirmLabel, 'Remove verification');
  assert.equal(options.tone, 'destructive');
  answer.resolve(false);
  await pending;
  assert.equal(h.calls.api.length, 0);
  assert.equal(h.context.currentMember.is_verified, true);
  assert.equal(h.node('settings-verification-remove').disabled, false);
});

test('unverified and signed-out members cannot invoke the action directly', async () => {
  for (const mode of ['unverified', 'signedout', 'auth', 'another-profile', 'outside-settings']) {
    const h = harness();
    if (mode === 'unverified') h.context.currentMember.is_verified = false;
    if (mode === 'signedout') h.context.currentMemberId = '';
    if (mode === 'auth') h.classes.add('auth-entry');
    if (mode === 'another-profile') h.context.currentMember.id = 'someone-else';
    if (mode === 'outside-settings') h.context.settingsSurface.hidden = true;
    await h.context.run();
    assert.equal(h.calls.confirm.length, 0, mode);
    assert.equal(h.calls.api.length, 0, mode);
  }
});

test('logout, account change or navigation during confirmation prevents removal', async () => {
  for (const transition of ['logout', 'account', 'navigation', 'badge-removed']) {
    const h = harness();
    const answer = deferred();
    h.context.window.SautiMemberDialogs.confirm = () => answer.promise;
    const pending = h.context.run();
    if (transition === 'logout') {
      h.context.currentMember = null;
      h.context.currentMemberId = '';
      h.context.reset();
    }
    if (transition === 'account') h.context.currentMemberId = 'new-account';
    if (transition === 'navigation') h.context.settingsSurface.hidden = true;
    if (transition === 'badge-removed') h.context.currentMember.is_verified = false;
    answer.resolve(true);
    await pending;
    assert.equal(h.calls.api.length, 0, transition);
  }
  const h = harness();
  h.context.window.SautiMemberDialogs.confirm = async () => { throw { name: 'AbortError' }; };
  await h.context.run();
  assert.equal(h.calls.api.length, 0);
  assert.equal(h.calls.messages.length, 0);
});

test('failed requests and unconfirmed response data preserve the active checkmark', async () => {
  for (const failure of ['network', 'wrong-user', 'still-verified', 'not-unlocked', 'wrong-status']) {
    const h = harness();
    h.context.window.SautiMemberDialogs.confirm = async () => true;
    if (failure === 'network') h.context.settingsApiRequest = async () => { throw new Error('Connection interrupted.'); };
    if (failure === 'wrong-user') h.result.user_id = 'another-account';
    if (failure === 'still-verified') h.result.profile.is_verified = true;
    if (failure === 'not-unlocked') h.result.username_unlocked = false;
    if (failure === 'wrong-status') h.result.status = 'pending';
    await h.context.run();
    assert.equal(h.context.currentMember.is_verified, true, failure);
    assert.equal(h.calls.visuals, 0);
    assert.equal(h.calls.events.length, 0);
    assert.equal(h.calls.messages.at(-1)[1], 'error');
    assert.equal(h.node('settings-verification-remove').disabled, false);
    assert.equal(h.node('settings-verification-remove').getAttribute('aria-busy'), undefined);
  }
});

test('authoritative removal and idempotent retries refresh identity, reapplication and only the active surface', async () => {
  for (const status of ['removed', 'already_removed']) {
    const h = harness();
    h.result.status = status;
    const response = deferred();
    const requested = deferred();
    h.context.window.SautiMemberDialogs.confirm = async () => true;
    h.context.settingsApiRequest = (...args) => { h.calls.api.push(args); requested.resolve(); return response.promise; };
    const pending = h.context.run();
    await requested.promise;
    assert.equal(h.context.currentMember.is_verified, true, 'No optimistic badge removal');
    assert.equal(h.node('settings-verification-remove').getAttribute('aria-busy'), 'true');
    await h.context.run();
    assert.equal(h.calls.api.length, 1, 'Double submission is blocked while the request is pending');
    h.context.settingsSurface.hidden = true;
    h.context.streamSurface.hidden = false;
    response.resolve(h.result);
    await pending;
    assert.equal(h.calls.api[0][0], '/api/account/verification/remove');
    assert.equal(h.calls.api[0][1].method, 'POST');
    assert.equal(h.calls.api[0][1].body.confirmation, 'remove-verification-v1');
    assert.match(h.calls.api[0][1].body.request_id, /^[0-9a-f-]{36}$/);
    assert.equal(h.context.currentMember.is_verified, false);
    assert.equal(h.context.currentMember.verification_badge_type, 'standard');
    assert.equal(h.context.currentMember.bio, 'Kept bio');
    assert.equal(h.node('settings-verification-removal').hidden, true);
    assert.equal(h.node('settings-verification-request').hidden, false);
    assert.equal(h.calls.events.length, 1);
    assert.equal(h.calls.events[0].type, 'sautilink:verification-removed');
    assert.equal(h.calls.events[0].detail.userId, 'member-a');
    assert.equal(h.calls.identity, 1);
    assert.equal(h.calls.visuals, 1);
    assert.equal(h.calls.refresh.length, 1);
    assert.equal(h.calls.refresh[0][0], 'stream');
    assert.equal(h.calls.messages.at(-1)[1], 'success');
  }
});

test('a late successful response after logout never changes another member or re-enables old controls', async () => {
  const h = harness();
  const response = deferred();
  const requested = deferred();
  h.context.window.SautiMemberDialogs.confirm = async () => true;
  h.context.settingsApiRequest = () => { requested.resolve(); return response.promise; };
  const pending = h.context.run();
  await requested.promise;
  h.context.currentMember = null;
  h.context.currentMemberId = '';
  h.context.reset();
  const nextMember = { id: 'member-b', username: 'neema', is_verified: true };
  h.context.currentMember = nextMember;
  h.context.currentMemberId = 'member-b';
  response.resolve(h.result);
  await pending;
  assert.equal(h.context.currentMember, nextMember);
  assert.equal(h.context.currentMember.is_verified, true);
  assert.equal(h.calls.events.length, 0);
  assert.equal(h.calls.identity, 0);
  assert.equal(h.calls.messages.length, 0);
  assert.equal(h.node('settings-verification-removal').hidden, true);
});

test('post-removal identity visuals preserve another member profile that is currently open', () => {
  for (const ownProfile of [false, true]) {
    const h = harness();
    const renders = [];
    Object.assign(h.context, {
      profileSurface: { hidden: false }, renderedProfileOwner: ownProfile,
      renderedProfileId: ownProfile ? 'member-a' : 'member-b',
      setInlineVerifiedName: () => {}, renderProfileAvatar: () => {},
      renderProfile: (...args) => renders.push(args),
    });
    runInNewContext(`${feature('syncMemberIdentityVisuals')}\nsyncMemberIdentityVisuals();`, h.context);
    assert.equal(renders.length, Number(ownProfile));
  }
});

test('identity reload cannot apply the previous account after the session changes', async () => {
  const h = harness();
  const response = deferred();
  h.context.settingsApiRequest = () => response.promise;
  runInNewContext(`${feature('loadIdentityControls')}\nthis.reloadIdentity = loadIdentityControls;`, h.context);
  const pending = h.context.reloadIdentity();
  const nextMember = { id: 'member-b', is_verified: true };
  h.context.currentMemberId = 'member-b';
  h.context.currentMember = nextMember;
  response.resolve({ profile: h.result.profile });
  assert.equal(await pending, null);
  assert.equal(h.context.currentMember, nextMember);
  assert.equal(h.calls.visuals, 0);
});

test('an older identity response or error cannot restore a removed badge after the latest identity load', async () => {
  for (const failure of [false, true]) {
    const h = harness();
    const earlier = deferred();
    const newer = deferred();
    let count = 0;
    h.context.settingsApiRequest = () => ++count === 1 ? earlier.promise : newer.promise;
    runInNewContext(`${feature('loadIdentityControls')}\nthis.reloadIdentity = loadIdentityControls;`, h.context);
    const oldRequest = h.context.reloadIdentity();
    const latestRequest = h.context.reloadIdentity();
    newer.resolve({ profile: h.result.profile, display_name: { changes_remaining_14_days: 2 }, username: { changes_remaining_30_days: 1 } });
    await latestRequest;
    assert.equal(h.context.currentMember.is_verified, false);
    assert.equal(h.node('profile-identity-state').textContent, 'Standard');
    if (failure) earlier.reject(new Error('Outdated identity request failed.'));
    else earlier.resolve({ profile: { ...h.result.profile, is_verified: true, verification_badge_type: 'team' } });
    assert.equal(await oldRequest, null);
    assert.equal(h.context.currentMember.is_verified, false);
    assert.equal(h.node('profile-identity-state').textContent, 'Standard');
    assert.equal(h.calls.visuals, 1);
  }
});

test('confirmed removal invalidates an identity read that began before the checkmark was removed', async () => {
  const h = harness();
  const oldRead = deferred();
  const freshRead = deferred();
  let reads = 0;
  h.context.settingsApiRequest = async (path) => {
    if (path.endsWith('/remove')) return h.result;
    return ++reads === 1 ? oldRead.promise : freshRead.promise;
  };
  h.context.window.SautiMemberDialogs.confirm = async () => true;
  runInNewContext(`${feature('loadIdentityControls')}\nthis.reloadIdentity = loadIdentityControls;`, h.context);
  const oldRequest = h.context.reloadIdentity();
  const removal = h.context.run();
  // The confirmed action invalidates the old identity request before its fresh read.
  freshRead.resolve({ profile: h.result.profile, display_name: { changes_remaining_14_days: 2 }, username: { changes_remaining_30_days: 1 } });
  await removal;
  oldRead.resolve({ profile: { ...h.result.profile, is_verified: true, verification_badge_type: 'team' } });
  assert.equal(await oldRequest, null);
  assert.equal(h.context.currentMember.is_verified, false);
  assert.equal(h.node('profile-identity-state').textContent, 'Standard');
  assert.equal(h.node('settings-verification-removal').hidden, true);
});

test('late approved-case responses and profile refreshes cannot restore verification after removal', async () => {
  for (const stage of ['case', 'profile']) {
    const h = harness();
    const stale = deferred();
    const profileRequested = deferred();
    let caseReads = 0;
    let profileReads = 0;
    h.context.supabase = {
      rpc: async () => ++caseReads === 1
        ? stage === 'case' ? stale.promise : { data: { status: 'approved' }, error: null }
        : { data: null, error: null },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => { profileReads++; profileRequested.resolve(); return stale.promise; } }) }) }),
    };
    runInNewContext(`${feature('refreshVerifiedProfileFromCase')}\n${feature('loadVerificationCaseStatus')}\nthis.loadCase = loadVerificationCaseStatus;`, h.context);
    const oldCaseRequest = h.context.loadCase({ ...h.context.currentMember, is_verified: false });
    if (stage === 'profile') await profileRequested.promise;
    h.context.window.SautiMemberDialogs.confirm = async () => true;
    await h.context.run();
    assert.equal(h.context.currentMember.is_verified, false);
    stale.resolve(stage === 'case'
      ? { data: { status: 'approved', case_number: 'OLD-APPROVAL' }, error: null }
      : { data: { ...h.result.profile, is_verified: true, verification_badge_type: 'team' }, error: null });
    assert.equal(await oldCaseRequest, null);
    assert.equal(h.context.currentMember.is_verified, false);
    assert.equal(h.context.currentVerificationCase, null);
    assert.equal(h.node('settings-verification-status').textContent, 'Unverified');
    assert.equal(h.node('settings-verification-request').hidden, false);
    assert.equal(profileReads, stage === 'profile' ? 1 : 0, 'Stale case response cannot trigger a new profile merge');
  }
});
