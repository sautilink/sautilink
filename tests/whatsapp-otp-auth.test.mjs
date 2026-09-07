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
  assert.match(source, /\^\\\+\[1-9\]\\d\{7,14\}\$/);
  assert.match(source, /\^\\d\{6,10\}\$/);
});

test('WhatsApp OTP hook is delivery-only and does not create a second OTP database', async () => {
  const source = await read('supabase/functions/sautilink-whatsapp-otp/index.ts');

  assert.doesNotMatch(source, /createClient|service_role|SERVICE_ROLE|\.from\(|insert\(|update\(/);
  assert.match(source, /Cache-Control': 'no-store, max-age=0'/);
  assert.match(source, /data: \{ enabled: whatsappReady\(\) \}/);
});
