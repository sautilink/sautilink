import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  normalizeWhatsAppEvents,
  validWhatsAppSignature,
} from '../supabase/functions/_shared/whatsapp-webhook-core.mjs';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

const WABA_ID = '1234567890123';
const PHONE_ID = '2345678901234';
const secret = 'meta-test-app-secret-not-real';
const options = { wabaId: WABA_ID, phoneNumberId: PHONE_ID };

function event(value) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: WABA_ID,
      changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: PHONE_ID },
        ...value,
      } }],
    }],
  };
}

test('Meta signature is checked against the exact raw body, not parsed JSON', async () => {
  const body = '{"object":"whatsapp_business_account"}';
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(await validWhatsAppSignature(body, signature, secret), true);
  assert.equal(await validWhatsAppSignature(body + ' ', signature, secret), false);
  assert.equal(await validWhatsAppSignature(body, 'sha256=' + '0'.repeat(64), secret), false);
  assert.equal(await validWhatsAppSignature(body, null, secret), false);
  assert.equal(await validWhatsAppSignature(body, signature, 'x'), false);
});

test('Incoming WhatsApp text is normalized without storing raw payload or media', () => {
  const payload = event({
    messages: [{
      from: '255712345678',
      id: 'wamid.HBgMTEXT1234567890',
      timestamp: '1791334800',
      type: 'text',
      text: { body: 'Hi SautiLink, I need help' },
      // Raw payload may include identity fields/media or other untrusted data:
      secret: 'NEVER_COPY_UNKNOWN_FIELDS',
    }],
  });
  const result = normalizeWhatsAppEvents(payload, options);
  assert.equal(result.messages.length, 1);
  assert.equal(result.statuses.length, 0);
  assert.deepEqual(Object.keys(result.messages[0]).sort(), [
    'message_type', 'occurred_at', 'phone_number_id', 'provider_message_id',
    'sender_wa_id', 'text_body', 'waba_id',
  ]);
  assert.equal(result.messages[0].text_body, 'Hi SautiLink, I need help');
  assert.equal(result.messages[0].sender_wa_id, '255712345678');
  assert.doesNotMatch(JSON.stringify(result), /NEVER_COPY_UNKNOWN_FIELDS/);
});

test('Only configured WABA and phone number can add messages', () => {
  const payload = event({
    messages: [{
      from: '255712345678', id: 'wamid.HBgMTEXT1234567890',
      timestamp: '1791334800',
      type: 'text', text: { body: 'Help' },
    }],
  });
  assert.equal(normalizeWhatsAppEvents(payload, { ...options, wabaId: '123' }).messages.length, 0);
  assert.equal(normalizeWhatsAppEvents(payload, { ...options, phoneNumberId: '456' }).messages.length, 0);
  assert.equal(normalizeWhatsAppEvents({ ...payload, object: 'other' }, options).messages.length, 0);
  assert.equal(normalizeWhatsAppEvents(payload, options).messages.length, 1);
});

test('Invalid timestamps cannot create new duplicates with different receipt times', () => {
  const payload = event({
    messages: [{
      from: '255712345678',
      id: 'wamid.HBgMREPLAY123456789',
      timestamp: 'not-a-timestamp',
      type: 'text',
      text: { body: 'Retry' },
    }],
  });
  assert.equal(normalizeWhatsAppEvents(payload, options).messages.length, 0);
});

test('Delivery events are deduplicated by provider message id, status, timestamp at DB level', async () => {
  const payload = event({
    statuses: [{
      id: 'wamid.HBgMSTATUS12345678',
      recipient_id: '255712345678',
      status: 'delivered',
      timestamp: '1791334800',
      errors: [{ detail: 'NEVER_COPY_META_ERROR_PAYLOAD' }],
    }],
  });
  const result = normalizeWhatsAppEvents(payload, options);
  assert.equal(result.statuses.length, 1);
  assert.equal(result.statuses[0].delivery_status, 'delivered');
  assert.doesNotMatch(JSON.stringify(result), /NEVER_COPY_META_ERROR_PAYLOAD/);
  const source = await read('supabase/functions/sautilink-whatsapp-webhook/index.ts');
  assert.match(source, /resolution=ignore-duplicates,return=minimal/);
  assert.match(source, /phone_number_id,provider_message_id,delivery_status,occurred_at/);
});

test('Webhook must fail closed without Meta signature, verified config, or database write', async () => {
  const source = await read('supabase/functions/sautilink-whatsapp-webhook/index.ts');
  for (const expected of [
    'WHATSAPP_WEBHOOK_ENABLED', 'WHATSAPP_WABA_ID', 'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_META_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    'SUPABASE_SERVICE_ROLE_KEY', 'x-hub-signature-256',
  ]) assert.ok(source.includes(expected));
  assert.match(source, /if \(!valid\) return respond\(401, 'Unauthorized'\)/);
  assert.match(source, /return respond\(503, 'Try again'\)/);
  assert.match(source, /if \(request\.method === 'GET'\) return verifyChallenge/);
  assert.match(source, /if \(request\.method === 'POST'\) return receiveWebhook/);
  assert.match(source, /MAX_WEBHOOK_BYTES = 256 \* 1024/);
  assert.doesNotMatch(source, /console\.(log|error)\(/);
});

test('WhatsApp inbox schema has strict RLS, no public grants, and no secret columns', async () => {
  const sql = await read('supabase/migrations/20261007012900_whatsapp_inbound_foundation.sql');
  assert.match(sql, /create table if not exists public\.whatsapp_inbound_messages/);
  assert.match(sql, /create table if not exists public\.whatsapp_message_statuses/);
  assert.match(sql, /alter table public\.whatsapp_inbound_messages enable row level security/);
  assert.match(sql, /alter table public\.whatsapp_message_statuses enable row level security/);
  assert.match(sql, /revoke all on table public\.whatsapp_inbound_messages from public, anon, authenticated/);
  assert.match(sql, /revoke all on table public\.whatsapp_message_statuses from public, anon, authenticated/);
  assert.match(sql, /unique \(phone_number_id, provider_message_id\)/);
  assert.doesNotMatch(sql, /access_token|app_secret|otp_code|raw_payload/i);
});
