# SautiLink WhatsApp sender and messaging roadmap

Status: first-party webhook foundation only. Do not switch the production OTP sender until Meta has approved SautiLink's display name, phone number and authentication template. Existing Supabase Auth OTP, SwalaSMS fallback and email flows stay intact.

## Brand and sender setup

Business Verification, the Meta app display name, a WhatsApp Business Account (WABA), and the phone number's approved WhatsApp display name are separate.

- Meta app name: **SautiLink Corporation** (as requested).
- Desired WhatsApp sender display name: **SautiLink** (must be approved for its phone).
- The display name seen by WhatsApp recipients belongs to the phone number, not to the app's name.
- For a current number renamed from Ivy, submit the name change in WhatsApp Manager and follow Meta's re-registration instructions if required after approval. A new number needs independent ownership verification and registration.

In Meta WhatsApp Manager:
1. Confirm the verified business has the correct WABA and add a production phone number.
2. Submit **SautiLink** for display-name approval and confirm the phone is fully registered.
3. In the Meta developer app, activate WhatsApp Cloud API, assign a system user and appropriate WhatsApp asset access.
4. Generate a server-only access token with the permissions required for sending and managing templates. Never put this token in chat, GitHub, browser JavaScript or logs.
5. Create and have Meta approve an **AUTHENTICATION** OTP template (e.g. sautilink_auth_otp) in the right locale, with a copy-code button. Test its actual parameter structure with an opted-in phone before replacing the working one.
6. Confirm the handset sees the sender as **SautiLink**.

## Existing OTP path and controlled cutover

The Supabase Auth Send SMS Hook is at:
supabase/functions/sautilink-whatsapp-otp/index.ts

Supabase Auth generates, expires and verifies phone OTPs. The hook *only delivers* them. Relevant production secrets are:

- WHATSAPP_OTP_ENABLED
- WHATSAPP_GRAPH_API_VERSION
- WHATSAPP_PHONE_NUMBER_ID
- WHATSAPP_ACCESS_TOKEN
- WHATSAPP_OTP_TEMPLATE_NAME
- WHATSAPP_OTP_TEMPLATE_LANGUAGE
- SEND_SMS_HOOK_SECRET

After SautiLink phone and template approval, update the production Edge Function secrets for the new phone/token/template. Keep the Supabase Send SMS Hook configured and preserve the current SwalaSMS keys. Do a controlled single-recipient end-to-end test, confirm brand and delivery, and then expand to general traffic. No separate OTP issuer or database is needed.

## Inbound callback foundation

Files:
- supabase/functions/sautilink-whatsapp-webhook/index.ts
- supabase/functions/_shared/whatsapp-webhook-core.mjs
- supabase/migrations/20261007012900_whatsapp_inbound_foundation.sql

Meta's callback should use:
https://PROJECT_REF.supabase.co/functions/v1/sautilink-whatsapp-webhook

Use the staging project before production. The Edge Function is deployed with verify_jwt=false, since Meta does not provide a Supabase user JWT; the function instead requires Meta's own signed X-Hub-Signature-256 header on every POST.

Configure the following **server-only** secrets:
- WHATSAPP_WEBHOOK_ENABLED=false until ready
- WHATSAPP_WABA_ID — allowed WABA ID
- WHATSAPP_PHONE_NUMBER_ID — allowed business number ID
- WHATSAPP_META_APP_SECRET — app secret from Meta App Settings → Basic
- WHATSAPP_WEBHOOK_VERIFY_TOKEN — random private token at least 24 characters
- SUPABASE_URL — injected by Supabase hosted Edge Functions
- SUPABASE_SERVICE_ROLE_KEY — server-only key injected by Supabase

The webhook must fail closed when `WHATSAPP_WEBHOOK_PHONE_NUMBER_ID` is missing; it must **never** fall back to OTP's `WHATSAPP_PHONE_NUMBER_ID`. For the SautiLink number approved in October 2026 use `WHATSAPP_WEBHOOK_PHONE_NUMBER_ID=1262171266988883` and `WHATSAPP_WABA_ID=1078959525106649`. Configure the App Secret and Verify Token directly in Supabase; they are not repository content. Keep the existing OTP sender, WhatsApp access token and SwalaSMS fallback untouched until a separately tested cutover.

On the Meta app's Webhooks page, configure callback and matching verification token; subscribe to messages for whatsapp_business_account, then subscribe the app to the intended WABA through the subscribed_apps API. Activate the callback only when values and permissions are correct.

The new endpoint:
- Authenticates the raw HTTP request with HMAC before parsing; invalid signatures are rejected.
- Accepts events only for the configured WABA and phone number.
- Stores a bounded text/caption and message status; **no OTP codes, raw webhook JSON, media binaries, or access credentials**.
- Deduplicates messages and delivery status events using database unique constraints.
- Persists before acknowledging events to allow Meta retries after transient failures.
- Requires a server role for all inbox reads/writes; public and ordinary authenticated members cannot see them.

## Operator inbox must be a separate controlled phase

The webhook is only the **message-receiving backend**, not a complete support inbox. Before the first production conversation, add staff-only authenticated inbox screens, access logs, a retention/deletion schedule, a customer privacy notice, opt-out handling and customer-support response rules. Do not expose private WhatsApp messages to the normal social inbox.

## Later: provider API for other businesses

Being Meta business-verified is **not yet** approval to onboard arbitrary customer WABAs as a Tech Provider. A multi-tenant SaaS needs Meta Embedded Signup/App Review where applicable, Advanced Access for relevant permissions, authorized customer WABAs, token isolation, per-tenant data partitioning, billing/credit, opt-in management, abuse prevention, quotas, delivery telemetry, audit trails and support. Do not reuse SautiLink's first-party token/phone as a third-party sender.

References:
- https://www.postman.com/meta/whatsapp-business-platform/overview
- https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup


## First-party outbound support replies

The first reply phase is intentionally narrower than a general-purpose messaging provider.

- `public.whatsapp_outbound_messages` is the service-role-only outbound ledger with UUID idempotency keys and provider message ids for webhook status correlation.
- `public.whatsapp_support_threads` stores server-owned assignment/read state.
- `public.whatsapp_support_thread_summary` is a server-only security-invoker view used by the protected Staff Console.
- Staff can reply only to a phone number already observed in a signed inbound WhatsApp event; the first UI does not accept arbitrary destination numbers.
- Free-form replies are limited to the rolling 24-hour customer support window. Outside that window, a later template-sending workflow must be used.
- Ambiguous network outcomes are recorded as `uncertain` and must not be automatically resent.
- Meta access tokens remain server secrets and are never stored in these database tables or browser assets.

The Staff Console integration lives in the private `sautilink/staff-console` repository and is restricted to support/admin roles.
