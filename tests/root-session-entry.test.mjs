import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/<script data-sautilink-session-entry>([\s\S]*?)<\/script>/i);

assert.ok(match, 'root entry must include the early persisted-session guard');
const guard = match[1];

function runGuard(storedValue, { throwOnRead = false } = {}) {
  const redirects = [];
  const context = {
    JSON,
    window: {
      localStorage: {
        getItem(key) {
          assert.equal(key, 'sautilink.auth.session');
          if (throwOnRead) throw new Error('storage unavailable');
          return storedValue;
        },
      },
      location: {
        replace(destination) {
          redirects.push(destination);
        },
      },
    },
  };
  vm.runInNewContext(guard, context);
  return redirects;
}

test('root session guard runs before the signed-out account choice can paint', () => {
  const guardIndex = html.indexOf('<script data-sautilink-session-entry>');
  const titleIndex = html.indexOf('<title>');
  const bodyIndex = html.indexOf('<body');
  assert.ok(guardIndex > -1);
  assert.ok(guardIndex < titleIndex);
  assert.ok(guardIndex < bodyIndex);
});

test('root redirects a directly persisted valid-looking session to Home', () => {
  const stored = JSON.stringify({ access_token: 'access-token', user: { id: 'member-id' } });
  assert.deepEqual(runGuard(stored), ['/home']);
});

test('root redirects the wrapped persisted session shape used by the existing guest gate', () => {
  const stored = JSON.stringify({ currentSession: { access_token: 'access-token', user: { id: 'member-id' } } });
  assert.deepEqual(runGuard(stored), ['/home']);
});

test('root keeps signed-out, malformed and unavailable storage on the account-choice page', () => {
  assert.deepEqual(runGuard(null), []);
  assert.deepEqual(runGuard('{not-json'), []);
  assert.deepEqual(runGuard(null, { throwOnRead: true }), []);
  assert.match(html, /href="\/login"/);
  assert.match(html, /href="\/signup"/);
  assert.match(html, /Continue to SautiLink/);
});

test('root redirect is routing only and does not bypass normal Home authentication', () => {
  assert.match(guard, /window\.location\.replace\('\/home'\)/);
  assert.doesNotMatch(guard, /fetch\(|supabase|authorization|service[_-]?role/i);
});
