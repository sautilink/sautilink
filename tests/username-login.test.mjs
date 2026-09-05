import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('login bridge keeps email flow and adds username support', async () => {
  const source = await read('src/username-login.js');
  for (const term of [
    "placeholder = 'Email or username'",
    "autocomplete = 'username'",
    'looksLikeLoginEmail(identifier)',
    "replace(/^@+/",
    'sautilink-username-login',
    'auth.setSession',
    "consumeGuestReturnTarget() || '/home'",
    'Incorrect email/username or password.',
  ]) assert.match(source, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(source, /import \{ consumeGuestReturnTarget \} from '\.\/guest-entry-gate\.js'/);
  assert.match(source, /if \(looksLikeLoginEmail\(identifier\)\) return;/);
  assert.match(source, /addEventListener\('submit', handleUsernameSubmit, true\)/);
  assert.doesNotMatch(source, /service_role|SUPABASE_SECRET_KEYS|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('username login Edge Function resolves account server-side without exposing email', async () => {
  const source = await read('supabase/functions/sautilink-username-login/index.ts');

  for (const term of [
    "from('account_profiles')",
    ".eq('username', username)",
    'auth.admin.getUserById',
    'auth.signInWithPassword',
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_PUBLISHABLE_KEYS',
    "code: 'INVALID_CREDENTIALS'",
    "'Cache-Control': 'no-store, max-age=0'",
  ]) assert.match(source, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(source, /session:\s*\{\s*access_token:/s);
  assert.doesNotMatch(source, /session:[\s\S]*email:/i);
  assert.doesNotMatch(source, /console\.(log|error)|JSON\.stringify\([^\n]*password/i);
});

test('app and production builds inject the username login bridge', async () => {
  const packageJson = await read('package.json');
  const production = await read('scripts/build-production-release.mjs');
  assert.match(packageJson, /--inject:\.\/src\/username-login\.js/);
  assert.match(production, /resolve\(workerSource, 'username-login\.js'\)/);
});
