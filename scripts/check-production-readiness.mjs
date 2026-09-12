import { appendFile } from 'node:fs/promises';

const PROD_ORIGIN = process.env.SAUTILINK_PRODUCTION_ORIGIN || 'https://sautilink.com';
const WWW_ORIGIN = process.env.SAUTILINK_WWW_ORIGIN || 'https://www.sautilink.com';
const ATTEMPTS = Math.max(1, Number(process.env.SAUTILINK_READINESS_ATTEMPTS || 3));
const RETRY_DELAY_MS = Math.max(250, Number(process.env.SAUTILINK_READINESS_RETRY_MS || 2500));
const TIMEOUT_MS = Math.max(1000, Number(process.env.SAUTILINK_READINESS_TIMEOUT_MS || 10000));
const EXPECTED_IMAGE_VARIANT_WIDTHS = Object.freeze([480, 960, 1440]);
const SYNTHETIC_MEDIA_ID = '00000000-0000-4000-8000-000000000001';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      ...options,
      headers: {
        'Cache-Control': 'no-cache',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      response,
      body,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } finally {
    clearTimeout(timer);
  }
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJsonResponse(result, label) {
  try {
    return JSON.parse(result.body);
  } catch {
    throw new Error(`${label} returned non-JSON body: ${result.body.slice(0, 240)}`);
  }
}

