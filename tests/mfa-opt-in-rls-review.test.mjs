import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const path = new URL('../docs/security/mfa-opt-in-rls-review.md', import.meta.url);
const read = () => readFile(path, 'utf8');

test('SautiLink opt-in MFA RLS proposal remains review-only, not production migration', async () => {
  const plan = await read();
  assert.match(plan, /NOT applied to production/);
  assert.match(plan, /outside .*supabase\/migrations/);
  assert.match(plan, /test project/);
  assert.match(plan, /Android/i);
  assert.match(plan, /rollback/i);
});

test('all MFA private-data policies must be restrictive, factor-aware and reversible', async () => {
  const plan = await read();
  const createStatements = [...plan.matchAll(/CREATE POLICY ([a-z0-9_]+)\s+ON public\.([a-z0-9_]+) AS RESTRICTIVE FOR (SELECT|UPDATE|INSERT) TO authenticated([\s\S]*?);/g)];
  assert.equal(createStatements.length, 9, 'review should cover exactly 9 narrow private-data policies');
  for (const [, policyName, table, command, body] of createStatements) {
    assert.match(body, /auth\.jwt\(\)->>'aal'/, policyName + ' must verify AAL');
    assert.match(body, /FROM auth\.mfa_factors/, policyName + ' must be opt-in by enrollment');
    assert.match(body, /status = 'verified'/, policyName + ' must not count unverified factors');
    assert.match(body, /auth\.uid\(\)/, policyName + ' must check own factor');
    if (command === 'UPDATE') assert.match(body, /WITH CHECK/, policyName + ' must protect updates');
    assert.match(plan, new RegExp('DROP POLICY IF EXISTS ' + policyName + ' ON public\\.' + table), policyName + ' must have rollback');
  }
  assert.doesNotMatch(plan, /CREATE POLICY .* ON public\.social_profiles AS RESTRICTIVE FOR SELECT/);
  assert.doesNotMatch(plan, /CREATE POLICY .* ON public\.social_posts AS RESTRICTIVE FOR SELECT/);
});

test('private-data RLS proposal explicitly requires validation of privileged API bypasses', async () => {
  const plan = await read();
  assert.match(plan, /service_role/);
  assert.match(plan, /Cloudflare Workers/);
  assert.match(plan, /permission denied for schema auth/);
  assert.match(plan, /do not run on production/i);
});
