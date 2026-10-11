# Third-party notices

SautiLink uses the following open-source packages in the current web and
preview toolchain. Installed package versions are pinned in `package-lock.json`;
the loading-animation runtime is separately pinned and self-hosted under
`assets/vendor/lottie-web/`.

| Package | Version | License | Use |
| --- | --- | --- | --- |
| `@supabase/supabase-js` | 2.112.3 | MIT | Authentication and database client for the Phase 1 app |
| `react` | 19.2.8 | MIT | App-shell preview UI |
| `react-dom` | 19.2.8 | MIT | Browser rendering |
| `lucide-react` | 1.34.0 | ISC | Interface icons |
| `vite` | 8.2.2 | MIT | Preview build tool |
| `@vitejs/plugin-react` | 6.1.0 | MIT | React transform for Vite |
| `esbuild` | 0.28.2 | MIT | Existing Phase 1 app bundle |
| `wrangler` | 4.125.0 | MIT OR Apache-2.0 | Cloudflare development and deployment CLI |
| `lottie-web` | 5.13.0 light build | MIT | Self-hosted SVG runtime for the SautiLink loading animation |

Their copyright and license texts remain available in the installed packages,
the vendored runtime notice, and their upstream repositories. This notice does
not cover transitive dependencies; the lockfile and automated license inventory
remain the source for release audits.

## Telegram Web K verification vector

The SautiLink verification SVGs at `app/assets/verification/verified-team.svg`,
`verified-user-primary.svg`, and `verified-user-secondary.svg` adapt the
`verified-icon-background` vector from Telegram Web K's public `index.html`:
https://github.com/TelegramOrg/Telegram-web-k/blob/master/index.html

Original project: Telegram Web K (TelegramOrg), licensed under GNU GPL v3.
The original license accompanies these assets in
`app/assets/verification/LICENSE-GPL-3.0.txt`. SautiLink has modified colors
and placed a white backing behind the cut-out checkmark. SVG source for the
modified badges is included with the distributed app and public repository.

This reuse does **not** imply that Telegram endorses or is affiliated with
SautiLink. Use as a distinct official product brand identifier may require
additional trademark/design-right review beyond open-source code licensing.
