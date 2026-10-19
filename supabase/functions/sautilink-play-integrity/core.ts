/** Monitoring only. No result from this module authorizes or rejects an app action. */
export const PACKAGE_NAME = "com.sautilink.app";
export const MAX_BODY_BYTES = 32_768;
export const SUCCESS_INTERVAL_SECONDS = 21_600;
export const FAILURE_INTERVAL_SECONDS = 3_600;
const CLOCK_SKEW_MS = 30_000;

export type JsonObject = Record<string, unknown>;
export type Identity = { userId: string; sessionId: string };
export type Challenge = {
  challenge_id: string;
  version_code: number;
  issued_at_ms: number;
  expires_at_ms: number;
};
export type MonitorConfig = {
  cloudProjectNumber: string;
  allowedCertificates: ReadonlySet<string>;
};
export type ChallengeResult = Challenge & { status: "ready" };
export type RateLimited = { status: "rate_limited"; retry_after_seconds: number };
export type ConsumeResult = ChallengeResult | { status: "invalid_challenge" };
export type Summary = {
  outcome: "observed" | "binding_failed" | "google_unavailable" | "token_rejected";
  app_recognition?: string;
  certificate_match?: boolean;
  version_match?: boolean;
  app_version_code?: number;
  licensing?: string;
  device_recognition?: string[];
};
export type Dependencies = {
  config: () => MonitorConfig | null;
  authenticate: (authorization: string) => Promise<Identity | null>;
  begin: (authorization: string, versionCode: number) => Promise<ChallengeResult | RateLimited>;
  consume: (authorization: string, challengeId: string) => Promise<ConsumeResult>;
  decode: (token: string) => Promise<unknown>;
  record: (identity: Identity, challengeId: string, summary: Summary) => Promise<boolean>;
  now?: () => number;
};

export class MonitorError extends Error {
  readonly category: "token_rejected" | "google_unavailable" | "backend_unavailable";
  constructor(category: "token_rejected" | "google_unavailable" | "backend_unavailable") {
    super(category);
    this.category = category;
  }
}

export function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject : {};
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Only a digest, never account/session identifiers, is sent to Google. */
export async function requestHash(identity: Identity, challenge: Challenge): Promise<string> {
  const canonical = JSON.stringify([
    "sautilink-integrity-monitor-v1",
    PACKAGE_NAME,
    identity.userId.toLowerCase(),
    identity.sessionId.toLowerCase(),
    challenge.challenge_id.toLowerCase(),
    challenge.version_code,
  ]);
  return base64Url(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(canonical),
  )));
}

export function normalizeCertificate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const hex = text.replace(/:/g, "");
  if (/^[0-9a-f]{64}$/i.test(hex)) {
    return base64Url(Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16)));
  }
  if (!/^[A-Za-z0-9_-]{43}=?$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/g, "") + "=");
    return binary.length === 32 ? base64Url(Uint8Array.from(binary, (c) => c.charCodeAt(0))) : null;
  } catch { return null; }
}

const APP_RECOGNITION = ["PLAY_RECOGNIZED", "UNRECOGNIZED_VERSION", "UNEVALUATED"];
const LICENSING = ["LICENSED", "UNLICENSED", "UNEVALUATED"];
const DEVICE_LABELS = ["MEETS_BASIC_INTEGRITY", "MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY", "MEETS_VIRTUAL_INTEGRITY"];

function enumValue(value: unknown, allowed: string[]): string {
  return typeof value === "string" && allowed.includes(value) ? value : "UNEVALUATED";
}

function enumList(value: unknown, allowed: string[]): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.includes(item)))].sort()
    : [];
}

function positiveInteger(value: unknown, maximum = 2_100_000_000): number | null {
  const normalized = typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : value;
  return typeof normalized === "number" && Number.isSafeInteger(normalized) && normalized > 0 && normalized <= maximum
    ? normalized : null;
}

