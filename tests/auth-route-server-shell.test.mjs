import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import assetRouter from '../src/asset-router.js';

const shell = `<!DOCTYPE html>
<html lang="en">
<body>
<section class="loading-view" id="loading-view" aria-live="polite"><p>Opening SautiLink…</p></section>
<section class="auth-view" id="auth-view" hidden>
<div class="auth-intro"><h2>Welcome back to SautiLink</h2><p>Sign in to continue to your account.</p></div>
<div class="auth-tabs" id="auth-tabs" role="tablist" aria-label="Account access">
<button type="button" role="tab" aria-selected="true" aria-controls="login-panel" id="login-tab" data-auth-mode="login">Login</button>
<button type="button" role="tab" aria-selected="false" aria-controls="signup-panel" id="signup-tab" data-auth-mode="signup">Register</button>
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
  assert.match(html, /<h2>Welcome back to SautiLink<\/h2><p>Sign in to continue to your account\.<\/p>/);
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
  assert.match(html, /<h2>Create your SautiLink account<\/h2><p>Join SautiLink and set up your account\.<\/p>/);
  assert.doesNotMatch(html, /Welcome back to SautiLink|Sign in to continue to your account/);
  assert.match(html, /<section id="login-panel" role="tabpanel" aria-labelledby="login-tab" hidden>/);
  assert.match(html, /<section id="signup-panel" role="tabpanel" aria-labelledby="signup-tab">/);
});

test('/home keeps the normal member shell unchanged', async () => {
  const response = await fetchPath('/home');
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /data-sautilink-auth-entry/);
  assert.match(html, /<body>/);
  assert.match(html, /<section class="loading-view" id="loading-view" aria-live="polite">/);
  assert.match(html, /<section class="auth-view" id="auth-view" hidden>/);
});

// The router's first-paint substitutions must also work against the real page.
// The small fixture above alone cannot catch markup drift in app/index.html.
const actualAppShell = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const authPresenter = readFileSync(new URL('../src/social-oauth-auth.js', import.meta.url), 'utf8');

function openingTagById(html, id) {
  const matches = html.match(new RegExp(`<[^<>]+\\sid=["']${id}["'][^<>]*>`, 'g')) || [];
  assert.equal(matches.length, 1, `expected one element with id ${id}`);
  return matches[0];
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=\\s|/?>)`));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : undefined;
}

function elementText(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi'))]
    .map((match) => match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
}

function authIntroContent(html) {
  const opening = [...html.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)]
    .find((match) => attribute(match[0], 'class')?.split(/\s+/).includes('auth-intro'));
  assert.ok(opening, 'the runtime auth intro must exist');
  const tags = new RegExp(`<\\/?${opening[1]}\\b[^>]*>`, 'gi');
  tags.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (!depth) return html.slice(opening.index + opening[0].length, tag.index);
  }
  assert.fail('the runtime auth intro must have a closing element');
}

async function fetchActualShell(origin, pathname) {
  const requests = [];
  const response = await assetRouter.fetch(
    new Request(`${origin}${pathname}`, { headers: { 'X-Request-ID': 'actual-auth-shell-1234' } }),
    {
      ASSETS: {
        async fetch(request) {
          requests.push(request.url);
          return new Response(actualAppShell, {
            headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: 'actual-app-shell' },
          });
        },
      },
    },
  );
  assert.deepEqual(requests, [`${origin}/app/`], 'auth routes must read the canonical app asset');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('ETag'), null);
  return response.text();
}

function assertFirstPaintStylesheet(html, origin) {
  const currentHref = authPresenter.match(/const AUTH_ENTRY_POLISH_STYLESHEET = ['"]([^'"]+)['"]/i)?.[1];
  assert.ok(currentHref, 'the auth presenter must declare its current stylesheet');
  const tag = openingTagById(html, 'auth-entry-polish-styles');
  assert.equal(attribute(tag, 'rel'), 'stylesheet');
  assert.equal(attribute(tag, 'href'), currentHref, 'first-paint and runtime auth stylesheet versions must match');
  assert.equal(attribute(tag, 'disabled'), undefined);
  assert.ok(html.indexOf(tag) < html.indexOf('</head>'), 'auth styling must be present in the initial document head');

  const stylesheet = new URL(currentHref, origin);
  assert.equal(stylesheet.origin, origin);
  assert.equal(stylesheet.pathname, '/app/assets/auth-entry-polish.css');
  assert.ok(stylesheet.searchParams.get('v'), 'auth CSS requires an explicit cache version');
  const css = readFileSync(new URL(`..${stylesheet.pathname}`, import.meta.url), 'utf8');
  assert.ok(css.trim(), 'the referenced first-paint stylesheet must exist and contain styles');
}

const actualRouteCopy = {
  login: { title: 'Welcome back to SautiLink', copy: 'Sign in to continue to your account.' },
  signup: { title: 'Create your SautiLink account', copy: 'Join SautiLink and set up your account.' },
};

for (const mode of ['login', 'signup']) {
  test(`actual /${mode} page has the correct visible panel, intro and current styles before JavaScript`, async () => {
    for (const origin of ['https://sautilink.com', 'https://www.sautilink.com']) {
      for (const suffix of ['', '/']) {
        const html = await fetchActualShell(origin, `/${mode}${suffix}`);
        const body = html.match(/<body\b[^>]*>/i)?.[0];
        assert.ok(body, 'the actual page must have a body');
        assert.equal(attribute(body, 'data-auth-mode'), mode);
        assert.equal(attribute(body, 'data-sautilink-auth-entry'), mode);
        assert.equal(attribute(openingTagById(html, 'loading-view'), 'hidden'), '');
        assert.equal(attribute(openingTagById(html, 'auth-view'), 'hidden'), undefined);
        assert.equal(attribute(openingTagById(html, 'auth-tabs'), 'hidden'), undefined);

        for (const panelMode of ['login', 'signup']) {
          const selected = panelMode === mode;
          assert.equal(attribute(openingTagById(html, `${panelMode}-panel`), 'hidden'), selected ? undefined : '');
          assert.equal(attribute(openingTagById(html, `${panelMode}-tab`), 'aria-selected'), String(selected));
        }

        const otherMode = mode === 'login' ? 'signup' : 'login';
        const intro = authIntroContent(html);
        assert.ok(elementText(intro, 'h2').includes(actualRouteCopy[mode].title), 'route-specific intro heading is missing');
        assert.ok(elementText(intro, 'p').includes(actualRouteCopy[mode].copy), 'route-specific intro copy is missing');
        assert.ok(!elementText(intro, 'h2').includes(actualRouteCopy[otherMode].title), 'the other auth route intro must not be shown');
        assertFirstPaintStylesheet(html, origin);
      }
    }
  });
}
