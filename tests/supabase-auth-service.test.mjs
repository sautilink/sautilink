import assert from 'node:assert/strict';
import test from 'node:test';

import { createSautiLinkBrowserClient, createSupabaseAuthService } from '../src/supabase-auth-service.js';

function createMockClient() {
  const calls = [];
  const rows = {
    account_profiles: { id: 'member-1', username: 'charles.x', full_name: 'Charles Alex' },
    social_profiles: {
      id: 'member-1',
      username: 'charles.x',
      display_name: 'Charles Alex',
      bio: 'Building SautiLink.',
      location: 'Tanzania',
      is_discoverable: true,
      created_at: '2026-08-24T00:00:00.000Z',
    },
  };

  const client = {
    calls,
    auth: {
      async getSession() { calls.push(['getSession']); return { data: { session: { access_token: 'preview' } }, error: null }; },
      async getUser() { calls.push(['getUser']); return { data: { user: { id: 'member-1', user_metadata: {} } }, error: null }; },
      async signInWithPassword(payload) { calls.push(['signInWithPassword', payload]); return { data: { user: { id: 'member-1', user_metadata: {} } }, error: null }; },
      async signUp(payload) { calls.push(['signUp', payload]); return { data: { user: { id: 'member-1', identities: [{}] }, session: null }, error: null }; },
      async verifyOtp(payload) { calls.push(['verifyOtp', payload]); return { data: { user: { id: 'member-1' } }, error: null }; },
      async resend(payload) { calls.push(['resend', payload]); return { error: null }; },
      async resetPasswordForEmail(email, options) { calls.push(['resetPasswordForEmail', email, options]); return { error: null }; },
      async updateUser(payload) { calls.push(['updateUser', payload]); return { data: { user: { id: 'member-1', user_metadata: {} } }, error: null }; },
      async signOut() { calls.push(['signOut']); return { error: null }; },
      onAuthStateChange(handler) {
        calls.push(['onAuthStateChange']);
        handler('SIGNED_OUT', null);
        return { data: { subscription: { unsubscribe() { calls.push(['unsubscribe']); } } } };
      },
    },
    from(table) {
      calls.push(['from', table]);
      const builder = {
        select(columns) { calls.push(['select', table, columns]); return builder; },
        eq(column, value) { calls.push(['eq', table, column, value]); return builder; },
        async maybeSingle() { return { data: rows[table], error: null }; },
      };
      return builder;
    },
    async rpc(name, payload) {
      calls.push(['rpc', name, payload]);
      return { data: rows.social_profiles, error: null };
    },
  };

  return client;
}

test('browser client rejects unsafe configuration and accepts a publishable key', () => {
  assert.throws(() => createSautiLinkBrowserClient({ url: 'http://example.com', publishableKey: 'secret' }), /valid hosted Supabase/);
  const client = createSautiLinkBrowserClient({
    url: 'https://example-project.supabase.co',
    publishableKey: 'sb_publishable_preview-only-value',
  });
  assert.equal(typeof client.auth.signInWithPassword, 'function');
});

test('auth service bootstraps a verified member through owner-scoped profile reads', async () => {
  const client = createMockClient();
  const service = createSupabaseAuthService({ client, usernameEndpoint: 'https://example.test/username', redirectUrl: 'https://example.test/app/' });
  const result = await service.bootstrap();
  assert.equal(result.status, 'member');
  assert.equal(result.member.handle, '@charles.x');
  assert.ok(client.calls.some((call) => call[0] === 'getUser'));
  assert.ok(client.calls.some((call) => call[0] === 'from' && call[1] === 'account_profiles'));
  assert.ok(client.calls.some((call) => call[0] === 'from' && call[1] === 'social_profiles'));
});

test('signup carries prefill metadata but onboarding remains an RPC boundary', async () => {
  const client = createMockClient();
  const service = createSupabaseAuthService({ client, usernameEndpoint: 'https://example.test/username', redirectUrl: 'https://example.test/app/' });
  const signup = await service.signUp({
    username: 'charles.x',
    displayName: 'Charles Alex',
    email: 'Charles@Example.com',
    password: 'Correct-Horse9!Battery',
  });
  assert.equal(signup.status, 'verification-required');
  assert.deepEqual(signup.pending, { username: 'charles.x', displayName: 'Charles Alex', email: 'charles@example.com' });
  const call = client.calls.find((entry) => entry[0] === 'signUp');
  assert.deepEqual(call[1].options.data, { username: 'charles.x', full_name: 'Charles Alex' });

  const verified = await service.verifySignup({ pending: signup.pending, code: '240826' });
  assert.equal(verified.member.handle, '@charles.x');
  assert.ok(client.calls.some((entry) => entry[0] === 'rpc' && entry[1] === 'complete_social_onboarding'));
});

test('onboarding accepts PostgREST composite rows returned as an array', async () => {
  const client = createMockClient();
  client.rpc = async (name, payload) => {
    client.calls.push(['rpc', name, payload]);
    return {
      data: [{
        id: 'member-1',
        username: 'charles.x',
        display_name: 'Charles Alex',
        is_discoverable: true,
        created_at: '2026-08-24T00:00:00.000Z',
      }],
      error: null,
    };
  };
  const service = createSupabaseAuthService({ client, usernameEndpoint: 'https://example.test/username', redirectUrl: 'https://example.test/app/' });
  const member = await service.completeOnboarding({ username: 'charles.x', displayName: 'Charles Alex' });
  assert.equal(member.handle, '@charles.x');
});

test('recovery uses the approved redirect and returns a generic browser-safe flow', async () => {
  const client = createMockClient();
  const service = createSupabaseAuthService({ client, usernameEndpoint: 'https://example.test/username', redirectUrl: 'https://example.test/app/' });
  await service.recover(' Member@Example.com ');
  assert.deepEqual(
    client.calls.find((entry) => entry[0] === 'resetPasswordForEmail').slice(1),
    ['member@example.com', { redirectTo: 'https://example.test/app/' }],
  );
});

test('username checks use the Worker contract and auth subscriptions clean up', async () => {
  const client = createMockClient();
  const fetchCalls = [];
  const service = createSupabaseAuthService({
    client,
    usernameEndpoint: 'https://example.test/username',
    redirectUrl: 'https://example.test/app/',
    fetchImpl: async (url, options) => {
      fetchCalls.push([url, options]);
      return { ok: true, async json() { return { ok: true, data: { available: true } }; } };
    },
  });
  const result = await service.checkUsername('@New.Member');
  assert.deepEqual(result, { username: 'new.member', available: true, issue: '' });
  assert.equal(JSON.parse(fetchCalls[0][1].body).action, 'check_username');

  let event = '';
  const unsubscribe = service.onAuthStateChange((next) => { event = next; });
  assert.equal(event, 'SIGNED_OUT');
  unsubscribe();
  assert.ok(client.calls.some((entry) => entry[0] === 'unsubscribe'));
});
