// Pure, runtime-neutral Meta WhatsApp webhook validation and event normalization.
// Intentionally excludes secrets, database access, logging, and outbound sending.
const MAX_MESSAGE_ID = 255;
const WHATSAPP_PHONE = /^[1-9]\d{6,15}$/;
const SAFE_ID = /^[a-zA-Z0-9_.:+/=-]{8,255}$/;
const ALLOWED_TYPES = new Set([
  'text', 'image', 'video', 'audio', 'document', 'sticker', 'location',
  'contacts', 'interactive', 'button', 'reaction', 'unknown',
]);
const ALLOWED_STATUSES = new Set(['sent', 'delivered', 'read', 'failed', 'deleted']);

function bounded(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function safeId(value) {
  const id = bounded(value, MAX_MESSAGE_ID);
  return SAFE_ID.test(id) ? id : '';
}

function dateFromSeconds(value) {
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 946684800 && seconds <= 4102444800
    ? new Date(seconds * 1000).toISOString()
    : null;
}

function contentForMessage(message) {
  switch (message.type) {
    case 'text':
      return bounded(message.text?.body, 4096);
    case 'button':
      return bounded(message.button?.text, 4096);
    case 'interactive':
      return bounded(
        message.interactive?.button_reply?.title
        || message.interactive?.list_reply?.title,
        4096,
      );
    case 'image':
    case 'video':
    case 'document':
      return bounded(message[message.type]?.caption, 4096);
    default:
      return '';
  }
}

export async function validWhatsAppSignature(body, signatureHeader, appSecret) {
  if (typeof appSecret !== 'string' || appSecret.length < 16) return false;
  if (typeof signatureHeader !== 'string' || !/^sha256=[\da-f]{64}$/i.test(signatureHeader)) return false;
  const raw = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  if (!(raw instanceof Uint8Array) && !(raw instanceof ArrayBuffer)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, raw));
  const givenHex = signatureHeader.slice('sha256='.length).toLowerCase();
  let difference = 0;
  for (let i = 0; i < digest.length; i += 1) {
    difference |= digest[i] ^ Number.parseInt(givenHex.slice(i * 2, i * 2 + 2), 16);
  }
  return difference === 0;
}

export function normalizeWhatsAppEvents(payload, expected) {
  const result = { messages: [], statuses: [] };
  if (!payload || typeof payload !== 'object'
      || payload.object !== 'whatsapp_business_account'
      || !Array.isArray(payload.entry)) return result;

  const wabaId = bounded(expected?.wabaId, 40);
  const phoneNumberId = bounded(expected?.phoneNumberId, 40);
  if (!/^\d+$/.test(wabaId) || !/^\d+$/.test(phoneNumberId)) return result;

  for (const entry of payload.entry.slice(0, 40)) {
    if (String(entry?.id || '') !== wabaId || !Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes.slice(0, 40)) {
      if (change?.field !== 'messages') continue;
      const value = change?.value;
      if (!value || String(value.metadata?.phone_number_id || '') !== phoneNumberId) continue;
      for (const message of (Array.isArray(value.messages) ? value.messages : []).slice(0, 100)) {
        const providerMessageId = safeId(message?.id);
        const senderWaId = bounded(message?.from, 24);
        if (!providerMessageId || !WHATSAPP_PHONE.test(senderWaId)) continue;
        const occurredAt = dateFromSeconds(message.timestamp);
        if (!occurredAt) continue;
        const messageType = ALLOWED_TYPES.has(message.type) ? message.type : 'unknown';
        result.messages.push({
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          provider_message_id: providerMessageId,
          sender_wa_id: senderWaId,
          message_type: messageType,
          text_body: contentForMessage(message),
          occurred_at: occurredAt,
        });
      }
      for (const status of (Array.isArray(value.statuses) ? value.statuses : []).slice(0, 100)) {
        const providerMessageId = safeId(status?.id);
        const recipientWaId = bounded(status?.recipient_id, 24);
        const deliveryStatus = bounded(status?.status, 20);
        if (!providerMessageId || !WHATSAPP_PHONE.test(recipientWaId)
            || !ALLOWED_STATUSES.has(deliveryStatus)) continue;
        const occurredAt = dateFromSeconds(status.timestamp);
        if (!occurredAt) continue;
        result.statuses.push({
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          provider_message_id: providerMessageId,
          recipient_wa_id: recipientWaId,
          delivery_status: deliveryStatus,
          occurred_at: occurredAt,
        });
      }
    }
  }
  return result;
}
