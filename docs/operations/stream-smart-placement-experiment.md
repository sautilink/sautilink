# Stream Smart Placement experiment

Enable `placement.mode: smart` for the existing `sautilink-social-production`
Worker. The first-frame measurements after the Stream startup changes remain
3.8–7.2 seconds (median 5.1 seconds) on the operator's Samsung. Individual
authorized HLS requests still include a fresh Supabase permission check; the
database is in `eu-west-1`. This experiment asks Cloudflare to evaluate placement
using total request duration, including forwarding time. It does not pin Ireland
or change authorization, bindings, routes, assets, schedules, environment values,
provider storage, or the number of Workers.

[Cloudflare's placement documentation](https://developers.cloudflare.com/workers/configuration/placement/)
states that Smart Placement is available on all Workers plans. It may take up to
15 minutes to analyze sufficient traffic and only considers locations where this
Worker has already run. Check placement status and ordinary invocation/billing
metrics; an enabled setting does not prove that remote placement is active.

## Validation and acceptance

Before deployment, run the focused configuration test, `npm run check`, and
`npm run deploy:production:dry`. Compare the parsed production configuration
against the reviewed parent revision with `placement` removed; no other field
may change. The normal reviewed production CI and deployment pipeline apply.

After deployment, repeat the same authenticated Home-video first-frame tests
using the same APK, account, network and clips. Record cold and warm startup
times, end-to-end HTTP duration and request counts, then compare medians and slow
requests with the pre-experiment sample. Numeric `Server-Timing` components are
diagnostic: lower RLS time alone is not acceptance, because a forwarding hop can
move latency outside those measurements. Do not log credentials or capability
URLs. Wait for placement analysis before drawing a conclusion.

Also smoke-test static app navigation, image loading, DM connection/reconnection,
and Story playback. Only fetch handlers are placed; scheduled cleanup and the
Durable Object's own location remain as before. Because this Worker uses
`assets.run_worker_first: true`, the forwarding cost can also affect app assets;
see [Cloudflare's assets binding documentation](https://developers.cloudflare.com/workers/static-assets/binding/).

Keep the experiment only if device startup improves without a material
regression in these other requests. If it is slower or cannot collect enough
traffic for a useful evaluation, remove the `placement` block and its focused
test through the same reviewed pipeline. That returns to the prior placement
behavior; no data migration or cleanup is required.
