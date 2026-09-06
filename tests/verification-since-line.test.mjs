import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('verification card adds a month-year verified-since line from the existing verification lock timestamp', async () => {
  const [enhancement, css] = await Promise.all([
    read('src/verified-identity-controls.js'),
    read('app/assets/verified-identity-controls.css'),
  ]);

  assert.match(enhancement, /select:\s*'username,username_locked_at,is_verified'/);
  assert.match(enhancement, /is_verified:\s*'eq\.true'/);
  assert.match(enhancement, /new Intl\.DateTimeFormat\('en',[\s\S]*month:\s*'long'[\s\S]*year:\s*'numeric'[\s\S]*timeZone:\s*'UTC'/);
  assert.match(enhancement, /`Verified since \$\{monthYear\}`/);
  assert.match(enhancement, /line\.id = 'verification-info-since'/);
  assert.match(enhancement, /message\.insertAdjacentElement\('afterend', line\)/);
  assert.match(css, /\.verification-info-since\s*\{[\s\S]*color:\s*var\(--app-muted\)[\s\S]*font-size:\s*11px/);
});

test('existing verification wording and dialog behavior remain intact', async () => {
  const app = await read('src/app.js');

  assert.match(app, /This profile was verified as belonging to \$\{displayName\}\./);
  assert.match(app, /This profile was verified as belonging to \$\{displayName\}, a member of the SautiLink Team\./);
  assert.match(app, /This profile is verified\. Verification may be removed at any time if you violate SautiLink rules or policies\./);
  assert.match(app, /if \(typeof dialog\.showModal === 'function'\) dialog\.showModal\(\)/);
});

test('verified-since lookup stays authenticated and hides the line instead of guessing when no timestamp is available', async () => {
  const enhancement = await read('src/verified-identity-controls.js');

  assert.match(enhancement, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(enhancement, /if \(!accessToken\) return renderVerificationSince\(''\)/);
  assert.match(enhancement, /const verifiedAt = Array\.isArray\(rows\) \? String\(rows\[0\]\?\.username_locked_at \|\| ''\) : ''/);
  assert.match(enhancement, /line\.hidden = !monthYear/);
});