/** Validate request binding first; unknown response fields are never persisted. */
export function evaluateVerdict(
  response: unknown,
  expectedHash: string,
  challenge: Challenge,
  allowedCertificates: ReadonlySet<string>,
  now: number,
): Summary {
  const payload = object(object(response).tokenPayloadExternal);
  const request = object(payload.requestDetails);
  const timestampValue = request.timestampMillis;
  const timestamp = typeof timestampValue === "string" && /^\d{10,16}$/.test(timestampValue)
    ? Number(timestampValue) : timestampValue;
  if (
    request.requestPackageName !== PACKAGE_NAME ||
    request.requestHash !== expectedHash ||
    typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) ||
    timestamp < challenge.issued_at_ms - CLOCK_SKEW_MS ||
    timestamp > challenge.expires_at_ms || timestamp > now + CLOCK_SKEW_MS ||
    now > challenge.expires_at_ms + CLOCK_SKEW_MS
  ) return { outcome: "binding_failed" };

  const app = object(payload.appIntegrity);
  const recognition = enumValue(app.appRecognitionVerdict, APP_RECOGNITION);
  const certificates = Array.isArray(app.certificateSha256Digest)
    ? app.certificateSha256Digest.map(normalizeCertificate) : [];
  const version = positiveInteger(app.versionCode);
  const samePackage = app.packageName === PACKAGE_NAME;
  const device = object(payload.deviceIntegrity);
  return {
    outcome: "observed",
    app_recognition: recognition,
    certificate_match: samePackage && certificates.some((cert) => cert !== null && allowedCertificates.has(cert)),
    version_match: samePackage && version === challenge.version_code,
    ...(samePackage && version !== null ? { app_version_code: version } : {}),
    licensing: enumValue(object(payload.accountDetails).appLicensingVerdict, LICENSING),
    device_recognition: enumList(device.deviceRecognitionVerdict, DEVICE_LABELS),
  };
}

export async function readLimitedJson(request: Request | Response, maxBytes: number): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new Error("body_too_large");
  }
  if (!request.body) throw new Error("invalid_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

function response(status: number, payload: JsonObject, retryAfter?: number): Response {
  return new Response(JSON.stringify({ mode: "monitor", ...payload }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...(retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) }),
    },
  });
}

function unavailable(): Response {
  return response(200, { status: "unavailable", retry_after_seconds: FAILURE_INTERVAL_SECONDS });
}

export function createHandler(dependencies: Dependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return response(405, { status: "method_not_allowed" });
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return response(415, { status: "invalid_content_type" });
    }
    const authorization = request.headers.get("authorization") || "";
    if (authorization.length > 16_384 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization)) {
      return response(401, { status: "unauthorized" });
    }
    let body: JsonObject;
    try { body = object(await readLimitedJson(request, MAX_BODY_BYTES)); }
    catch { return response(400, { status: "invalid_body" }); }
    const challengeAction = body.action === "challenge";
    const observeAction = body.action === "observe";
    const allowedKeys = challengeAction ? ["action", "version_code"] : ["action", "challenge_id", "integrity_token"];
    if ((!challengeAction && !observeAction) || Object.keys(body).some((key) => !allowedKeys.includes(key))) {
      return response(400, { status: "invalid_request" });
    }
    if (challengeAction && (typeof body.version_code !== "number" || positiveInteger(body.version_code) === null)) {
      return response(400, { status: "invalid_version" });
    }
    if (observeAction && (!isUuid(body.challenge_id) || typeof body.integrity_token !== "string" ||
      body.integrity_token.length < 32 || body.integrity_token.length > 30_000 ||
      !/^[\x21-\x7e]+$/.test(body.integrity_token))) {
      return response(400, { status: "invalid_observation" });
    }
    try {
      const identity = await dependencies.authenticate(authorization);
      if (!identity) return response(401, { status: "unauthorized" });
      const config = dependencies.config();
      if (!config) return unavailable();
      if (challengeAction) {
        const challenge = await dependencies.begin(authorization, body.version_code as number);
        if (challenge.status === "rate_limited") {
          const retry = Math.max(1, Math.min(86_400, Math.ceil(challenge.retry_after_seconds)));
          return response(429, { status: "rate_limited", retry_after_seconds: retry }, retry);
        }
        return response(200, {
          status: "ready",
          challenge_id: challenge.challenge_id,
          request_hash: await requestHash(identity, challenge),
          cloud_project_number: config.cloudProjectNumber,
          expires_at_ms: challenge.expires_at_ms,
          retry_after_seconds: SUCCESS_INTERVAL_SECONDS,
        });
      }

      // Atomic consumption runs before any paid/quota-bound Google call.
      const challengeId = body.challenge_id as string;
      const challenge = await dependencies.consume(authorization, challengeId);
      if (challenge.status !== "ready") return response(409, { status: "invalid_challenge", retry_after_seconds: FAILURE_INTERVAL_SECONDS });
      let summary: Summary;
      try {
        const decoded = await dependencies.decode(body.integrity_token as string);
        summary = evaluateVerdict(decoded, await requestHash(identity, challenge), challenge, config.allowedCertificates, (dependencies.now || Date.now)());
      } catch (error) {
        summary = { outcome: error instanceof MonitorError && error.category === "token_rejected" ? "token_rejected" : "google_unavailable" };
      }
      if (!await dependencies.record(identity, challengeId, summary)) return unavailable();
      return response(200, { status: "recorded", retry_after_seconds: SUCCESS_INTERVAL_SECONDS });
    } catch {
      // Never emit JWTs, encrypted tokens, Google responses, account data or stack traces.
      return unavailable();
    }
  };
}