function hasTimingMetric(header, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|,\\s*)${escaped};dur=\\d+(?:\\.\\d+)?(?:;[^,]+)?(?:,|$)`, 'i').test(header);
}

async function runProbe(attempt) {
  const runId = process.env.GITHUB_RUN_ID || String(Date.now());
  const requestId = `phase33-${runId}-${attempt}`;
  const nonce = encodeURIComponent(`${runId}-${attempt}-${Date.now()}`);

  const health = await request(`${PROD_ORIGIN}/api/health?ops=${nonce}`, {
    headers: { 'X-Request-ID': requestId },
  });
  const mediaStatus = await request(`${PROD_ORIGIN}/api/sauti-media/status?ops=${nonce}`, {
    headers: { Accept: 'application/json' },
  });
  const mediaTimingProbe = await request(`${PROD_ORIGIN}/api/sauti-media/${SYNTHETIC_MEDIA_ID}?w=480&ops=${nonce}`, {
    headers: { Accept: 'application/json' },
  });
  const app = await request(`${PROD_ORIGIN}/app/?ops=${nonce}`);
  const wwwApp = await request(`${WWW_ORIGIN}/app/?ops=${nonce}`);
  const root = await request(`${PROD_ORIGIN}/?ops=${nonce}`);
  const protectedApi = await request(`${PROD_ORIGIN}/api/account/export?ops=${nonce}`, {
    headers: { Accept: 'application/json' },
  });

  const healthJson = parseJsonResponse(health, 'health endpoint');
  const mediaStatusJson = parseJsonResponse(mediaStatus, 'media status endpoint');

  ensure(health.response.status === 200, `health HTTP ${health.response.status}`);
  ensure(healthJson?.ok === true, 'health ok flag is not true');
  ensure(healthJson?.data?.status === 'ok', 'health status is not ok');
  ensure(healthJson?.data?.environment === 'production', 'health environment is not production');
  for (const key of ['assets', 'media', 'rate_limits']) {
    ensure(healthJson?.data?.checks?.[key] === true, `health check ${key} is not true`);
  }
  ensure(
    health.response.headers.get('x-request-id')?.toLowerCase() === requestId.toLowerCase(),
    'health response did not echo the request id',
  );
  ensure(
    !String(health.response.headers.get('x-robots-tag') || '').toLowerCase().includes('noindex'),
    'production health response carries staging noindex',
  );

  ensure(mediaStatus.response.status === 200, `media status HTTP ${mediaStatus.response.status}`);
  ensure(mediaStatusJson?.ok === true, 'media status ok flag is not true');
  ensure(mediaStatusJson?.data?.ready === true, 'production post media is not ready');
  ensure(mediaStatusJson?.data?.responsive_images === true, 'production responsive images are not enabled');
  ensure(
    JSON.stringify(mediaStatusJson?.data?.image_variant_widths) === JSON.stringify(EXPECTED_IMAGE_VARIANT_WIDTHS),
    `unexpected production image variant widths: ${JSON.stringify(mediaStatusJson?.data?.image_variant_widths)}`,
  );

  const serverTiming = String(mediaTimingProbe.response.headers.get('server-timing') || '');
  ensure(mediaTimingProbe.response.status === 404, `synthetic protected media returned HTTP ${mediaTimingProbe.response.status}`);
  ensure(mediaTimingProbe.body.includes('"MEDIA_NOT_FOUND"'), 'synthetic protected media did not preserve MEDIA_NOT_FOUND');
  ensure(hasTimingMetric(serverTiming, 'access'), `protected media Server-Timing is missing access: ${serverTiming || '(empty)'}`);
  ensure(hasTimingMetric(serverTiming, 'total'), `protected media Server-Timing is missing total: ${serverTiming || '(empty)'}`);
  ensure(
    !/(?:owner_id|object_key|authorization|bearer|token)/i.test(serverTiming),
    'protected media Server-Timing exposes a sensitive field name',
  );

  ensure(app.response.status === 200, `app HTTP ${app.response.status}`);
  ensure(wwwApp.response.status === 200, `www app HTTP ${wwwApp.response.status}`);
  ensure(root.response.status === 200, `account-entry root HTTP ${root.response.status}`);
  ensure(
    !String(app.response.headers.get('x-robots-tag') || '').toLowerCase().includes('noindex'),
    'production app carries staging noindex',
  );
  ensure(app.body.includes('id="settings-surface"'), 'production app shell marker is missing');
  ensure(wwwApp.body.includes('id="settings-surface"'), 'www production app shell marker is missing');
  ensure(!app.body.includes('Private preview'), 'production app exposes preview copy');
  ensure(
    root.body.includes('data-sautilink-entry="account-choice"')
      && root.body.includes('href="/login"')
      && root.body.includes('href="/signup"'),
    'account-entry root choice markers are missing',
  );

  ensure(protectedApi.response.status === 401, `signed-out protected API returned HTTP ${protectedApi.response.status}`);
  ensure(protectedApi.body.includes('"AUTH_REQUIRED"'), 'signed-out protected API did not return AUTH_REQUIRED');

  return {
    requestId,
    healthStatus: health.response.status,
    healthMs: health.durationMs,
    mediaStatus: mediaStatus.response.status,
    mediaStatusMs: mediaStatus.durationMs,
    responsiveImages: mediaStatusJson.data.responsive_images,
    imageVariantWidths: mediaStatusJson.data.image_variant_widths,
    mediaTimingProbeStatus: mediaTimingProbe.response.status,
    mediaTimingProbeMs: mediaTimingProbe.durationMs,
    mediaServerTiming: serverTiming,
    appStatus: app.response.status,
    appMs: app.durationMs,
    wwwAppStatus: wwwApp.response.status,
    rootStatus: root.response.status,
    protectedApiStatus: protectedApi.response.status,
    workerEnvironment: healthJson.data.environment,
    checks: healthJson.data.checks,
  };
}

let lastError;
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  try {
    const result = await runProbe(attempt);
    console.log('PRODUCTION_READINESS_PASS');
    console.log(JSON.stringify(result, null, 2));

    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        [
          '## SautiLink production readiness',
          '',
          'Status: **PASS**',
          '',
          `- Health: HTTP ${result.healthStatus} (${result.healthMs} ms)`,
          `- Media status: HTTP ${result.mediaStatus} (${result.mediaStatusMs} ms)`,
          `- Responsive images: ${result.responsiveImages ? 'enabled' : 'disabled'}`,
          `- Image variants: ${result.imageVariantWidths.join(', ')} px`,
          `- Protected media timing probe: HTTP ${result.mediaTimingProbeStatus} (${result.mediaTimingProbeMs} ms)`,
          `- Server-Timing: ${result.mediaServerTiming}`,
          `- App: HTTP ${result.appStatus} (${result.appMs} ms)`,
          `- www App: HTTP ${result.wwwAppStatus}`,
          `- Account-entry root: HTTP ${result.rootStatus}`,
          `- Signed-out protected API: HTTP ${result.protectedApiStatus}`,
          `- Worker environment: ${result.workerEnvironment}`,
          `- Request ID: ${result.requestId}`,
          '',
          '_Latency values are informational runner-to-production measurements, not user-experience thresholds._',
          '',
        ].join('\n'),
      );
    }
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.error(`Production readiness attempt ${attempt}/${ATTEMPTS} failed: ${error.message}`);
    if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
}

console.error('PRODUCTION_READINESS_FAIL');
console.error(lastError?.stack || lastError?.message || String(lastError));
process.exit(1);
