import {
  normalizeWhatsAppEvents,
  validWhatsAppSignature,
} from '../_shared/whatsapp-webhook-core.mjs';

const MAX_WEBHOOK_BYTES = 256 * 1024;

function env(name: string): string {
  return String(Deno.env.get(name) || '').trim();
}

function respond(status: number, body: string, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function ready(): boolean {
  return env('WHATSAPP_WEBHOOK_ENABLED') === 'true'
    && /^\d+$/.test(env('WHATSAPP_WABA_ID'))
    && /^\d+$/.test(env('WHATSAPP_WEBHOOK_PHONE_NUMBER_ID'))
    && env('WHATSAPP_META_APP_SECRET').length >= 16
    && env('WHATSAPP_WEBHOOK_VERIFY_TOKEN').length >= 24
    && /^https:\/\//.test(env('SUPABASE_URL'))
    && Boolean(env('SUPABASE_SERVICE_ROLE_KEY'));
}

// Webhook callback GET is for Meta's verification challenge only, not for browsers.
function verifyChallenge(url: URL): Response {
  if (!ready()) return respond(503, 'Not configured');
  const challenge = url.searchParams.get('hub.challenge') || '';
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  if (mode !== 'subscribe' || !token
      || token !== env('WHATSAPP_WEBHOOK_VERIFY_TOKEN')
      || !/^[\w-]{1,512}$/.test(challenge)) return respond(403, 'Forbidden');
  return respond(200, challenge);
}

async function appendEvents(
  tableName: 'whatsapp_inbound_messages' | 'whatsapp_message_statuses',
  events: unknown[],
  columns: string,
): Promise<void> {
  if (!events.length) return;
  const url = new URL('/rest/v1/' + tableName, env('SUPABASE_URL'));
  url.searchParams.set('on_conflict', columns);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY'),
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(events),
  });
  if (!response.ok) throw new Error('Webhook persistence failed: ' + response.status);
}

// Meta retries non-2xx deliveries. All writes are idempotent, so never ACK an
// event before it has been committed. No raw payload, OTP, token, or phone log.
async function receiveWebhook(request: Request): Promise<Response> {
  if (!ready()) return respond(503, 'Not configured');
  const length = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(length) || length > MAX_WEBHOOK_BYTES) return respond(413, 'Too large');
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(await request.arrayBuffer());
  } catch {
    return respond(400, 'Bad request');
  }
  if (raw.byteLength > MAX_WEBHOOK_BYTES) return respond(413, 'Too large');
  const valid = await validWhatsAppSignature(
    raw,
    request.headers.get('x-hub-signature-256'),
    env('WHATSAPP_META_APP_SECRET'),
  );
  if (!valid) return respond(401, 'Unauthorized');

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return respond(400, 'Bad request');
  }

  const data = normalizeWhatsAppEvents(payload, {
    wabaId: env('WHATSAPP_WABA_ID'),
    phoneNumberId: env('WHATSAPP_WEBHOOK_PHONE_NUMBER_ID'),
  });
  try {
    await appendEvents(
      'whatsapp_inbound_messages',
      data.messages,
      'phone_number_id,provider_message_id',
    );
    await appendEvents(
      'whatsapp_message_statuses',
      data.statuses,
      'phone_number_id,provider_message_id,delivery_status,occurred_at',
    );
  } catch {
    // Details stay inside server logs without any message or phone content.
    return respond(503, 'Try again');
  }
  return respond(200, 'EVENT_RECEIVED');
}

Deno.serve((request: Request) => {
  const url = new URL(request.url);
  if (request.method === 'GET') return verifyChallenge(url);
  if (request.method === 'POST') return receiveWebhook(request);
  return respond(405, 'Method not allowed');
});
