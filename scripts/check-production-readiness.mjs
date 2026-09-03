import { appendFile } from 'node:fs/promises';

const PROD_ORIGIN = process.env.SAUTILINK_PRODUCTION_ORIGIN || 'https://sautilink.com';
const WWW_ORIGIN = process.env.SAUTILINK_WWW_ORIGIN || 'https://www.sautilink.com';
const ATTEMPTS = Math.max(1, Number(process.env.SAUTILINK_READINESS_ATTEMPTS || 3));
const RETRY_DELAY_MS = Math.max(250, Number(process.env.SAUTILINK_READINESS_RETRY_MS || 2500));
const TIMEOUT_MS = Math.max(1000, Number(process.env.SAUTILINK_READINESS_TIMEOUT_MS || 10000));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function runProbe(attempt) {
  const runId = process.env.GITHUB_RUN_ID || String(Date.now());
  const requestId = `phase33-${runId}-${attempt}`;
  const nonce = encodeURIComponent(`${runId}-${attempt}-${Date.now()}`);

  const health = await request(`${PROD_ORIGIN}/api/health?ops=${nonce}`, {
    headers: { 'X-Request-ID': requestId },
  });
  const app = await request(`${PROD_ORIGIN}/app/?ops=${nonce}`);
  const wwwApp = await request(`${WWW_ORIGIN}/app/?ops=${nonce}`);
  const root = await request(`${PROD_ORIGIN}/?ops=${nonce}`);
  const protectedApi = await request(`${PROD_ORIGIN}/api/account/export?ops=${nonce}`, {
    headers: { Accept: 'application/json' },
  });

  let healthJson;
  try {
    healthJson = JSON.parse(health.body);
  } catch {
    throw new Error(`health endpoint returned non-JSON body: ${health.body.slice(0, 240)}`);
  }

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

  ensure(app.response.status === 200, `app HTTP ${app.response.status}`);
  ensure(wwwApp.response.status === 200, `www app HTTP ${wwwApp.response.status}`);
  ensure(root.response.status === 200, `marketing root HTTP ${root.response.status}`);
  ensure(
    !String(app.response.headers.get('x-robots-tag') || '').toLowerCase().includes('noindex'),
    'production app carries staging noindex',
  );
  ensure(app.body.includes('id="settings-surface"'), 'production app shell marker is missing');
  ensure(wwwApp.body.includes('id="settings-surface"'), 'www production app shell marker is missing');
  ensure(!app.body.includes('Private preview'), 'production app exposes preview copy');
  ensure(root.body.includes('Join the Waitlist'), 'marketing root ownership marker is missing');

  ensure(protectedApi.response.status === 401, `signed-out protected API returned HTTP ${protectedApi.response.status}`);
  ensure(protectedApi.body.includes('"AUTH_REQUIRED"'), 'signed-out protected API did not return AUTH_REQUIRED');

  return {
    requestId,
    healthStatus: health.response.status,
    appStatus: app.response.status,
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
          `- Health: HTTP ${result.healthStatus}`,
          `- App: HTTP ${result.appStatus}`,
          `- www App: HTTP ${result.wwwAppStatus}`,
          `- Marketing root: HTTP ${result.rootStatus}`,
          `- Signed-out protected API: HTTP ${result.protectedApiStatus}`,
          `- Worker environment: ${result.workerEnvironment}`,
          `- Request ID: ${result.requestId}`,
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
