import artworkPart1a from './maintenance-artwork-1a.js';
import artworkPart1b from './maintenance-artwork-1b.js';
import artworkPart2 from './maintenance-artwork-2.js';
import artworkPart3 from './maintenance-artwork-3.js';
import artworkPart4 from './maintenance-artwork-4.js';
import artworkPart5 from './maintenance-artwork-5.js';

// Leave blank until a maintenance window is announced.
// When enabled, use an absolute ISO-8601 timestamp so refreshes never restart the countdown.
export const MAINTENANCE_END_ISO = '';
export const MAINTENANCE_ARTWORK_DATA_URL = `data:image/webp;base64,${artworkPart1a}${artworkPart1b}${artworkPart2}${artworkPart3}${artworkPart4}${artworkPart5}`;

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
    @font-face {
      font-family: "Inter";
      src: url("/assets/fonts/inter/InterVariable.woff2") format("woff2");
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
    }

    :root {
      color-scheme: light;
      --bg: #f5f6f8;
      --panel: #ffffff;
      --surface: #f8fafc;
      --text: #15171a;
      --muted: #62666d;
      --line: #e2e5e9;
      --brand: #2563eb;
      --brand-soft: #eff6ff;
      --shadow: 0 22px 60px rgba(17, 24, 39, .08);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: #0d0f12;
        --panel: #15181c;
        --surface: #12161b;
        --text: #f4f5f7;
        --muted: #a6abb3;
        --line: #2a2f35;
        --brand: #60a5fa;
        --brand-soft: rgba(96, 165, 250, .1);
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
      padding: 24px 18px 30px;
      background: var(--bg);
      color: var(--text);
      font-family: "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    a { color: inherit; }
    .maintenance-shell { width: min(100%, 760px); }

    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
      padding: 0 2px;
    }

    .brand-link {
      display: inline-flex;
      align-items: center;
      min-height: 42px;
      text-decoration: none;
    }

    .brand-logo {
      display: block;
      width: 118px;
      height: auto;
      object-fit: contain;
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
      font-weight: 760;
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
    .content { padding: clamp(24px, 5vw, 46px); }

    .artwork-wrap {
      display: flex;
      justify-content: center;
      margin: -4px 0 10px;
    }

    .maintenance-artwork {
      display: block;
      width: min(100%, 540px);
      height: auto;
      max-height: 340px;
      object-fit: contain;
      object-position: center;
    }

    .eyebrow {
      margin: 4px 0 12px;
      color: var(--brand);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      max-width: 640px;
      font-size: clamp(32px, 7vw, 52px);
      line-height: 1.02;
      letter-spacing: -.055em;
    }

    .lead {
      margin: 20px 0 0;
      max-width: 650px;
      color: var(--muted);
      font-size: clamp(16px, 2.8vw, 19px);
      line-height: 1.65;
    }

    .countdown-wrap {
      margin-top: 26px;
      padding: 22px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--surface);
    }

    .countdown-label {
      margin: 0 0 14px;
      color: var(--text);
      font-size: 13px;
      font-weight: 760;
    }

    .countdown {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .time-box {
      min-width: 0;
      padding: 18px 8px 15px;
      border: 1px solid var(--line);
      border-radius: 16px;
      text-align: center;
      background: var(--panel);
    }

    .time-value {
      display: block;
      min-height: 42px;
      font-variant-numeric: tabular-nums;
      font-size: clamp(29px, 7vw, 40px);
      font-weight: 820;
      line-height: 1;
      letter-spacing: -.04em;
    }

    .time-unit {
      display: block;
      margin-top: 7px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 760;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .footnote {
      margin: 18px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }

    .scope {
      margin: 18px 0 0;
      padding: 18px 20px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: color-mix(in srgb, var(--panel) 88%, var(--bg));
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
    }

    .scope strong {
      display: inline-block;
      margin-bottom: 4px;
      color: var(--text);
      font-size: 14px;
    }

    footer {
      padding: 22px 4px 0;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    .socials {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 9px;
      margin-bottom: 15px;
    }

    .social-link {
      width: 38px;
      height: 38px;
      display: inline-grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 50%;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      transition: border-color .16s ease, background .16s ease, transform .16s ease;
    }

    .social-link:hover,
    .social-link:focus-visible {
      border-color: color-mix(in srgb, var(--brand) 58%, var(--line));
      background: var(--brand-soft);
      color: var(--brand);
      transform: translateY(-1px);
      outline: none;
    }

    .social-link svg {
      width: 18px;
      height: 18px;
      display: block;
      fill: currentColor;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .social-link .stroke-only { fill: none; stroke-width: 1.9; }
    .copyright { margin: 0; }

    @keyframes pulse {
      0%, 100% { opacity: .55; transform: scale(.92); }
      50% { opacity: 1; transform: scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .status-dot { animation: none; }
      .social-link { transition: none; }
    }

    @media (max-width: 560px) {
      body { padding: 16px 12px 24px; }
      .brand-row { align-items: center; }
      .brand-logo { width: 106px; }
      .status-chip { font-size: 10px; padding: 6px 9px; }
      .card { border-radius: 22px; }
      .content { padding: 24px 18px 24px; }
      .maintenance-artwork { width: min(100%, 460px); max-height: 280px; }
      .countdown-wrap { padding: 16px 12px; }
      .countdown { gap: 7px; }
      .time-box { padding: 16px 4px 13px; border-radius: 13px; }
      .time-value { font-size: clamp(26px, 9vw, 36px); }
      .time-unit { font-size: 9px; letter-spacing: .06em; }
      .scope { padding: 15px 16px; }
    }

    @media (max-width: 390px) {
      .status-chip span:last-child { display: none; }
      .status-chip { width: 30px; justify-content: center; padding: 0; }
      .countdown-wrap { padding-inline: 10px; }
    }
  </style>
</head>
<body>
  <main class="maintenance-shell">
    <div class="brand-row">
      <a class="brand-link" href="/" aria-label="SautiLink home">
        <img class="brand-logo" src="/logo.png" alt="SautiLink" width="118" height="57">
      </a>
      <div class="status-chip" aria-label="Maintenance in progress">
        <span class="status-dot" aria-hidden="true"></span>
        <span>Maintenance in progress</span>
      </div>
    </div>

    <section class="card" aria-labelledby="maintenance-title">
      <div class="accent" aria-hidden="true"></div>
      <div class="content">
        <div class="artwork-wrap">
          <img class="maintenance-artwork" src="${MAINTENANCE_ARTWORK_DATA_URL}" alt="SautiLink system maintenance in progress" width="480" height="309">
        </div>

        <p class="eyebrow">Major system upgrade</p>
        <h1 id="maintenance-title">We are upgrading SautiLink.</h1>
        <p class="lead">
          SautiLink is temporarily unavailable while we carry out major improvements across the entire platform. We are upgrading core infrastructure to make the service faster, safer and more reliable.
        </p>

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

        <div class="scope">
          <strong>What is being improved?</strong><br>
          This maintenance covers servers, security, platform infrastructure, performance, reliability and other core SautiLink systems.
        </div>
      </div>
    </section>

    <footer>
      <nav class="socials" aria-label="Official SautiLink social media channels">
        <a class="social-link" href="https://facebook.com/sautilink" target="_blank" rel="noopener noreferrer" aria-label="Facebook" title="Facebook">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.8 22v-8.5h2.9l.43-3.35H13.8V8.01c0-.97.27-1.63 1.67-1.63h1.79V3.39c-.31-.04-1.37-.13-2.6-.13-2.57 0-4.33 1.57-4.33 4.45v2.44H7.42v3.35h2.91V22h3.47Z"/></svg>
        </a>
        <a class="social-link" href="https://twitter.com/@sautilink" target="_blank" rel="noopener noreferrer" aria-label="X" title="X">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.3 3h4.15l4.43 5.92L18.2 3H21l-6.82 8.03L21.5 21h-4.16l-4.83-6.46L6.94 21H4.13l7.08-8.34L4.3 3Zm3.07 2.1 10.99 13.8h1.08L8.46 5.1H7.37Z"/></svg>
        </a>
        <a class="social-link" href="https://linkedin.com/company/sautilink" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" title="LinkedIn">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.4 8.6H2.2V21h3.2V8.6ZM3.8 3a1.86 1.86 0 1 0 0 3.72A1.86 1.86 0 0 0 3.8 3ZM21 13.9c0-3.74-2-5.48-4.67-5.48-2.15 0-3.12 1.18-3.66 2.01V8.6H9.48V21h3.19v-6.14c0-1.62.31-3.19 2.32-3.19 1.98 0 2 1.85 2 3.29V21H21v-7.1Z"/></svg>
        </a>
        <a class="social-link" href="https://instagram.com/sautilink" target="_blank" rel="noopener noreferrer" aria-label="Instagram" title="Instagram">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect class="stroke-only" x="3" y="3" width="18" height="18" rx="5"></rect><circle class="stroke-only" cx="12" cy="12" r="4.2"></circle><circle cx="17.4" cy="6.7" r="1.15" stroke="none"></circle></svg>
        </a>
        <a class="social-link" href="https://youtube.com/@sautilink" target="_blank" rel="noopener noreferrer" aria-label="YouTube" title="YouTube">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.4 7.1a2.8 2.8 0 0 0-1.97-1.98C17.7 4.65 12 4.65 12 4.65s-5.7 0-7.43.47A2.8 2.8 0 0 0 2.6 7.1 29.3 29.3 0 0 0 2.13 12c0 1.64.16 3.27.47 4.9a2.8 2.8 0 0 0 1.97 1.98c1.73.47 7.43.47 7.43.47s5.7 0 7.43-.47a2.8 2.8 0 0 0 1.97-1.98c.31-1.63.47-3.26.47-4.9s-.16-3.27-.47-4.9ZM10 15.18V8.82L15.5 12 10 15.18Z"/></svg>
        </a>
        <a class="social-link" href="https://t.me/sautilink" target="_blank" rel="noopener noreferrer" aria-label="Telegram" title="Telegram">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.5 3.7 18.7 20c-.22 1.15-.8 1.43-1.62.89l-4.26-3.14-2.06 1.98c-.23.23-.42.42-.86.42l.31-4.34 7.9-7.14c.34-.31-.08-.48-.53-.17L7.82 14.65l-4.2-1.31c-1.15-.36-1.17-1.15.24-1.7L20.28 5.3c.96-.35 1.8.23 1.22 1.4Z"/></svg>
        </a>
        <a class="social-link" href="https://tiktok.com/@sautilink" target="_blank" rel="noopener noreferrer" aria-label="TikTok" title="TikTok">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.3 3c.35 2 1.5 3.2 3.7 3.33v2.72a7.52 7.52 0 0 1-3.67-.92v5.4c0 4.64-5.03 6.57-8.03 4.3-1.93-1.46-2.37-4.08-1.18-6.13 1.19-2.05 3.55-2.9 5.73-2.18v2.8c-.5-.16-1.04-.18-1.56-.05-1.19.3-1.92 1.49-1.62 2.68.3 1.19 1.5 1.91 2.69 1.61.98-.25 1.66-1.13 1.66-2.14V3h2.28Z"/></svg>
        </a>
      </nav>
      <p class="copyright">© 2026 SautiLink. All rights reserved.</p>
    </footer>
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
    'Content-Security-Policy': "default-src 'none'; font-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });

  return new Response(request.method === 'HEAD' ? null : MAINTENANCE_HTML, {
    status: 200,
    headers,
  });
}
