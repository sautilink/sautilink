const DEFAULT_OTP_LENGTH = 8;
const MAX_BODY_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 8000;

const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "support", "security", "sautilink",
  "cloudengine", "official", "api", "help", "about", "settings", "login",
  "signup", "account", "privacy", "terms", "contact", "waitlist",
]);

const EXACT_ALLOWED_ORIGINS = new Set([
  "https://sautilink.com",
  "https://www.sautilink.com",
  "https://sautilink.workers.dev",
  "https://test.sautilink.com",
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

function headers(origin) {
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

function json(origin, status, body) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

function ok(origin, data, status = 200) {
  return json(origin, status, { ok: true, data });
}

function fail(origin, code, message, status = 400) {
  return json(origin, status, { ok: false, error: { code, message } });
}

function config() {
  const url = String(Deno.env.get("SUPABASE_URL") || "").trim().replace(/\/$/, "");
  const anonKey = String(Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
  const serviceKey = String(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "",
  ).trim();
  return { url, anonKey, serviceKey, ready: /^https:\/\//.test(url) && Boolean(anonKey) && Boolean(serviceKey) };
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = { message: text }; }
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, reason: error?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

async function authCall(path, options = {}) {
  const cfg = config();
  return request(`${cfg.url}/auth/v1/${path}`, {
    ...options,
    headers: {
      apikey: cfg.anonKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      ...(options.headers || {}),
    },
  });
}

async function adminRest(path, options = {}) {
  const cfg = config();
  return request(`${cfg.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase().replace(/^@+/, "");
}

function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9._]{2,29}$/.test(username)) {
    return { ok: false, username, message: "Username must be 3–30 characters and use lowercase letters, numbers, dots, or underscores." };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { ok: false, username, message: "That username is reserved by SautiLink." };
  }
  return { ok: true, username };
}

function validateEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    ? { ok: true, email }
    : { ok: false, email, message: "Enter a valid email address." };
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `Sl!${value}9a`;
}

function providerError(result, fallback) {
  const code = String(result?.body?.error_code || result?.body?.code || "").toLowerCase();
  const message = String(result?.body?.msg || result?.body?.message || "");
  if (result?.status === 429 || code.includes("rate_limit") || /rate limit|too many/i.test(message)) {
    return { code: "RATE_LIMITED", message: "Please wait before requesting another verification code.", status: 429 };
  }
  if (/expired|invalid.*token|token.*invalid/i.test(message)) {
    return { code: "INVALID_CODE", message: "That verification code is invalid or has expired. Request a new code and try again.", status: 400 };
  }
  if (result?.reason === "timeout" || result?.status === 0) {
    return { code: "SERVICE_UNAVAILABLE", message: "Email verification is temporarily unavailable. Please try again shortly.", status: 503 };
  }
  return { code: "REQUEST_FAILED", message: fallback, status: result?.status >= 400 && result?.status < 500 ? result.status : 503 };
}

async function usernameOwner(username) {
  const result = await adminRest(
    `account_profiles?username=eq.${encodeURIComponent(username)}&select=id,username&limit=1`,
    { method: "GET" },
  );
  if (!result.ok) return { ok: false, result };
  const profile = Array.isArray(result.body) ? result.body[0] || null : null;
  return { ok: true, profile };
}

async function profileForUser(id) {
  const result = await adminRest(
    `account_profiles?id=eq.${encodeURIComponent(id)}&select=id,username&limit=1`,
    { method: "GET" },
  );
  if (!result.ok) return { ok: false, result };
  return { ok: true, profile: Array.isArray(result.body) ? result.body[0] || null : null };
}

async function checkUsernameAction(origin, body) {
  const checked = validateUsername(body?.username);
  if (!checked.ok) return fail(origin, "INVALID_USERNAME", checked.message, 400);
  const owner = await usernameOwner(checked.username);
  if (!owner.ok) return fail(origin, "SERVICE_UNAVAILABLE", "Username availability is temporarily unavailable.", 503);
  return ok(origin, { username: checked.username, available: !owner.profile });
}

async function startAction(origin, body) {
  if (String(body?.website || "").trim()) return ok(origin, { sent: true, otpLength: DEFAULT_OTP_LENGTH, resendAfter: 60 });
  const username = validateUsername(body?.username);
  const email = validateEmail(body?.email);
  if (!username.ok || !email.ok) {
    return fail(origin, username.message ? "INVALID_USERNAME" : "INVALID_EMAIL", username.message || email.message, 400);
  }

  const owner = await usernameOwner(username.username);
  if (!owner.ok) return fail(origin, "SERVICE_UNAVAILABLE", "Username availability is temporarily unavailable.", 503);
  if (owner.profile) return fail(origin, "USERNAME_TAKEN", "That username is already taken. Choose another username.", 409);

  const signup = await authCall("signup", {
    method: "POST",
    body: JSON.stringify({
      email: email.email,
      password: randomPassword(),
      data: {
        username: username.username,
        full_name: username.username,
        email_updates: false,
        waitlist_intent: true,
      },
    }),
  });

  if (signup.ok && signup.body?.user && Array.isArray(signup.body.user.identities) && signup.body.user.identities.length === 0) {
    return fail(origin, "EMAIL_IN_USE", "This email is already connected to a SautiLink Account. Use your existing SautiLink Account email and username.", 409);
  }
  if (!signup.ok) {
    const error = providerError(signup, "We could not send a verification code to that email address.");
    return fail(origin, error.code, error.message, error.status);
  }

  return ok(origin, { sent: true, otpLength: DEFAULT_OTP_LENGTH, resendAfter: 60 }, 201);
}

async function resendAction(origin, body) {
  const username = validateUsername(body?.username);
  const email = validateEmail(body?.email);
  if (!username.ok || !email.ok) {
    return fail(origin, username.message ? "INVALID_USERNAME" : "INVALID_EMAIL", username.message || email.message, 400);
  }

  const owner = await usernameOwner(username.username);
  if (!owner.ok) return fail(origin, "SERVICE_UNAVAILABLE", "Username availability is temporarily unavailable.", 503);
  if (owner.profile) return fail(origin, "USERNAME_TAKEN", "That username is no longer available. Choose another username.", 409);

  const resent = await authCall("resend", {
    method: "POST",
    body: JSON.stringify({ type: "signup", email: email.email }),
  });
  if (!resent.ok) {
    const error = providerError(resent, "We could not send another verification code yet.");
    return fail(origin, error.code, error.message, error.status);
  }
  return ok(origin, { sent: true, resendAfter: 60 });
}

async function ensureProfile(user, username) {
  const existing = await profileForUser(user.id);
  if (!existing.ok) return { ok: false, status: 503, reason: "profile_unavailable" };
  if (existing.profile) {
    return existing.profile.username === username
      ? { ok: true, existing: true, profile: existing.profile }
      : { ok: false, status: 409, reason: "username_mismatch", profile: existing.profile };
  }

  const owner = await usernameOwner(username);
  if (!owner.ok) return { ok: false, status: 503, reason: "profile_unavailable" };
  if (owner.profile && owner.profile.id !== user.id) return { ok: false, status: 409, reason: "username_taken" };

  const inserted = await adminRest("account_profiles", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      id: user.id,
      username,
      full_name: username,
      email_updates: false,
      whatsapp_updates: false,
    }),
  });
  if (!inserted.ok) {
    return { ok: false, status: inserted.status === 409 ? 409 : 503, reason: inserted.status === 409 ? "username_taken" : "profile_unavailable" };
  }
  return { ok: true, existing: false, profile: Array.isArray(inserted.body) ? inserted.body[0] || null : null };
}

async function ensureWaitlistMember(userId) {
  const now = new Date().toISOString();
  const result = await adminRest("waitlist_members?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ id: userId, status: "waiting", source: "sautilink.com", updated_at: now }),
  });
  if (!result.ok) return { ok: false, result };
  return { ok: true, member: Array.isArray(result.body) ? result.body[0] || null : null };
}

async function verifyAction(origin, body) {
  const username = validateUsername(body?.username);
  const email = validateEmail(body?.email);
  const code = String(body?.code || "").trim();
  if (!username.ok || !email.ok) {
    return fail(origin, username.message ? "INVALID_USERNAME" : "INVALID_EMAIL", username.message || email.message, 400);
  }
  if (!new RegExp(`^\\d{${DEFAULT_OTP_LENGTH}}$`).test(code)) {
    return fail(origin, "INVALID_CODE", `Enter the ${DEFAULT_OTP_LENGTH}-digit verification code.`, 400);
  }

  const verified = await authCall("verify", {
    method: "POST",
    body: JSON.stringify({ type: "email", email: email.email, token: code }),
  });
  if (!verified.ok || !verified.body?.user?.id || !verified.body?.user?.email_confirmed_at) {
    const error = providerError(verified, "That verification code could not be accepted.");
    return fail(origin, error.code === "REQUEST_FAILED" ? "INVALID_CODE" : error.code, error.message, error.status);
  }

  const user = verified.body.user;
  const profile = await ensureProfile(user, username.username);
  if (!profile.ok) {
    if (verified.body?.access_token) await authCall("logout?scope=local", { method: "POST", accessToken: verified.body.access_token });
    if (profile.reason === "username_taken") return fail(origin, "USERNAME_TAKEN", "That username was just claimed. Choose another username.", 409);
    if (profile.reason === "username_mismatch") return fail(origin, "ACCOUNT_USERNAME_MISMATCH", `This email already belongs to @${profile.profile.username}. Use that username to join the waitlist.`, 409);
    return fail(origin, "SERVICE_UNAVAILABLE", "Your email was verified, but profile setup is temporarily unavailable. Please try again.", 503);
  }

  const member = await ensureWaitlistMember(user.id);
  if (!member.ok) {
    if (verified.body?.access_token) await authCall("logout?scope=local", { method: "POST", accessToken: verified.body.access_token });
    return fail(origin, "SERVICE_UNAVAILABLE", "Your email was verified, but the waitlist is temporarily unavailable. Please try again.", 503);
  }

  if (verified.body?.access_token) await authCall("logout?scope=local", { method: "POST", accessToken: verified.body.access_token });
  return ok(origin, {
    joined: true,
    username: username.username,
    email: user.email || email.email,
    joinedAt: member.member?.joined_at || new Date().toISOString(),
  });
}

Deno.serve(async (request) => {
  const origin = allowedOrigin(request.headers.get("Origin"));
  if (!origin) return json("null", 403, { ok: false, error: { code: "ORIGIN_NOT_ALLOWED", message: "This waitlist request is not allowed from the current website." } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (request.method !== "POST") return fail(origin, "METHOD_NOT_ALLOWED", "Use POST for waitlist requests.", 405);
  if (!config().ready) return fail(origin, "SERVICE_UNAVAILABLE", "The waitlist service is not configured yet.", 503);

  const contentLength = Number.parseInt(request.headers.get("Content-Length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return fail(origin, "REQUEST_TOO_LARGE", "The request is too large.", 413);

  let body = null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return fail(origin, "REQUEST_TOO_LARGE", "The request is too large.", 413);
    body = text ? JSON.parse(text) : {};
  } catch {
    return fail(origin, "INVALID_REQUEST", "Send a valid JSON request.", 400);
  }

  switch (String(body?.action || "")) {
    case "check_username": return checkUsernameAction(origin, body);
    case "start": return startAction(origin, body);
    case "resend": return resendAction(origin, body);
    case "verify": return verifyAction(origin, body);
    default: return fail(origin, "INVALID_ACTION", "Choose a valid waitlist action.", 400);
  }
});

