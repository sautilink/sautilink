import {
  base64Url, isUuid, MonitorError, normalizeCertificate, object, readLimitedJson,
  type ChallengeResult, type ConsumeResult, type Dependencies, type Identity,
  type MonitorConfig, type RateLimited, type Summary,
} from "./core.ts";
import {
  DEFAULT_ALLOWED_CERTIFICATE_SHA256, DEFAULT_CLOUD_PROJECT_NUMBER,
  DEFAULT_MONITOR_ENABLED, EXPECTED_GOOGLE_PROJECT_ID,
} from "./deploy-config.ts";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const INTEGRITY_DECODE_URL = "https://playintegrity.googleapis.com/v1/com.sautilink.app:decodeIntegrityToken";
const INTEGRITY_SCOPE = "https://www.googleapis.com/auth/playintegrity";
const REQUEST_TIMEOUT_MS = 10_000;
type Environment = (name: string) => string | undefined;
type Fetch = typeof globalThis.fetch;
type ServiceAccount = { clientEmail: string; privateKey: string };

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

function parseAccount(encoded: string): ServiceAccount | null {
  if (!encoded || encoded.length > 32_768) return null;
  try {
    const bytes = Uint8Array.from(atob(encoded.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    const parsed = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    const email = text(parsed.client_email);
    const privateKey = text(parsed.private_key);
    if (parsed.type !== "service_account" || parsed.project_id !== EXPECTED_GOOGLE_PROJECT_ID ||
      !new RegExp(`^[a-z0-9-]+@${EXPECTED_GOOGLE_PROJECT_ID}\\.iam\\.gserviceaccount\\.com$`).test(email) ||
      !/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(privateKey)) return null;
    return { clientEmail: email, privateKey };
  } catch { return null; }
}

function jwtPayload(authorization: string): Record<string, unknown> {
  try {
    const encoded = authorization.slice(7).split(".")[1];
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return object(JSON.parse(new TextDecoder().decode(Uint8Array.from(
      atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)), (c) => c.charCodeAt(0),
    ))));
  } catch { return {}; }
}

function validChallenge(value: unknown): value is ChallengeResult {
  const row = object(value);
  return row.status === "ready" && isUuid(row.challenge_id) &&
    Number.isSafeInteger(row.version_code) && Number(row.version_code) > 0 && Number(row.version_code) <= 2_100_000_000 &&
    Number.isSafeInteger(row.issued_at_ms) && Number.isSafeInteger(row.expires_at_ms) &&
    Number(row.expires_at_ms) > Number(row.issued_at_ms) &&
    Number(row.expires_at_ms) - Number(row.issued_at_ms) <= 300_000;
}

