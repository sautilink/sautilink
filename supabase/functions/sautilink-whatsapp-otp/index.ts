import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const ALLOWED_ORIGINS = new Set([
  'https://sautilink.com',
  'https://www.sautilink.com',
  'https://test.sautilink.com',
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://sautilink.com';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(request: Request, status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function env(name: string) {
  return String(Deno.env.get(name) || '').trim();
}

function whatsappReady() {
  return env('WHATSAPP_OTP_ENABLED') === 'true'
    && /^v\d+\.\d+$/.test(env('WHATSAPP_GRAPH_API_VERSION'))
    && /^\d+$/.test(env('WHATSAPP_PHONE_NUMBER_ID'))
    && Boolean(env('WHATSAPP_ACCESS_TOKEN'))
    && /^[a-z0-9_]+$/i.test(env('WHATSAPP_OTP_TEMPLATE_NAME'))
    && /^[a-z]{2}(?:_[A-Z]{2})?$/.test(env('WHATSAPP_OTP_TEMPLATE_LANGUAGE') || 'en_US')
    && Boolean(env('SEND_SMS_HOOK_SECRET'));
}

function smsReady() {
  return env('SWALA_SMS_ENABLED') === 'true'
    && Boolean(env('SWALA_SMS_API_KEY'))
    && env('SWALA_SMS_SENDER_ID') === 'SautiLink'
    && Boolean(env('SEND_SMS_HOOK_SECRET'));
}

function phoneOtpReady() {
  return smsReady() || whatsappReady();
}

function hookSecrets() {
  return env('SEND_SMS_HOOK_SECRET')
    .split('|')
    .map((secret) => secret.trim())
    .filter(Boolean)
    .map((secret) => secret.replace(/^v1,whsec_/, ''));
}

function verifyHook(payload: string, headers: Record<string, string>) {
  let lastError: unknown = null;
  for (const secret of hookSecrets()) {
    try {
      return new Webhook(secret).verify(payload, headers) as {
        user?: { phone?: string; new_phone?: string; user_metadata?: Record<string, unknown> };
        sms?: { otp?: string; phone?: string };
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Invalid webhook signature.');
}

function normalizePhone(value: unknown) {
  const raw = String(value || '').trim().replace(/\s/g, '');
  const phone = raw.startsWith('+') ? raw.slice(1) : raw;
  return /^[1-9]\d{7,14}$/.test(phone) ? phone : '';
}

function normalizeOtp(value: unknown) {
  const otp = String(value || '').replace(/\D/g, '');
  return /^\d{6,10}$/.test(otp) ? otp : '';
}

function sanitizeMetaText(value: unknown) {
  return String(value || '')
    .replace(/\b\d{4,}\b/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 240);
}

class DeliveryRejected extends Error {}

async function readMetaError(response: Response) {
  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    return {
      code: null,
      subcode: null,
      type: '',
      message: '',
      details: '',
    };
  }

  const error = (payload?.error && typeof payload.error === 'object')
    ? payload.error as Record<string, unknown>
    : {};
  const errorData = (error?.error_data && typeof error.error_data === 'object')
    ? error.error_data as Record<string, unknown>
    : {};

  return {
    code: typeof error.code === 'number' ? error.code : null,
    subcode: typeof error.error_subcode === 'number' ? error.error_subcode : null,
    type: sanitizeMetaText(error.type),
    message: sanitizeMetaText(error.message),
    details: sanitizeMetaText(errorData.details),
  };
}

async function sendWhatsAppOtp(phone: string, otp: string) {
  const version = env('WHATSAPP_GRAPH_API_VERSION');
  const phoneNumberId = env('WHATSAPP_PHONE_NUMBER_ID');
  const accessToken = env('WHATSAPP_ACCESS_TOKEN');
  const templateName = env('WHATSAPP_OTP_TEMPLATE_NAME');
  const language = env('WHATSAPP_OTP_TEMPLATE_LANGUAGE') || 'en_US';

  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: otp }],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: otp }],
          },
        ],
      },
    }),
  });

  if (!response.ok) {
    const requestId = response.headers.get('x-fb-trace-id') || '';
    const metaError = await readMetaError(response);
    console.error('WhatsApp OTP delivery failed', {
      status: response.status,
      requestId: sanitizeMetaText(requestId),
      metaCode: metaError.code,
      metaSubcode: metaError.subcode,
      metaType: metaError.type,
      metaMessage: metaError.message,
      metaDetails: metaError.details,
    });
    if (response.status >= 400 && response.status < 500) {
      throw new DeliveryRejected('WhatsApp delivery rejected.');
    }
    throw new Error('WhatsApp delivery status uncertain.');
  }
}

