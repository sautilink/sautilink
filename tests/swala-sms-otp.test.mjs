import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { transform } from 'esbuild';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../supabase/functions/sautilink-whatsapp-otp/index.ts', import.meta.url), 'utf8');
const js = (await transform(source.replace(/^import \{ Webhook \} from .*;\s*/m, ''), { loader: 'ts' })).code;

function hook({ sms = true, whatsapp = false, replies = [] } = {}) {
  const env = {
    SEND_SMS_HOOK_SECRET: 'v1,whsec_test-signature',
    SWALA_SMS_ENABLED: sms ? 'true' : 'false',
    SWALA_SMS_API_KEY: 'private-test-key',
    SWALA_SMS_SENDER_ID: 'SautiLink',
    WHATSAPP_OTP_ENABLED: whatsapp ? 'true' : 'false',
    WHATSAPP_GRAPH_API_VERSION: 'v23.0',
    WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_ACCESS_TOKEN: 'private-meta-token',
    WHATSAPP_OTP_TEMPLATE_NAME: 'sautilink_otp',
    WHATSAPP_OTP_TEMPLATE_LANGUAGE: 'en_US',
  };
  const requests = [];
  let handler;
  class Webhook {
    constructor(secret) { assert.equal(secret, 'test-signature'); }
    verify(payload, headers) {
      if (headers['webhook-signature'] !== 'valid') throw new Error('Invalid signature');
      return JSON.parse(payload);
    }
  }
  runInNewContext(js, {
    Webhook,
    Deno: { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const reply = replies.shift() || { status: 202, body: { success: true, data: { uid: 'queued-1' } } };
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    },
    crypto: webcrypto,
    Response,
    AbortController,
    TextEncoder,
    setTimeout,
    clearTimeout,
    console: { error() {} },
  });
  const event = (preference = 'sms', signature = 'valid') => handler(new Request('https://example.test/functions/v1/sautilink-whatsapp-otp', {
    method: 'POST',
    headers: { 'webhook-signature': signature, 'webhook-id': 'event-1' },
    body: JSON.stringify({
      user: { phone: '255712345678', user_metadata: { sautilink_phone_otp_channel: preference } },
      sms: { otp: '438921' },
    }),
  }));
  return { handler, event, requests, env };
}

test('signed Supabase OTP queues an idempotent SwalaSMS message and never exposes the API key', async () => {
  const client = hook();
  const response = await client.event();
  assert.equal(response.status, 200);
  assert.equal(client.requests.length, 1);
  const { url, options } = client.requests[0];
  assert.equal(url, 'https://swalasms.com/api/v1/sms/messages');
  assert.equal(options.headers.Authorization, 'Bearer private-test-key');
  assert.match(options.headers['Idempotency-Key'], /^sautilink-otp-[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(options.body), {
    recipient: '+255712345678',
    sender_id: 'SautiLink',
    body: 'Your SautiLink verification code is 438921. Do not share this code.',
  });
  assert.doesNotMatch(await response.text(), /438921|private-test-key/);
  await client.event();
  assert.equal(client.requests[1].options.headers['Idempotency-Key'], options.headers['Idempotency-Key']);
});

test('invalid hook signature never sends an SMS', async () => {
  const client = hook();
  assert.equal((await client.event('sms', 'forged')).status, 401);
  assert.equal(client.requests.length, 0);
});

test('failed SMS send does not claim that the code was delivered', async () => {
  const client = hook({ replies: [{ status: 422, body: { success: false, message: 'route_not_verified' } }] });
  assert.equal((await client.event()).status, 502);
  assert.equal(client.requests.length, 1);
});

test('an existing WhatsApp choice remains available and falls back to SMS only when Meta rejects it', async () => {
  const client = hook({ sms: true, whatsapp: true, replies: [
    { status: 400, body: { error: { message: 'unavailable' } } },
    { status: 202, body: { success: true, data: { uid: 'queued-2' } } },
  ] });
  assert.equal((await client.event('whatsapp')).status, 200);
  assert.match(client.requests[0].url, /^https:\/\/graph\.facebook\.com\//);
  assert.equal(client.requests[1].url, 'https://swalasms.com/api/v1/sms/messages');
});

test('accepted SMS does not also send on WhatsApp', async () => {
  const client = hook({ sms: true, whatsapp: true });
  assert.equal((await client.event('sms')).status, 200);
  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0].url, 'https://swalasms.com/api/v1/sms/messages');
});

test('uncertain SMS provider response never triggers a duplicate WhatsApp OTP', async () => {
  const client = hook({ sms: true, whatsapp: true, replies: [
    { status: 500, body: { success: false } },
  ] });
  assert.equal((await client.event('sms')).status, 502);
  assert.equal(client.requests.length, 1);
});

test('capability check advertises only configured channels', async () => {
  const client = hook({ sms: true, whatsapp: false });
  const response = await client.handler(new Request('https://example.test/functions/v1/sautilink-whatsapp-otp'));
  const result = await response.json();
  assert.equal(result.data.enabled, true);
  assert.equal(result.data.channels.sms, true);
  assert.equal(result.data.channels.whatsapp, false);
});
