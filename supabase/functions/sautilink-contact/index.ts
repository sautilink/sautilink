const MAX_BODY_BYTES = 16_384;
const MAX_MESSAGES_PER_HOUR = 5;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_TOPICS = new Set(["general", "support", "privacy", "partnership", "media"]);

const EXACT_ALLOWED_ORIGINS = new Set([
  "https://sautilink.com",
  "https://www.sautilink.com",
  "https://sautilink.workers.dev",
  "http://localhost:8787",
  "http://localhost:3000",
  "http://127.0.0.1:8787",
]);

function allowedOrigin(value) {
  const origin = String(value || "").trim().toLowerCase();
  if (EXACT_ALLOWED_ORIGINS.has(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.sautilink\.pages\.dev$/.test(origin)) return origin;
  return "";
}

function responseHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
}

function json(origin, status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders(origin), ...extraHeaders },
  });
}

function ok(origin, data, status = 200) {
  return json(origin, status, { ok: true, data });
}

function fail(origin, code, message, status = 400, extraHeaders = {}) {
  return json(origin, status, { ok: false, error: { code, message } }, extraHeaders);
}

function config() {
  const url = String(Deno.env.get("SUPABASE_URL") || "").trim().replace(/\/$/, "");
  const serviceKey = String(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "",
  ).trim();
  return { url, serviceKey, ready: /^https:\/\//.test(url) && Boolean(serviceKey) };
}

async function adminRest(path, options = {}) {
  const cfg = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${cfg.url}/rest/v1/${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        apikey: cfg.serviceKey,
        Authorization: `Bearer ${cfg.serviceKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = null; }
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, reason: error?.name === "AbortError" ? "timeout" : "network", body: null };
  } finally {
    clearTimeout(timer);
  }
}

function cleanText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

function validate(body) {
  const name = cleanText(body?.name).replace(/\s+/g, " ");
  const email = cleanText(body?.email).toLowerCase();
  const topic = cleanText(body?.topic).toLowerCase();
  const subjectValue = cleanText(body?.subject).replace(/\s+/g, " ");
  const subject = subjectValue || null;
  const message = cleanText(body?.message);

  if (name.length < 2 || name.length > 100) return { ok: false, message: "Enter your full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return { ok: false, message: "Enter a valid email address." };
  if (!ALLOWED_TOPICS.has(topic)) return { ok: false, message: "Choose a contact topic." };
  if (subject && subject.length > 140) return { ok: false, message: "Keep the subject under 140 characters." };
  if (message.length < 10 || message.length > 3000) return { ok: false, message: "Your message must be between 10 and 3,000 characters." };
  return { ok: true, data: { name, email, topic, subject, message } };
}

async function requestFingerprint(req, secret) {
  const forwarded = String(req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const network = String(req.headers.get("cf-connecting-ip") || forwarded || "unknown");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`sautilink-contact:${network}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = allowedOrigin(req.headers.get("origin"));
  if (!origin) return fail("", "ORIGIN_NOT_ALLOWED", "This request origin is not allowed.", 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (req.method !== "POST") return fail(origin, "METHOD_NOT_ALLOWED", "Use POST for contact messages.", 405, { Allow: "POST, OPTIONS" });

  const contentType = String(req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return fail(origin, "UNSUPPORTED_MEDIA_TYPE", "Send JSON content.", 415);
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return fail(origin, "PAYLOAD_TOO_LARGE", "The message is too large.", 413);

  const cfg = config();
  if (!cfg.ready) return fail(origin, "SERVICE_UNAVAILABLE", "Contact is temporarily unavailable.", 503);

  let raw = "";
  let body = null;
  try {
    raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return fail(origin, "PAYLOAD_TOO_LARGE", "The message is too large.", 413);
    body = JSON.parse(raw);
  } catch {
    return fail(origin, "INVALID_JSON", "Send a valid contact message.", 400);
  }

  if (cleanText(body?.website)) return ok(origin, { received: true }, 202);
  const checked = validate(body);
  if (!checked.ok) return fail(origin, "INVALID_SUBMISSION", checked.message, 400);

  const fingerprint = await requestFingerprint(req, cfg.serviceKey);
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await adminRest(
    `contact_submissions?request_fingerprint=eq.${fingerprint}&created_at=gte.${encodeURIComponent(cutoff)}&select=id&limit=${MAX_MESSAGES_PER_HOUR + 1}`,
    { method: "GET" },
  );
  if (!recent.ok) return fail(origin, "SERVICE_UNAVAILABLE", "Contact is temporarily unavailable. Please try again shortly.", 503);
  if (Array.isArray(recent.body) && recent.body.length >= MAX_MESSAGES_PER_HOUR) {
    return fail(origin, "RATE_LIMITED", "You have sent several messages recently. Please wait before sending another.", 429, { "Retry-After": "3600" });
  }

  const inserted = await adminRest("contact_submissions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      ...checked.data,
      request_fingerprint: fingerprint,
      source: "sautilink.com/contact",
    }),
  });
  if (!inserted.ok) return fail(origin, "SERVICE_UNAVAILABLE", "We could not save your message. Please try again shortly.", 503);

  return ok(origin, { received: true }, 201);
});
