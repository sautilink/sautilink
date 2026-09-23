import { buildPushPayload } from "@block65/webcrypto-web-push";

const MAX_BODY_BYTES = 2048;
const REQUEST_TIMEOUT_MS = 10_000;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const WEB_PUSH_PUBLIC_KEY = "BDt6BePKFcUKr9rFR33MSDJh2uXMsO2k-Bje0-ryABGqC4k7pj0W7QBsk4njhMAu7Bb2nkWfLKI1_bN6UCOFrnU";
const WEB_PUSH_SUBJECT = "mailto:support@sautilink.com";
const WEB_PUSH_ENDPOINT_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);
const TERMINAL_QUEUE_STATES = new Set(["delivered", "no_tokens", "skipped"]);

let cachedGoogleToken = { value: "", expiresAt: 0 };
let cachedVapidPrivateKey = { value: "", expiresAt: 0 };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSafeWebPushEndpoint(value: string) {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === "https:" && WEB_PUSH_ENDPOINT_HOSTS.has(endpoint.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function decodeFirebaseServiceAccount() {
  const encoded = clean(Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON_BASE64")).replace(/\s+/g, "");
  if (!encoded) throw new Error("firebase_service_account_missing");

  let parsed: Record<string, unknown>;
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("firebase_service_account_invalid");
  }

  const projectId = clean(parsed.project_id);
  const clientEmail = clean(parsed.client_email);
  const privateKey = clean(parsed.private_key);
  if (!projectId || !clientEmail || !privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("firebase_service_account_incomplete");
  }

  return { projectId, clientEmail, privateKey };
}

function config() {
  const url = clean(Deno.env.get("SUPABASE_URL")).replace(/\/$/, "");
  const serviceKey = clean(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY"),
  );
  const firebase = decodeFirebaseServiceAccount();
  if (!/^https:\/\//.test(url) || !serviceKey) throw new Error("supabase_admin_config_missing");
  return { url, serviceKey, firebase };
}

async function adminRest(path: string, options: RequestInit = {}) {
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
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      reason: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timer);
  }
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function importPrivateKey(privateKey: string) {
  const normalized = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const keyBytes = Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function googleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken.value && cachedGoogleToken.expiresAt > now + 90) {
    return cachedGoogleToken.value;
  }

  const { firebase } = config();
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlJson({
    iss: firebase.clientEmail,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${claims}`;
  const key = await importPrivateKey(firebase.privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.access_token) {
      throw new Error(`google_oauth_failed:${response.status}`);
    }
    const expiresIn = Number(body.expires_in || 3600);
    cachedGoogleToken = {
      value: String(body.access_token),
      expiresAt: now + Math.max(300, expiresIn),
    };
    return cachedGoogleToken.value;
  } finally {
    clearTimeout(timer);
  }
}

async function patchQueue(queueId: string, values: Record<string, unknown>) {
  return adminRest(`push_delivery_queue?id=eq.${encodeURIComponent(queueId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(values),
  });
}

async function vapidPrivateKey() {
  const now = Date.now();
  if (cachedVapidPrivateKey.value && cachedVapidPrivateKey.expiresAt > now) {
    return cachedVapidPrivateKey.value;
  }
  const result = await adminRest("rpc/get_web_push_vapid_private_key_server_v1", {
    method: "POST",
    body: "{}",
  });
  const value = typeof result.body === "string" ? clean(result.body) : "";
  if (!result.ok || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("vapid_private_key_unavailable");
  }
  cachedVapidPrivateKey = { value, expiresAt: now + 10 * 60_000 };
  return value;
}

async function getActor(actorId: string | null) {
  if (!actorId || !isUuid(actorId)) return null;
  const result = await adminRest(
    `social_profiles?id=eq.${encodeURIComponent(actorId)}&select=username,display_name&limit=1`,
    { method: "GET" },
  );
  if (!result.ok || !Array.isArray(result.body)) return null;
  return result.body[0] || null;
}

function actorName(actor: Record<string, unknown> | null) {
  return clean(actor?.display_name) || (clean(actor?.username) ? `@${clean(actor?.username)}` : "Someone");
}

function memberNoticeCopy(event: string) {
  if (event === "post_removed_author") return "Your post was removed. Tap to review the reason and appeal. Repeated violations may lead to a permanent ban.";
  if (event === "comment_removed_author") return "Your comment was removed. Tap to review the reason and appeal. Repeated violations may lead to a permanent ban.";
  if (event === "post_removed_reporter") return "The post you reported was removed. Thank you for helping SautiLink. Your identity was not shared with the author.";
  if (event === "comment_removed_reporter") return "The comment you reported was removed. Thank you for helping SautiLink. Your identity was not shared with the author.";
  if (event === "visibility_limited_author") return "SautiLink limited the visibility of your content. Tap to review the reason and appeal options.";
  if (event === "appeal_upheld") return "Your moderation appeal was reviewed. The original decision remains in place.";
  if (event === "appeal_reversed") return "Your moderation appeal was successful. SautiLink reversed the original decision.";
  if (event === "verification_approved") return "Your account is now verified. The checkmark is on your profile. Verification may be removed if you violate SautiLink rules.";
  if (event === "verification_action_required") return "Your verification request needs more information. Open SautiLink to review the team message.";
  if (event === "verification_rejected") return "Your verification request was not approved. Open SautiLink to review the reason.";
  return "";
}

async function buildSocialPayload(sourceId: string, recipientId: string) {
  if (!/^\d+$/.test(sourceId)) return null;
  const result = await adminRest(
    `social_notifications?id=eq.${encodeURIComponent(sourceId)}&recipient_id=eq.${encodeURIComponent(recipientId)}&select=id,recipient_id,actor_id,post_id,notification_type,notification_event,moderation_action_id,verification_case_id&limit=1`,
    { method: "GET" },
  );
  if (!result.ok || !Array.isArray(result.body) || !result.body[0]) return null;
  const notification = result.body[0] as Record<string, unknown>;
  const type = clean(notification.notification_type);
  const event = clean(notification.notification_event);
  const moderationActionId = clean(notification.moderation_action_id);
  const actorId = clean(notification.actor_id) || null;
  const actor = await getActor(actorId);
  const name = actorName(actor);
  const username = clean(actor?.username);
  const postId = clean(notification.post_id);

  let body = memberNoticeCopy(event) || "You have a new SautiLink notification.";
  if (!event && type === "follow") body = `${name} followed you.`;
  else if (!event && type === "like") body = `${name} liked your post.`;
  else if (!event && type === "reply") body = `${name} replied to your post.`;
  else if (!event && type === "mention") body = `${name} mentioned you.`;
  else if (!event && type === "reshare") body = `${name} reposted your post.`;

  let route = "/notifications";
  if (["post_removed_author", "comment_removed_author", "visibility_limited_author", "appeal_upheld", "appeal_reversed"].includes(event) && /^\d+$/.test(moderationActionId)) {
    route = `/appeals?action=${encodeURIComponent(moderationActionId)}`;
  } else if (event.startsWith("verification_")) {
    route = "/settings";
  } else if (postId && isUuid(postId)) {
    route = `/post/${postId}`;
  } else if (username && /^[a-z0-9][a-z0-9._]{2,29}$/i.test(username)) {
    route = `/u/${username}`;
  }

  return {
    title: "SautiLink",
    body,
    route,
    type,
    event,
    sourceId,
  };
}

async function buildMessagePayload(sourceId: string, recipientId: string) {
  if (!/^\d+$/.test(sourceId)) return null;
  const messageResult = await adminRest(
    `dm_messages?id=eq.${encodeURIComponent(sourceId)}&select=id,conversation_id,sender_id,deleted_at&limit=1`,
    { method: "GET" },
  );
  if (!messageResult.ok || !Array.isArray(messageResult.body) || !messageResult.body[0]) return null;
  const message = messageResult.body[0] as Record<string, unknown>;
  if (message.deleted_at) return null;

  const conversationId = clean(message.conversation_id);
  const senderId = clean(message.sender_id);
  if (!isUuid(conversationId) || !isUuid(senderId)) return null;
  const conversationResult = await adminRest(
    `dm_conversations?id=eq.${encodeURIComponent(conversationId)}&select=member_one_id,member_two_id&limit=1`,
    { method: "GET" },
  );
  if (!conversationResult.ok || !Array.isArray(conversationResult.body) || !conversationResult.body[0]) return null;
  const conversation = conversationResult.body[0] as Record<string, unknown>;
  const one = clean(conversation.member_one_id);
  const two = clean(conversation.member_two_id);
  const expectedRecipient = senderId === one ? two : one;
  if (expectedRecipient !== recipientId) return null;

  const actor = await getActor(senderId);
  const name = actorName(actor);
  return {
    title: `New message from ${name}`,
    body: `${name} sent you a message.`,
    route: `/messages/${conversationId}`,
    type: "message",
    event: "",
    sourceId,
  };
}

async function sendFcm(token: string, payload: Record<string, string>) {
  const { firebase } = config();
  const accessToken = await googleAccessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(firebase.projectId)}/messages:send`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data: {
              route: payload.route,
              type: payload.type,
              event: payload.event || "",
              source_id: payload.sourceId,
            },
            android: {
              priority: "high",
              notification: { channel_id: "sautilink_updates" },
            },
          },
        }),
      },
    );
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: { error: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network" },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sendWebPush(subscription: Record<string, unknown>, payload: Record<string, string>) {
  const endpoint = clean(subscription.endpoint);
  const p256dh = clean(subscription.p256dh);
  const auth = clean(subscription.auth);
  if (!isSafeWebPushEndpoint(endpoint) || !p256dh || !auth) {
    return { ok: false, status: 410, body: { error: "invalid_subscription" } };
  }

  try {
    const request = await buildPushPayload(
      {
        data: JSON.stringify({
          title: payload.title,
          body: payload.body,
          route: payload.route,
          type: payload.type,
          event: payload.event || "",
          source_id: payload.sourceId,
        }),
        options: { ttl: 300, urgency: "high" },
      },
      { endpoint, keys: { p256dh, auth } },
      {
        subject: WEB_PUSH_SUBJECT,
        publicKey: WEB_PUSH_PUBLIC_KEY,
        privateKey: await vapidPrivateKey(),
      },
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, { ...request, signal: controller.signal });
      return { ok: response.ok, status: response.status, body: await response.text().catch(() => "") };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: { error: error instanceof DOMException && error.name === "AbortError" ? "timeout" : clean(error) || "network" },
    };
  }
}

function isPermanentTokenFailure(result: { status: number; body: unknown }) {
  const text = JSON.stringify(result.body || {}).toUpperCase();
  return text.includes("UNREGISTERED") || text.includes("REGISTRATION_TOKEN_NOT_REGISTERED");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json(413, { ok: false, error: "payload_too_large" });

  try {
    config();
  } catch (error) {
    return json(503, { ok: false, error: error instanceof Error ? error.message : "configuration_error" });
  }

  let raw = "";
  let body: Record<string, unknown>;
  try {
    raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(413, { ok: false, error: "payload_too_large" });
    body = JSON.parse(raw || "{}");
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const queueId = clean(body.queue_id);
  const dispatchKey = clean(body.dispatch_key);
  if (!isUuid(queueId) || !isUuid(dispatchKey)) return json(400, { ok: false, error: "invalid_dispatch_request" });

  const queueResult = await adminRest(
    `push_delivery_queue?id=eq.${encodeURIComponent(queueId)}&dispatch_key=eq.${encodeURIComponent(dispatchKey)}&select=id,recipient_id,source_type,source_id,status,attempt_count,claimed_at&limit=1`,
    { method: "GET" },
  );
  if (!queueResult.ok) return json(503, { ok: false, error: "queue_unavailable" });
  if (!Array.isArray(queueResult.body) || !queueResult.body[0]) return json(404, { ok: false, error: "dispatch_not_found" });

  const queue = queueResult.body[0] as Record<string, unknown>;
  const status = clean(queue.status);
  if (TERMINAL_QUEUE_STATES.has(status)) return json(200, { ok: true, status });

  const claimedAt = clean(queue.claimed_at);
  if (status === "processing" && claimedAt) {
    const age = Date.now() - new Date(claimedAt).getTime();
    if (Number.isFinite(age) && age >= 0 && age < 120_000) return json(202, { ok: true, status: "processing" });
  }

  const attempts = Math.max(0, Number(queue.attempt_count || 0)) + 1;
  const now = new Date().toISOString();
  const claim = await patchQueue(queueId, {
    status: "processing",
    attempt_count: attempts,
    claimed_at: now,
    last_error: null,
  });
  if (!claim.ok) return json(503, { ok: false, error: "queue_claim_failed" });

  const recipientId = clean(queue.recipient_id);
  const sourceType = clean(queue.source_type);
  const sourceId = clean(queue.source_id);
  let payload: Record<string, string> | null = null;
  if (sourceType === "social_notification") payload = await buildSocialPayload(sourceId, recipientId);
  else if (sourceType === "dm_message") payload = await buildMessagePayload(sourceId, recipientId);

  if (!payload) {
    await patchQueue(queueId, { status: "skipped", processed_at: new Date().toISOString(), last_error: null });
    return json(200, { ok: true, status: "skipped" });
  }

  const [tokensResult, subscriptionsResult] = await Promise.all([
    adminRest(
      `push_device_tokens?user_id=eq.${encodeURIComponent(recipientId)}&enabled=is.true&select=id,token&order=last_seen_at.desc&limit=10`,
      { method: "GET" },
    ),
    adminRest(
      `web_push_subscriptions?user_id=eq.${encodeURIComponent(recipientId)}&enabled=is.true&select=id,endpoint,p256dh,auth&order=last_seen_at.desc&limit=10`,
      { method: "GET" },
    ),
  ]);
  const tokens = Array.isArray(tokensResult.body) ? tokensResult.body as Array<Record<string, unknown>> : [];
  const subscriptions = Array.isArray(subscriptionsResult.body)
    ? subscriptionsResult.body as Array<Record<string, unknown>>
    : [];
  const lookupFailures = Number(!tokensResult.ok) + Number(!subscriptionsResult.ok);
  if (!tokens.length && !subscriptions.length && lookupFailures === 0) {
    await patchQueue(queueId, { status: "no_tokens", processed_at: new Date().toISOString(), last_error: null });
    return json(200, { ok: true, status: "no_tokens" });
  }

  let sent = 0;
  let transientFailures = lookupFailures;
  const failureCodes: string[] = [];
  if (!tokensResult.ok) failureCodes.push("fcm_lookup");
  if (!subscriptionsResult.ok) failureCodes.push("web_lookup");
  for (const entry of tokens) {
    const token = clean(entry.token);
    const tokenId = clean(entry.id);
    if (!token || !tokenId) continue;
    let result;
    try {
      result = await sendFcm(token, payload);
    } catch (error) {
      result = { ok: false, status: 0, body: { error: error instanceof Error ? error.message : "send_failed" } };
    }
    if (result.ok) {
      sent += 1;
      continue;
    }
    if (isPermanentTokenFailure(result)) {
      await adminRest(`push_device_tokens?id=eq.${encodeURIComponent(tokenId)}`, { method: "DELETE" });
      continue;
    }
    transientFailures += 1;
    failureCodes.push(`fcm:${String(result.status || "network")}`);
  }

  for (const subscription of subscriptions) {
    const subscriptionId = clean(subscription.id);
    if (!subscriptionId) continue;
    const result = await sendWebPush(subscription, payload);
    if (result.ok) {
      sent += 1;
      continue;
    }
    if (result.status === 404 || result.status === 410) {
      await adminRest(`web_push_subscriptions?id=eq.${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
      continue;
    }
    transientFailures += 1;
    failureCodes.push(`web:${String(result.status || "network")}`);
  }

  if (sent > 0) {
    await patchQueue(queueId, {
      status: "delivered",
      processed_at: new Date().toISOString(),
      last_error: transientFailures ? `partial_failure:${failureCodes.slice(0, 3).join(",")}` : null,
    });
    return json(200, { ok: true, status: "delivered", sent, failed: transientFailures });
  }

  if (transientFailures === 0) {
    await patchQueue(queueId, { status: "no_tokens", processed_at: new Date().toISOString(), last_error: null });
    return json(200, { ok: true, status: "no_tokens" });
  }

  const retryAt = new Date(Date.now() + Math.min(30, Math.max(1, attempts)) * 60_000).toISOString();
  await patchQueue(queueId, {
    status: attempts >= 5 ? "skipped" : "failed",
    processed_at: attempts >= 5 ? new Date().toISOString() : null,
    next_attempt_at: retryAt,
    last_error: `push_failed:${failureCodes.slice(0, 5).join(",")}`,
  });
  return json(503, { ok: false, error: "push_delivery_failed", attempts });
});
