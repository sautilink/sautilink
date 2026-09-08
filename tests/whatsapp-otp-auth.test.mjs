import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('WhatsApp OTP hook authenticates Supabase hook requests before delivery', async () => {
  const source = await read('supabase/functions/sautilink-whatsapp-otp/index.ts');

  assert.match(source, /standardwebhooks@1\.0\.0/);
  assert.match(source, /SEND_SMS_HOOK_SECRET/);
  assert.match(source, /new Webhook\(secret\)\.verify\(payload, headers\)/);
  assert.match(source, /INVALID_HOOK_SIGNATURE/);
});

test('WhatsApp OTP hook uses Meta Cloud API secrets without hardcoded credentials', async () => {
  const source = await read('supabase/functions/sautilink-whatsapp-otp/index.ts');

  for (const key of [
    'WHATSAPP_OTP_ENABLED',
    'WHATSAPP_GRAPH_API_VERSION',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_OTP_TEMPLATE_NAME',
    'WHATSAPP_OTP_TEMPLATE_LANGUAGE',
  ]) {
    assert.match(source, new RegExp(key));
  }

  assert.match(source, /graph\.facebook\.com\/\$\{version\}\/\$\{phoneNumberId\}\/messages/);
  assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(source, /EA[A-Za-z0-9]{40,}/);
});

test('WhatsApp OTP delivery uses an authentication template and validates phone plus OTP', async () => {
  const source = await read('supabase/functions/sautilink-whatsapp-otp/index.ts');

  assert.match(source, /messaging_product: 'whatsapp'/);
  assert.match(source, /type: 'template'/);
  assert.match(source, /type: 'body'/);
  assert.match(source, /sub_type: 'url'/);
  assert.match(source, /text: otp/);
  assert.match(source, /\^\[1-9\]\\d\{7,14\}\$/);
  assert.match(source, /\^\\d\{6,10\}\$/);
});

test('WhatsApp OTP hook uses the destination from Supabase sms.phone first', async () => {
  const source = await read('supabase/functions/sautilink-whatsapp-otp/index.ts');

  assert.match(source, /sms\?: \{ otp\?: string; phone\?: string \}/);
  assert.match(
    source,
    /event\?\.sms\?\.phone \|\| event\?\.user\?\.new_phone \|\| event\?\.user\?\.phone/,
  );
});

test('WhatsApp OTP hook accepts Supabase digit-only E.164 and sends Meta digits without slicing', async () => {
  const source = await read('supabase/functions/sautilink-whatsapp-otp/index.ts');

  assert.match(source, /raw\.startsWith\('\+'\) \? raw\.slice\(1\) : raw/);
  assert.match(source, /to: phone,/);
  assert.doesNotMatch(source, /to: phone\.slice\(1\)/);
});

test('WhatsApp OTP hook logs sanitized Meta diagnostics without exposing recipient or OTP', async () => {
  const source = await read('supabase/functions/sautilink-whatsapp-otp/index.ts');

  assert.match(source, /function sanitizeMetaText/);
  assert.match(source, /metaCode: metaError\.code/);
  assert.match(source, /metaSubcode: metaError\.subcode/);
  assert.match(source, /metaType: metaError\.type/);
  assert.match(source, /metaMessage: metaError\.message/);
  assert.match(source, /metaDetails: metaError\.details/);
  assert.match(source, /replace\(\/\\b\\d\{4,\}\\b\/g, '\[redacted\]'\)/);
  assert.doesNotMatch(source, /console\.error\([^\n]*phone/);
  assert.doesNotMatch(source, /console\.error\([^\n]*otp/);
});

test('WhatsApp OTP hook is delivery-only and does not create a second OTP database', async () => {
  const source = await read('supabase/functions/sautilink-whatsapp-otp/index.ts');

  assert.doesNotMatch(source, /createClient|service_role|SERVICE_ROLE|\.from\(|insert\(|update\(/);
  assert.match(source, /Cache-Control': 'no-store, max-age=0'/);
  assert.match(source, /data: \{ enabled: whatsappReady\(\) \}/);
});

test('WhatsApp settings accepts Supabase digit-only stored phones and formats them for display', async () => {
  const source = await read('src/whatsapp-otp-auth.js');

  assert.match(source, /function normalizeStoredPhone/);
  assert.match(source, /raw\.startsWith\('\+'\) \? raw\.slice\(1\) : raw/);
  assert.match(source, /function formatStoredPhone/);
  assert.match(source, /return digits \? `\+\$\{digits\}` : ''/);
  assert.match(source, /const storedPhone = normalizeStoredPhone\(user\?\.phone\)/);
});

test('WhatsApp settings persists verified state after refresh and offers change instead of relink', async () => {
  const source = await read('src/whatsapp-otp-auth.js');

  assert.match(source, /Verified WhatsApp number: \$\{displayPhone\}/);
  assert.match(source, /status\.dataset\.state = confirmed \? 'verified'/);
  assert.match(source, /confirmed \? 'Change WhatsApp number' : 'Link WhatsApp number'/);
  assert.match(source, /if \(displayPhone && !phoneInput\.value\) phoneInput\.value = displayPhone/);
});

test('WhatsApp login reports the real Supabase auth failure instead of falsely saying the number is unlinked', async () => {
  const source = await read('src/whatsapp-otp-auth.js');

  assert.match(source, /function whatsappLoginRequestError\(error\)/);
  assert.match(source, /over_sms_send_rate_limit/);
  assert.match(source, /over_request_rate_limit/);
  assert.match(source, /captcha_failed/);
  assert.match(source, /phone_provider_disabled/);
  assert.match(source, /otp_disabled/);
  assert.match(source, /Reference: \$\{reference\}/);
  assert.match(source, /catch \(error\) \{\n    setFormMessage\(message, whatsappLoginRequestError\(error\)\);/);
  assert.doesNotMatch(source, /Make sure this number is linked to your SautiLink account/);
});
