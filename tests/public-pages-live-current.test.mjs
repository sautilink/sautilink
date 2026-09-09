import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const englishCurrentPages = ['about.html', 'help.html', 'contact.html', 'account-deletion.html'];

for (const path of englishCurrentPages) {
  test(`${path} does not present SautiLink as pre-launch`, () => {
    const html = read(path).toLowerCase();
    assert.doesNotMatch(html, /pre-launch/);
    assert.doesNotMatch(html, /join the waitlist/);
    assert.doesNotMatch(html, /verified waitlist/);
    assert.doesNotMatch(html, /when accounts launch/);
    assert.doesNotMatch(html, /has not launched public social accounts/);
  });
}

test('Help Centre documents live product areas and current commercial wording', () => {
  const html = read('help.html');
  for (const expected of ['Account &amp; sign-in', 'What are Rooms?', 'direct messages', 'verification badge', '14-day recovery window']) {
    assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(html, /Core SautiLink access currently does not require a subscription/i);
  assert.match(html, /optional paid features/i);
  assert.doesNotMatch(html, /core SautiLink social-network experience is intended to be free/i);
});

test('Account deletion page matches the live recoverable deletion contract', () => {
  const html = read('account-deletion.html');
  assert.match(html, /Status<\/strong> Available now/);
  assert.match(html, /14 days/i);
  assert.match(html, /cancel/i);
  assert.match(html, /Within 30 days/i);
  assert.match(html, /up to <strong>90 days<\/strong>/i);
  assert.match(html, /\/assets\/legal-policy\.css/);
});

test('Contact page keeps the live form wiring while removing waitlist help copy', () => {
  const html = read('contact.html');
  assert.match(html, /id="contact-form"/);
  assert.match(html, /\/assets\/contact\.js/);
  assert.match(html, /accounts, profiles, posts, Rooms, messages, privacy, safety and account controls/i);
});

test('Legacy localized landing pages now point to live account entry', () => {
  const files = {
    'sw.html': ['Fungua akaunti', 'Ingia'],
    'fr.html': ['Créer un compte', 'Se connecter'],
    'es.html': ['Crear una cuenta', 'Iniciar sesión'],
    'nb.html': ['Opprett konto', 'Logg inn'],
    'no.html': ['Opprett konto', 'Logg inn'],
  };

  const stale = [/waitlist/i, /orodha ya kusubiri/i, /liste d['’]attente/i, /lista de espera/i, /ventelisten/i, /kommer snart/i, /próximamente/i, /bientôt/i];

  for (const [path, expected] of Object.entries(files)) {
    const html = read(path);
    assert.match(html, /href="\/signup"/);
    assert.match(html, /href="\/login"/);
    for (const phrase of expected) assert.match(html, new RegExp(phrase, 'i'));
    for (const pattern of stale) assert.doesNotMatch(html, pattern);
  }
});

test('Sitemap reflects the current public pages and update date', () => {
  const xml = read('sitemap.xml');
  assert.match(xml, /2026-09-09/);
  for (const path of ['/about', '/help', '/contact', '/privacy', '/terms', '/account-deletion', '/sw', '/fr', '/es', '/no']) {
    assert.match(xml, new RegExp(`https:\\/\\/sautilink\\.com${path.replace('/', '\\/')}`));
  }
});

test('Template-style public micro-labels are removed from Help and stripped from other important pages at runtime', () => {
  const help = read('help.html');
  assert.doesNotMatch(help, /class="eyebrow"/);
  assert.doesNotMatch(help, /class="section-label"/);

  const legalRuntime = read('assets/legal.js');
  assert.match(legalRuntime, /querySelectorAll\('\.eyebrow, \.section-label, \.section-kicker'\)/);

  for (const path of ['about.html', 'contact.html', 'account-deletion.html', 'privacy.html', 'terms.html', 'sautinote.html']) {
    assert.match(read(path), /\/assets\/legal\.js/);
  }
});
