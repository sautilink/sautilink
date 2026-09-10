import assert from 'node:assert/strict';
import test from 'node:test';

import assetRouter from '../src/asset-router.js';

const shell = `<!DOCTYPE html>
<html lang="en">
<body>
<section class="loading-view" id="loading-view" aria-live="polite"><p>Opening SautiLink…</p></section>
<section class="auth-view" id="auth-view" hidden>
<div class="auth-tabs" id="auth-tabs" role="tablist" aria-label="Account access">
<button type="button" role="tab" aria-selected="true" aria-controls="login-panel" id="login-tab" data-auth-mode="login">Sign in</button>
<button type="button" role="tab" aria-selected="false" aria-controls="signup-panel" id="signup-tab" data-auth-mode="signup">Create account</button>
</div>
<section id="login-panel" role="tabpanel" aria-labelledby="login-tab"><form id="login-form"></form></section>
<section id="signup-panel" role="tabpanel" aria-labelledby="signup-tab" hidden><form id="signup-form"></form></section>
</section>
</body>
</html>`;

function envWithShell() {
  return {
    ASSETS: {
      async fetch() {
        return new Response(shell, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            ETag: 'test-shell',
          },
        });
      },
    },
  };
}

async function fetchPath(pathname) {
  return assetRouter.fetch(
    new Request(`https://sautilink.com${pathname}`, {
      headers: { 'X-Request-ID': 'auth-shell-test-1234' },
    }),
    envWithShell(),
  );
}

test('/login is served with auth UI visible before app bootstrap runs', async () => {
  const response = await fetchPath('/login');
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('ETag'), null);
  assert.match(html, /<body class="auth-entry" data-auth-mode="login" data-sautilink-auth-entry="login">/);
  assert.match(html, /id="loading-view" aria-live="polite" hidden/);
  assert.match(html, /<section class="auth-view" id="auth-view">/);
  assert.match(html, /<section id="login-panel" role="tabpanel" aria-labelledby="login-tab">/);
  assert.match(html, /<section id="signup-panel" role="tabpanel" aria-labelledby="signup-tab" hidden>/);
});

test('/signup is served with signup UI selected before app bootstrap runs', async () => {
  const response = await fetchPath('/signup');
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<body class="auth-entry" data-auth-mode="signup" data-sautilink-auth-entry="signup">/);
  assert.match(html, /aria-selected="false" aria-controls="login-panel" id="login-tab"/);
  assert.match(html, /aria-selected="true" aria-controls="signup-panel" id="signup-tab"/);
  assert.match(html, /<section id="login-panel" role="tabpanel" aria-labelledby="login-tab" hidden>/);
  assert.match(html, /<section id="signup-panel" role="tabpanel" aria-labelledby="signup-tab">/);
});

test('/home keeps the normal member shell unchanged', async () => {
  const response = await fetchPath('/home');
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /data-sautilink-auth-entry/);
  assert.match(html, /<section class="loading-view" id="loading-view" aria-live="polite">/);
  assert.match(html, /<section class="auth-view" id="auth-view" hidden>/);
});
