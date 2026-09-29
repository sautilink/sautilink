// Leave blank until a maintenance window is announced.
// When enabled, use an absolute ISO-8601 timestamp so refreshes never restart the countdown.
export const MAINTENANCE_END_ISO = '';

const MAINTENANCE_PATHS = new Set(['/maintenance', '/maintenance/']);

const MAINTENANCE_HTML = `<!doctype html>
<html lang="en" data-maintenance-end="${MAINTENANCE_END_ISO}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f5f6f8" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0d0f12" media="(prefers-color-scheme: dark)">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>SautiLink — System Maintenance</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f6f8;
      --panel: #ffffff;
      --text: #15171a;
      --muted: #62666d;
      --line: #e2e5e9;
      --brand: #d71920;
      --brand-soft: #fff1f1;
      --shadow: 0 22px 60px rgba(17, 24, 39, .08);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: #0d0f12;
        --panel: #15181c;
        --text: #f4f5f7;
        --muted: #a6abb3;
        --line: #2a2f35;
        --brand: #ff4d52;
        --brand-soft: rgba(255, 77, 82, .1);
        --shadow: 0 22px 60px rgba(0, 0, 0, .3);
      }
    }

    * { box-sizing: border-box; }
    html, body { min-height: 100%; }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 28px 18px;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .maintenance-shell { width: min(100%, 720px); }

    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
      padding: 0 2px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--text);
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -.03em;
    }

    .brand-mark {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border-radius: 9px;
      background: var(--brand);
      color: #fff;
      font-size: 18px;
      font-weight: 900;
      line-height: 1;
    }

    .status-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 7px 11px;
      border: 1px solid color-mix(in srgb, var(--brand) 28%, var(--line));
      border-radius: 999px;
      background: var(--brand-soft);
      color: var(--brand);
      font-size: 12px;
      font-weight: 750;
      letter-spacing: .02em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 12%, transparent);
      animation: pulse 1.8s ease-in-out infinite;
    }

    .card {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 26px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }

    .accent { height: 4px; background: var(--brand); }
    .content { padding: clamp(28px, 5vw, 50px); }

    .eyebrow {
      margin: 0 0 14px;
      color: var(--brand);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      max-width: 620px;
      font-size: clamp(32px, 7vw, 52px);
      line-height: 1.02;
      letter-spacing: -.055em;
    }

    .lead {
      margin: 22px 0 0;
      max-width: 620px;
      color: var(--muted);
      font-size: clamp(16px, 2.8vw, 19px);
      line-height: 1.65;
    }

    .scope {
      margin: 25px 0 0;
      padding: 18px 20px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: color-mix(in srgb, var(--panel) 88%, var(--bg));
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
    }

    .scope strong { color: var(--text); }

    .countdown-wrap {
      margin-top: 34px;
      padding-top: 30px;
      border-top: 1px solid var(--line);
    }

    .countdown-label {
      margin: 0 0 14px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }

    .countdown {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .time-box {
      min-width: 0;
      padding: 17px 10px 14px;
      border: 1px solid var(--line);
      border-radius: 16px;
      text-align: center;
      background: color-mix(in srgb, var(--panel) 92%, var(--bg));
    }

    .time-value {
      display: block;
      min-height: 42px;
      font-variant-numeric: tabular-nums;
      font-size: clamp(29px, 7vw, 40px);
      font-weight: 800;
      line-height: 1;
      letter-spacing: -.04em;
    }

    .time-unit {
      display: block;
      margin-top: 7px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .footnote {
      margin: 20px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }

    footer {
      padding: 16px 4px 0;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    @keyframes pulse {
      0%, 100% { opacity: .55; transform: scale(.92); }
      50% { opacity: 1; transform: scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .status-dot { animation: none; }
    }

    @media (max-width: 520px) {
      body { padding: 18px 12px; }
      .brand-row { align-items: flex-start; }
      .status-chip { font-size: 10px; padding: 6px 9px; }
      .card { border-radius: 22px; }
      .content { padding: 28px 20px 26px; }
      .scope { padding: 15px 16px; }
      .countdown { gap: 7px; }
      .time-box { padding-inline: 6px; border-radius: 13px; }
    }
  </style>
</head>
<body>
  <main class="maintenance-shell">
    <div class="brand-row">
      <div class="brand" aria-label="SautiLink">
        <span class="brand-mark" aria-hidden="true">S</span>
        <span>SautiLink</span>
      </div>
      <div class="status-chip">
        <span class="status-dot" aria-hidden="true"></span>
        <span>Maintenance in progress</span>
      </div>
    </div>

    <section class="card" aria-labelledby="maintenance-title">
      <div class="accent" aria-hidden="true"></div>
      <div class="content">
        <p class="eyebrow">Major system upgrade</p>
        <h1 id="maintenance-title">We are upgrading SautiLink.</h1>
        <p class="lead">
          SautiLink is temporarily unavailable while we carry out major improvements across the entire platform. We are upgrading core infrastructure to make the service faster, safer and more reliable.
        </p>

        <div class="scope">
          <strong>What is being improved?</strong><br>
          This maintenance covers servers, security, platform infrastructure, performance, reliability and other core SautiLink systems.
        </div>

        <div class="countdown-wrap">
          <p class="countdown-label">Estimated maintenance time remaining</p>
          <div class="countdown" id="maintenance-countdown" aria-label="Maintenance countdown">
            <div class="time-box">
              <span class="time-value" id="hours">--</span>
              <span class="time-unit">Hours</span>
            </div>
            <div class="time-box">
              <span class="time-value" id="minutes">--</span>
              <span class="time-unit">Minutes</span>
            </div>
            <div class="time-box">
              <span class="time-value" id="seconds">--</span>
              <span class="time-unit">Seconds</span>
            </div>
          </div>
          <p class="footnote" id="maintenance-note">
            A completion time has not been published yet. Please check back shortly.
          </p>
        </div>
      </div>
    </section>

    <footer>© 2026 SautiLink. All rights reserved.</footer>
  </main>

  <script>
    (() => {
      const rawEnd = document.documentElement.dataset.maintenanceEnd.trim();
      const hours = document.getElementById('hours');
      const minutes = document.getElementById('minutes');
      const seconds = document.getElementById('seconds');
      const note = document.getElementById('maintenance-note');

      if (!rawEnd) return;

      const endAt = Date.parse(rawEnd);
      if (!Number.isFinite(endAt)) return;

      const pad = (value) => String(Math.max(0, value)).padStart(2, '0');
      let timerId = 0;

      const render = () => {
        const remainingMs = Math.max(0, endAt - Date.now());
        const remainingSeconds = Math.floor(remainingMs / 1000);
        const h = Math.floor(remainingSeconds / 3600);
        const m = Math.floor((remainingSeconds % 3600) / 60);
        const s = remainingSeconds % 60;

        hours.textContent = pad(h);
        minutes.textContent = pad(m);
        seconds.textContent = pad(s);
        note.textContent = remainingMs > 0
          ? 'We are working to restore full access within this maintenance window.'
          : 'The maintenance window has reached its estimated completion time. Full access will return when maintenance mode is switched off.';

        if (remainingMs <= 0 && timerId) {
          clearInterval(timerId);
          timerId = 0;
        }
      };

      render();
      if (endAt > Date.now()) timerId = window.setInterval(render, 1000);
    })();
  </script>
</body>
</html>`;

export function handleMaintenanceRequest(request, url) {
  if (!MAINTENANCE_PATHS.has(url.pathname)) return null;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: {
        Allow: 'GET, HEAD',
        'Cache-Control': 'no-store',
      },
    });
  }

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });

  return new Response(request.method === 'HEAD' ? null : MAINTENANCE_HTML, {
    status: 200,
    headers,
  });
}