async function sendSwalaSmsOtp(phone: string, otp: string, webhookId: string) {
  const body = `Your SautiLink verification code is ${otp}. Do not share this code.`;
  const idempotencyBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${webhookId}:${phone}:${otp}`),
  );
  const idempotencyKey = `sautilink-otp-${Array.from(new Uint8Array(idempotencyBytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch('https://swalasms.com/api/v1/sms/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env('SWALA_SMS_API_KEY')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        recipient: `+${phone}`,
        sender_id: env('SWALA_SMS_SENDER_ID'),
        body,
      }),
    });
    const result = await response.json().catch(() => null);
    if (![200, 202].includes(response.status) || result?.success === false) {
      console.error('SMS OTP was not queued', { status: response.status });
      if (response.status >= 500) throw new Error('SMS delivery status uncertain.');
      if (response.status >= 400 && response.status < 500 || result?.success === false) {
        throw new DeliveryRejected('SMS delivery rejected.');
      }
      throw new Error('SMS delivery status uncertain.');
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverPhoneOtp(phone: string, otp: string, preference: unknown, webhookId: string) {
  // A user's delivery preference is never used for authorization. Supabase still
  // owns OTP generation, expiry and verification for both transports.
  const selected = preference === 'sms' || preference === 'whatsapp'
    ? preference
    : whatsappReady() ? 'whatsapp' : 'sms';
  const channels = selected === 'whatsapp' ? ['whatsapp', 'sms'] : ['sms'];
  for (const channel of channels) {
    if (channel === 'sms' && !smsReady()) continue;
    if (channel === 'whatsapp' && !whatsappReady()) continue;
    try {
      if (channel === 'sms') await sendSwalaSmsOtp(phone, otp, webhookId);
      else await sendWhatsAppOtp(phone, otp);
      return;
    } catch (error) {
      // A network timeout or server error may occur after the provider queued
      // the message. Fall back only when the provider explicitly rejects it.
      if (!(error instanceof DeliveryRejected)) throw error;
    }
  }
  throw new Error('Phone code delivery failed.');
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(request, 403, { ok: false, error: { code: 'ORIGIN_NOT_ALLOWED' } });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method === 'GET') {
    return json(request, 200, { ok: true, data: {
      enabled: phoneOtpReady(),
      channels: { sms: smsReady(), whatsapp: whatsappReady() },
    } });
  }

  if (request.method !== 'POST') {
    return json(request, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
  }

  if (!phoneOtpReady()) {
    return json(request, 503, { ok: false, error: { code: 'PHONE_OTP_NOT_READY' } });
  }

  if (Number(request.headers.get('content-length') || 0) > 8192) {
    return json(request, 413, { ok: false, error: { code: 'HOOK_PAYLOAD_TOO_LARGE' } });
  }
  const payload = await request.text();
  if (new TextEncoder().encode(payload).byteLength > 8192) {
    return json(request, 413, { ok: false, error: { code: 'HOOK_PAYLOAD_TOO_LARGE' } });
  }
  const headers = Object.fromEntries(request.headers.entries());
  let event: {
    user?: { phone?: string; new_phone?: string; user_metadata?: Record<string, unknown> };
    sms?: { otp?: string; phone?: string };
  };
  try {
    event = verifyHook(payload, headers);
  } catch {
    return json(request, 401, { ok: false, error: { code: 'INVALID_HOOK_SIGNATURE' } });
  }

  const phone = normalizePhone(
    event?.sms?.phone || event?.user?.new_phone || event?.user?.phone,
  );
  const otp = normalizeOtp(event?.sms?.otp);
  if (!phone || !otp) {
    return json(request, 400, { ok: false, error: { code: 'INVALID_OTP_EVENT' } });
  }

  try {
    await deliverPhoneOtp(phone, otp, event?.user?.user_metadata?.sautilink_phone_otp_channel, request.headers.get('webhook-id') || '');
    return json(request, 200, {});
  } catch {
    return json(request, 502, { ok: false, error: { code: 'PHONE_DELIVERY_FAILED' } });
  }
});
