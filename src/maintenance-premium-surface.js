import { handleMaintenanceRequest as handleBaseMaintenanceRequest } from './maintenance-page.js';

export const MAINTENANCE_BLACK_SPECKLE_CSS = `
    body {
      position: relative;
      isolation: isolate;
      overflow-x: hidden;
      background:
        radial-gradient(circle at 50% -8%, rgba(255, 255, 255, .055), transparent 31%),
        radial-gradient(circle at 50% 118%, rgba(255, 255, 255, .028), transparent 30%),
        #050505;
    }

    body::before,
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
    }

    body::before {
      background-image:
        radial-gradient(circle, rgba(255, 255, 255, .34) 0 1px, transparent 1.35px),
        radial-gradient(circle, rgba(255, 255, 255, .17) 0 .8px, transparent 1.2px),
        radial-gradient(circle, rgba(148, 163, 184, .18) 0 1px, transparent 1.4px);
      background-position: 8px 13px, 27px 31px, 51px 7px;
      background-size: 43px 43px, 61px 61px, 79px 79px;
      opacity: .58;
    }

    body::after {
      background:
        radial-gradient(circle at 50% 40%, transparent 0 38%, rgba(0, 0, 0, .22) 72%, rgba(0, 0, 0, .68) 100%),
        repeating-radial-gradient(circle at 17% 29%, rgba(255, 255, 255, .04) 0 .7px, transparent .8px 8px);
      opacity: .72;
    }

    .maintenance-shell {
      position: relative;
      z-index: 2;
    }

    .maintenance-shell::before {
      content: "";
      position: absolute;
      inset: 72px -34px 48px;
      z-index: -1;
      pointer-events: none;
      border-radius: 34px;
      background: rgba(255, 255, 255, .025);
      filter: blur(34px);
    }

    .brand-logo {
      width: 82px;
      height: auto;
    }

    .card {
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
      background: #ffffff;
      color: var(--text);
      box-shadow:
        0 28px 78px rgba(0, 0, 0, .48),
        0 0 0 1px rgba(255, 255, 255, .035),
        var(--shadow);
    }

    h1 {
      font-size: clamp(28px, 5vw, 40px);
      line-height: 1.08;
      letter-spacing: -.042em;
    }

    .lead {
      margin-top: 17px;
      font-size: clamp(15px, 2.3vw, 17px);
      line-height: 1.6;
    }

    @media (max-width: 560px) {
      .brand-logo { width: 74px; }
      h1 { font-size: clamp(27px, 8.4vw, 34px); }
      .lead { font-size: 15px; }
      .maintenance-shell::before { inset: 68px -18px 40px; filter: blur(28px); }
    }
`;

function injectPremiumBackground(html) {
  const styleClose = '</style>';
  if (!html.includes(styleClose)) return html;
  return html.replace(styleClose, `${MAINTENANCE_BLACK_SPECKLE_CSS}\n  ${styleClose}`);
}

export async function handleMaintenanceRequest(request, url) {
  const response = handleBaseMaintenanceRequest(request, url);
  if (!response || request.method === 'HEAD' || response.status !== 200) return response;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  return new Response(injectPremiumBackground(html), {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}
