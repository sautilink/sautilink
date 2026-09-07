import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('WhatsApp OTP UI reuses the canonical Supabase auth client', async () => {
  const source = await read('src/whatsapp-otp-auth.js');
  const transform = await read('scripts/whatsapp-otp-source-transform.mjs');

  assert.match(transform, /__sautilinkSupabaseAuthClient/);
  assert.match(transform, /sautilink:auth-client-ready/);
  assert.match(source, /sautilink:auth-client-ready/);
  assert.doesNotMatch(source, /createClient\s*\(/);
  assert.doesNotMatch(source, /sb_publishable_|service_role|SERVICE_ROLE/);
});

test('WhatsApp login cannot auto-create a separate account', async () => {
  const source = await read('src/whatsapp-otp-auth.js');

  assert.match(source, /signInWithOtp\(\{[\s\S]*?phone,[\s\S]*?shouldCreateUser: false/);
  assert.match(source, /verifyOtp\(\{ phone: loginPhone, token: code, type: 'sms' \}\)/);
  assert.match(source, /Make sure this number is linked to your SautiLink account/);
});

test('existing members link and verify WhatsApp on the same Supabase user', async () => {
  const source = await read('src/whatsapp-otp-auth.js');

  assert.match(source, /client\.auth\.updateUser\(\{ phone \}\)/);
  assert.match(source, /verifyOtp\(\{ phone: phoneChange, token: code, type: 'phone_change' \}\)/);
  assert.match(source, /WhatsApp sign-in is now enabled for this account/);
});

test('WhatsApp UI stays dormant until the server capability is explicitly enabled', async () => {
  const source = await read('src/whatsapp-otp-auth.js');

  assert.match(source, /WHATSAPP_FUNCTION = 'sautilink-whatsapp-otp'/);
  assert.match(source, /payload\?\.data\?\.enabled === true/);
  assert.match(source, /show-whatsapp-passwordless'\)\.hidden = false/);
  assert.match(source, /settings-whatsapp-card'\)\.hidden = false/);
  assert.match(source, /cache: 'no-store'/);
});

test('WhatsApp phone and OTP inputs enforce bounded formats', async () => {
  const source = await read('src/whatsapp-otp-auth.js');

  assert.match(source, /\^\\\+\[1-9\]\\d\{7,14\}\$/);
  assert.match(source, /\^\\d\{6,10\}\$/);
  assert.match(source, /international format/);
});
