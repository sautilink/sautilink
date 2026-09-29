import { handleMaintenanceRequest as handleBaseMaintenanceRequest } from './maintenance-page.js';

export const TANZANIA_PREMIUM_BACKGROUND_CSS = `
    :root {
      --tz-green: #1eb53a;
      --tz-blue: #00a3dd;
      --tz-yellow: #fcd116;
      --tz-black: #000000;
    }

    body {
      position: relative;
      isolation: isolate;
      overflow-x: hidden;
      background:
        radial-gradient(circle at 12% 10%, color-mix(in srgb, var(--tz-green) 20%, transparent), transparent 34%),
        radial-gradient(circle at 88% 16%, color-mix(in srgb, var(--tz-blue) 22%, transparent), transparent 38%),
        radial-gradient(circle at 50% 96%, color-mix(in srgb, var(--tz-yellow) 13%, transparent), transparent 34%),
        var(--bg);
    }

    body::before,
    body::after {
      content: "";
      position: fixed;
      pointer-events: none;
      z-index: 0;
    }

    body::before {
      inset: -32vmax;
      background:
        radial-gradient(circle at 19% 24%, rgba(30, 181, 58, .92) 0 8%, rgba(30, 181, 58, .48) 18%, transparent 36%),
        radial-gradient(circle at 80% 22%, rgba(0, 163, 221, .95) 0 8%, rgba(0, 163, 221, .50) 20%, transparent 39%),
        radial-gradient(circle at 72% 77%, rgba(252, 209, 22, .78) 0 7%, rgba(252, 209, 22, .34) 17%, transparent 34%),
        radial-gradient(circle at 28% 78%, rgba(0, 0, 0, .88) 0 8%, rgba(0, 0, 0, .34) 19%, transparent 36%);
      filter: blur(58px) saturate(138%);
      opacity: .82;
      transform: translate3d(0, 0, 0) scale(1.07) rotate(-1deg);
    }

    body::after {
      inset: -24%;
      background:
        conic-gradient(
          from 118deg at 50% 50%,
          rgba(30, 181, 58, .34),
          rgba(252, 209, 22, .24),
          rgba(0, 0, 0, .26),
          rgba(0, 163, 221, .38),
          rgba(30, 181, 58, .34)
        );
      filter: blur(46px) saturate(150%);
      mix-blend-mode: soft-light;
      opacity: .68;
      transform: scale(1.22) rotate(8deg);
    }

    .maintenance-shell {
      position: relative;
      z-index: 2;
    }

    .maintenance-shell::before {
      content: "";
      position: absolute;
      inset: 74px -82px 66px;
      z-index: -1;
      pointer-events: none;
      border-radius: 42%;
      background:
        linear-gradient(126deg, rgba(30, 181, 58, .42), rgba(252, 209, 22, .22) 34%, rgba(0, 0, 0, .22) 52%, rgba(0, 163, 221, .46) 78%, rgba(30, 181, 58, .36));
      filter: blur(64px) saturate(140%);
      opacity: .82;
      transform: translate3d(0, 0, 0) scale(1);
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
        0 32px 90px rgba(0, 0, 0, .20),
        0 0 64px rgba(0, 163, 221, .13),
        0 0 92px rgba(30, 181, 58, .10),
        var(--shadow);
    }

    @media (prefers-color-scheme: dark) {
      body::before { opacity: .92; filter: blur(62px) saturate(152%); }
      body::after { opacity: .78; }
      .maintenance-shell::before { opacity: .94; }
      .card {
        box-shadow:
          0 34px 96px rgba(0, 0, 0, .58),
          0 0 70px rgba(0, 163, 221, .18),
          0 0 100px rgba(30, 181, 58, .14),
          var(--shadow);
      }
    }

    @media (max-width: 560px) {
      body::before { inset: -44vmax; filter: blur(48px) saturate(136%); }
      body::after { inset: -42%; opacity: .60; }
      .maintenance-shell::before { inset: 72px -34px 54px; filter: blur(48px) saturate(132%); }
    }
`;

function injectPremiumBackground(html) {
  const styleClose = '</style>';
  if (!html.includes(styleClose)) return html;
  return html.replace(styleClose, `${TANZANIA_PREMIUM_BACKGROUND_CSS}\n  ${styleClose}`);
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
