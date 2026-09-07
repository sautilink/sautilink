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
        user?: { phone?: string };
        sms?: { otp?: string };
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Invalid webhook signature.');
}

function normalizePhone(value: unknown) {
  const phone = String(value || '').trim();
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : '';
}

function normalizeOtp(value: unknown) {
  const otp = String(value || '').replace(/\D/g, '');
  return /^\d{6,10}$/.test(otp) ? otp : '';
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
      to: phone.slice(1),
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
    console.error('WhatsApp OTP delivery failed', {
      status: response.status,
      requestId: requestId.slice(0, 96),
    });
    throw new Error('WhatsApp delivery failed.');
  }
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
    return json(request, 200, { ok: true, data: { enabled: whatsappReady() } });
  }

  if (request.method !== 'POST') {
    return json(request, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
  }

  if (!whatsappReady()) {
    return json(request, 503, { ok: false, error: { code: 'WHATSAPP_OTP_NOT_READY' } });
  }

  const payload = await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  let event: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    event = verifyHook(payload, headers);
  } catch {
    return json(request, 401, { ok: false, error: { code: 'INVALID_HOOK_SIGNATURE' } });
  }

  const phone = normalizePhone(event?.user?.phone);
  const otp = normalizeOtp(event?.sms?.otp);
  if (!phone || !otp) {
    return json(request, 400, { ok: false, error: { code: 'INVALID_OTP_EVENT' } });
  }

  try {
    await sendWhatsAppOtp(phone, otp);
    return json(request, 200, {});
  } catch {
    return json(request, 502, { ok: false, error: { code: 'WHATSAPP_DELIVERY_FAILED' } });
  }
});
