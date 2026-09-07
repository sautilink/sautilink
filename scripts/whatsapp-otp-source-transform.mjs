import { basename } from 'node:path';

export function transformWhatsAppOtpSource(filePath, source) {
  if (basename(filePath) !== 'app.js') return source;

  const anchor = "const byId = (id) => document.getElementById(id);";
  if (!source.includes(anchor)) {
    throw new Error('WhatsApp OTP transform could not find the SautiLink auth client anchor.');
  }

  const bridge = [
    "Object.defineProperty(window, '__sautilinkSupabaseAuthClient', { value: supabase, configurable: false, writable: false });",
    "window.dispatchEvent(new CustomEvent('sautilink:auth-client-ready', { detail: supabase }));",
    '',
  ].join('\n');

  return source.replace(anchor, `${bridge}${anchor}`);
}
