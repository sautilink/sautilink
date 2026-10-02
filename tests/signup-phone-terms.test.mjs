import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('registration requires a phone and explicit documents consent before an account is created', async () => {
  const [html, source] = await Promise.all([read('app/index.html'), read('src/app.js')]);
  assert.match(html, /id="signup-phone"[^>]*required/);
  assert.match(html, /id="signup-terms-consent"[^>]*required/);
  assert.match(html, /id="signup-phone-channel"[\s\S]*?<option value="whatsapp" selected>/);
  assert.match(html, /id="signup-phone-panel"[\s\S]*?href="\/terms"[\s\S]*?href="\/privacy"/);
  const submit = source.slice(source.indexOf("byId('signup-form').addEventListener"), source.indexOf("byId('signup-verify-form').addEventListener"));
  assert.ok(submit.indexOf('if (!phone)') < submit.indexOf('supabase.auth.signUp('));
  assert.ok(submit.indexOf('if (!form.termsConsent.checked)') < submit.indexOf('supabase.auth.signUp('));
  assert.match(submit, /sautilink_signup_phone: phone/);
});

test('phone linking stores the selected delivery method before requesting an OTP and verifies it before onboarding', async () => {
  const source = await read('src/app.js');
  const request = source.slice(source.indexOf("byId('signup-phone-form').addEventListener"), source.indexOf("byId('signup-phone-verify-form').addEventListener"));
  assert.ok(request.indexOf('await acceptSignupDocuments()') < request.indexOf('auth.updateUser({ phone })'));
  assert.ok(request.indexOf('sautilink_phone_otp_channel: channel') < request.indexOf('auth.updateUser({ phone })'));
  assert.match(source, /verifyOtp\(\{ phone: signupPhoneChange, token: code, type: 'phone_change' \}\)/);
  assert.match(source, /if \(await showSignupRequirements\(user\)\) return;/);
  assert.match(source, /type: 'email'/);
});

test('server admission checks consent and verified phone only for accounts created after activation', async () => {
  const sql = await read('supabase/migrations/20261002092542_require_new_signup_phone_and_terms.sql');
  assert.match(sql, /created_at >= activated_at[\s\S]*SIGNUP_TERMS_REQUIRED[\s\S]*VERIFIED_PHONE_REQUIRED/);
  assert.match(sql, /auth\.uid\(\) is distinct from new\.id/);
  assert.match(sql, /before insert on public\.account_profiles/);
  assert.match(sql, /private\.signup_acceptances[\s\S]*accepted_at timestamptz/);
  assert.match(sql, /grant execute on function public\.get_signup_requirements\(\), public\.accept_signup_terms\(\)[\s\S]*to authenticated/);
});