/** REST/WebCrypto mirrors the existing push service without changing its credentials or scope. */
export function createRuntime(env: Environment, fetcher: Fetch = fetch, now: () => number = Date.now): Dependencies {
  let cachedGoogleToken: { value: string; expiresAt: number } | null = null;
  let tokenFlight: Promise<string> | null = null;

  function database() {
    const url = text(env("SUPABASE_URL")).replace(/\/$/, "");
    const serviceKey = text(env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY"));
    if (!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(url) || !serviceKey) throw new MonitorError("backend_unavailable");
    return { url, serviceKey };
  }

  function serviceAccount(): ServiceAccount | null {
    // Do not silently ignore an invalid dedicated key and use a different identity.
    const dedicated = text(env("PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON_BASE64"));
    return dedicated ? parseAccount(dedicated) : parseAccount(text(env("FIREBASE_SERVICE_ACCOUNT_JSON_BASE64")));
  }

  function config(): MonitorConfig | null {
    const mode = text(env("PLAY_INTEGRITY_MODE"));
    if ((mode || (DEFAULT_MONITOR_ENABLED ? "monitor" : "off")) !== "monitor") return null;
    const projectNumber = text(env("PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER")) || DEFAULT_CLOUD_PROJECT_NUMBER;
    if (projectNumber !== DEFAULT_CLOUD_PROJECT_NUMBER || !/^[1-9]\d{5,18}$/.test(projectNumber)) return null;
    const rawCertificates = text(env("PLAY_INTEGRITY_ALLOWED_CERTIFICATE_SHA256"));
    const input = rawCertificates ? rawCertificates.split(",") : DEFAULT_ALLOWED_CERTIFICATE_SHA256;
    const certificates = input.map(normalizeCertificate);
    if (!certificates.length || certificates.some((item) => item === null) || !serviceAccount()) return null;
    return { cloudProjectNumber: projectNumber, allowedCertificates: new Set(certificates as string[]) };
  }

  async function limitedFetch(url: string, init: RequestInit, maxBytes = 65_536) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal, redirect: "error" });
      const payload = await readLimitedJson(response, maxBytes).catch(() => null);
      return { status: response.status, ok: response.ok, payload };
    } catch { throw new MonitorError("backend_unavailable"); }
    finally { clearTimeout(timer); }
  }

  async function authenticate(authorization: string): Promise<Identity | null> {
    const cfg = database();
    // The decoded JWT is only a hint until Auth verifies that same token.
    const claims = jwtPayload(authorization);
    if (!isUuid(claims.sub) || !isUuid(claims.session_id) || claims.role !== "authenticated" ||
      claims.is_anonymous === true || !Number.isSafeInteger(claims.exp) || Number(claims.exp) <= Math.floor(now() / 1000) ||
      claims.iss !== `${cfg.url}/auth/v1`) return null;
    const result = await limitedFetch(`${cfg.url}/auth/v1/user`, {
      method: "GET", headers: { apikey: cfg.serviceKey, Authorization: authorization, Accept: "application/json" },
    });
    if (result.status >= 500 || result.status === 429) throw new MonitorError("backend_unavailable");
    const user = object(result.payload);
    if (!result.ok || user.id !== claims.sub || user.is_anonymous === true) return null;
    // Both database operations additionally require this session to still exist.
    return { userId: claims.sub, sessionId: claims.session_id };
  }

  async function rpc(name: string, body: unknown, authorization?: string): Promise<unknown> {
    const cfg = database();
    const serverAuthorization = cfg.serviceKey.startsWith("sb_secret_") ? undefined : `Bearer ${cfg.serviceKey}`;
    const bearer = authorization || serverAuthorization;
    const result = await limitedFetch(`${cfg.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: cfg.serviceKey,
        ...(bearer ? { Authorization: bearer } : {}),
        "Content-Type": "application/json", Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!result.ok) throw new MonitorError("backend_unavailable");
    return result.payload;
  }

  async function begin(authorization: string, versionCode: number): Promise<ChallengeResult | RateLimited> {
    const result = await rpc("begin_play_integrity_observation_v1", { p_version_code: versionCode }, authorization);
    if (validChallenge(result)) return result;
    const row = object(result);
    if (row.status === "rate_limited" && Number.isSafeInteger(row.retry_after_seconds) && Number(row.retry_after_seconds) > 0) {
      return { status: "rate_limited", retry_after_seconds: Number(row.retry_after_seconds) };
    }
    throw new MonitorError("backend_unavailable");
  }

  async function consume(authorization: string, challengeId: string): Promise<ConsumeResult> {
    const result = await rpc("consume_play_integrity_observation_v1", { p_challenge_id: challengeId }, authorization);
    if (validChallenge(result)) return result;
    if (object(result).status === "invalid_challenge") return { status: "invalid_challenge" };
    throw new MonitorError("backend_unavailable");
  }

  async function obtainGoogleToken(): Promise<string> {
    if (!config()) throw new MonitorError("google_unavailable");
    const account = serviceAccount();
    if (!account) throw new MonitorError("google_unavailable");
    const seconds = Math.floor(now() / 1000);
    const encode = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iss: account.clientEmail, scope: INTEGRITY_SCOPE, aud: GOOGLE_TOKEN_URL, iat: seconds, exp: seconds + 3_600,
    })}`;
    try {
      const keyBytes = Uint8Array.from(atob(account.privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
      const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
      const result = await limitedFetch(GOOGLE_TOKEN_URL, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64Url(signature)}` }),
      }, 16_384);
      const payload = object(result.payload);
      const lifetime = Number(payload.expires_in);
      if (!result.ok || typeof payload.access_token !== "string" || !payload.access_token || payload.access_token.length > 8_192 ||
        !Number.isFinite(lifetime) || lifetime <= 0) throw new MonitorError("google_unavailable");
      cachedGoogleToken = { value: payload.access_token, expiresAt: seconds + Math.min(3_600, lifetime) };
      return cachedGoogleToken.value;
    } catch { throw new MonitorError("google_unavailable"); }
  }

  async function googleToken(): Promise<string> {
    if (cachedGoogleToken && cachedGoogleToken.expiresAt > now() / 1000 + 90) return cachedGoogleToken.value;
    if (!tokenFlight) tokenFlight = obtainGoogleToken().finally(() => { tokenFlight = null; });
    return await tokenFlight;
  }

  async function decode(token: string): Promise<unknown> {
    if (!config()) throw new MonitorError("google_unavailable");
    try {
      const accessToken = await googleToken();
      const result = await limitedFetch(INTEGRITY_DECODE_URL, {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ integrity_token: token }),
      });
      if (result.status === 400) throw new MonitorError("token_rejected");
      if (!result.ok || result.payload === null) throw new MonitorError("google_unavailable");
      return result.payload;
    } catch (error) {
      if (error instanceof MonitorError && error.category === "token_rejected") throw error;
      throw new MonitorError("google_unavailable");
    }
  }

  async function record(identity: Identity, challengeId: string, summary: Summary): Promise<boolean> {
    return await rpc("record_play_integrity_observation_v1", {
      p_user_id: identity.userId, p_session_id: identity.sessionId, p_challenge_id: challengeId, p_summary: summary,
    }) === true;
  }

  return { config, authenticate, begin, consume, decode, record, now };
}
