import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BIRTH_DATE_MIN_YEAR,
  daysInBirthMonth,
  localDateIso,
  normalizeBirthDateParts,
  splitBirthDate,
} from '../src/birth-date.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('birth date helper accepts real calendar dates and rejects impossible dates', () => {
  assert.equal(daysInBirthMonth(2000, 2), 29);
  assert.equal(daysInBirthMonth(2001, 2), 28);
  assert.deepEqual(
    normalizeBirthDateParts({ year: '2000', month: '2', day: '29' }, { today: new Date(2026, 8, 20) }),
    { value: '2000-02-29', error: '' },
  );
  assert.match(
    normalizeBirthDateParts({ year: '2001', month: '2', day: '29' }, { today: new Date(2026, 8, 20) }).error,
    /valid day/i,
  );
});

test('birth date helper blocks future, incomplete and out-of-range dates', () => {
  assert.match(normalizeBirthDateParts({ year: '', month: '2', day: '1' }).error, /complete/i);
  assert.match(
    normalizeBirthDateParts({ year: String(BIRTH_DATE_MIN_YEAR - 1), month: '1', day: '1' }).error,
    /valid year/i,
  );
  assert.match(
    normalizeBirthDateParts({ year: '2026', month: '9', day: '21' }, { today: new Date(2026, 8, 20) }).error,
    /future/i,
  );
});

test('birth date formatting is stable and timezone-local', () => {
  assert.equal(localDateIso(new Date(2026, 8, 20, 0, 5)), '2026-09-20');
  assert.deepEqual(splitBirthDate('1997-04-09'), { year: '1997', month: '04', day: '09' });
  assert.deepEqual(splitBirthDate('not-a-date'), { year: '', month: '', day: '' });
});

test('signup and settings controls use the shared authenticated Supabase client', async () => {
  const source = await read('src/birth-date-controls.js');
  assert.match(source, /signup-birth-date-fieldset/);
  assert.match(source, /Date of birth/);
  assert.match(source, /autocomplete=\\"bday-day\\"/);
  assert.match(source, /autocomplete=\\"bday-month\\"/);
  assert.match(source, /autocomplete=\\"bday-year\\"/);
  assert.match(source, /addEventListener\('submit',[\s\S]*?true\)/);
  assert.match(source, /sautilink:auth-client-ready/);
  assert.match(source, /__sautilinkSupabaseAuthClient/);
  assert.doesNotMatch(source, /createClient\s*\(/);
  assert.match(source, /\.from\('account_profiles'\)[\s\S]*?\.update\(\{ birth_date:/);
  assert.doesNotMatch(source, /\.from\('social_profiles'\)[\s\S]*?birth_date/);
});

test('legacy users are not blocked and settings exposes a private save path', async () => {
  const [source, migration, build] = await Promise.all([
    read('src/birth-date-controls.js'),
    read('supabase/migrations/20260920015000_add_private_account_birth_date.sql'),
    read('scripts/build-app.mjs'),
  ]);

  assert.match(source, /settings-birth-date-card/);
  assert.match(source, /Private account information/);
  assert.match(source, /Save date of birth/);
  assert.match(source, /select\('birth_date'\)/);
  assert.match(migration, /alter table public\.account_profiles[\s\S]*add column if not exists birth_date date/i);
  assert.doesNotMatch(migration, /birth_date\s+date\s+not\s+null/i);
  assert.match(migration, /grant update \(birth_date\)[\s\S]*to authenticated/i);
  assert.match(migration, /birth_date <= current_date/i);
  assert.match(build, /src\/birth-date-controls\.js/);
});
