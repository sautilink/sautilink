import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FEATURE_LABELS,
  LANGUAGE_OPTIONS,
  normalizeLanguage,
  translateSystemText,
} from '../src/language-preference.js';

const languageSource = await readFile(new URL('../src/language-preference.js', import.meta.url), 'utf8');
const buildSource = await readFile(new URL('../scripts/build-app.mjs', import.meta.url), 'utf8');

test('language preference supports English, Kiswahili and French with English fallback', () => {
  assert.deepEqual(LANGUAGE_OPTIONS.map(({ code }) => code), ['en', 'sw', 'fr']);
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('sw-TZ'), 'sw');
  assert.equal(normalizeLanguage('fr-FR'), 'fr');
  assert.equal(normalizeLanguage('unknown'), 'en');
  assert.equal(normalizeLanguage(''), 'en');
});

test('representative system UI copy translates while unknown copy falls back unchanged', () => {
  assert.equal(translateSystemText('Create Post', 'sw'), 'Tengeneza Posti');
  assert.equal(translateSystemText('Create Post', 'fr'), 'Créer une publication');
  assert.equal(translateSystemText('Language preference', 'sw'), 'Lugha unayopendelea');
  assert.equal(translateSystemText('Language preference', 'fr'), 'Préférence de langue');
  assert.equal(translateSystemText('Unmapped future system copy', 'sw'), 'Unmapped future system copy');
});

test('SautiLink core feature titles remain original in every language', () => {
  const required = ['Home', 'Rooms', 'Sautify', 'Messages', 'Settings', 'Profile'];
  for (const label of required) {
    assert.equal(FEATURE_LABELS.has(label), true, `${label} must remain a product label`);
    assert.equal(translateSystemText(label, 'sw'), label);
    assert.equal(translateSystemText(label, 'fr'), label);
  }
});

test('runtime is browser-local and does not alter auth, RLS, APIs or database preferences', () => {
  assert.match(languageSource, /sautilink\.language/);
  assert.match(languageSource, /localStorage\.setItem\(LANGUAGE_STORAGE_KEY/);
  assert.doesNotMatch(languageSource, /supabase/i);
  assert.doesNotMatch(languageSource, /\bfetch\s*\(/);
  assert.doesNotMatch(languageSource, /service_role/i);
  assert.doesNotMatch(languageSource, /social_member_preferences/i);
});

test('user-authored content surfaces are excluded from automatic translation', () => {
  for (const selector of [
    '.sauti-card-body',
    '.sauti-caption-text',
    '.sauti-comment-body',
    '#profile-bio',
    '.dm-message p',
    '.circle-card-description',
  ]) {
    assert.ok(languageSource.includes(`'${selector}'`), `${selector} must remain protected`);
  }
});

test('language switching preserves English origins across repeated language changes', () => {
  assert.match(languageSource, /function isKnownRendering\(current, origin\)/);
  assert.match(languageSource, /for \(const \{ code \} of LANGUAGE_OPTIONS\)/);
  assert.match(languageSource, /current === translateSystemText\(origin, code\)/);
});

test('language settings panel is isolated from the existing settings router', () => {
  assert.match(languageSource, /button\.dataset\.settingsSection = 'language'/);
  assert.match(languageSource, /panel\.dataset\.settingsPanel = 'language'/);
  assert.match(languageSource, /event\.stopPropagation\(\)/);
});

test('production app build bundles the language runtime', () => {
  assert.match(buildSource, /src\/language-preference\.js/);
});
