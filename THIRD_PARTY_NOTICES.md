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
