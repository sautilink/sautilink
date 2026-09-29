# Phone OTP delivery through SwalaSMS

The SautiLink web app uses Supabase Auth to generate and verify phone codes. The existing `sautilink-whatsapp-otp` Send SMS Hook delivers those codes through SwalaSMS or WhatsApp; it never stores or verifies a second OTP.

## Production activation

1. In the production Supabase project's Edge Function secrets, set `SWALA_SMS_API_KEY` to a **live** SwalaSMS API key and `SWALA_SMS_SENDER_ID` to the approved value `SautiLink`. Confirm the key has a funded wallet and an enabled SMS route for the intended destinations. Do not put the key in git or in browser code.
2. Keep the existing signed Supabase Auth **Send SMS Hook** pointed at `sautilink-whatsapp-otp` with its matching `SEND_SMS_HOOK_SECRET`. Keep its `verify_jwt` setting disabled: the function checks the webhook signature itself. Phone Auth must remain enabled.
3. After deploying the updated function, set `SWALA_SMS_ENABLED=true` in its secrets to expose SMS in the app. `GET /functions/v1/sautilink-whatsapp-otp` must return `data.channels.sms: true` before testing a phone link. Keep the WhatsApp secrets and `WHATSAPP_OTP_ENABLED` as configured if WhatsApp should remain available.
4. Sign in with a verified email account, open Settings, choose SMS, link a real phone number, receive the code, verify it, sign out, and sign in with that phone code. Check delivery records in SwalaSMS separately: HTTP 202 means queued, not delivered to the handset. Test the WhatsApp choice with a previously linked account too.

New phone links default to SMS when configured. Previously linked accounts without a saved choice default to WhatsApp when it is configured. Choosing a channel updates the same Supabase user's metadata; it does not change the user's identity or signup requirements. If a provider explicitly rejects a send, the hook tries the other configured channel. An ambiguous timeout or server error fails the request instead of sending the same code twice.

To pause SwalaSMS delivery, set `SWALA_SMS_ENABLED=false`. The existing WhatsApp path remains available when configured. Never use a sandbox SwalaSMS key for a live OTP test, since a sandbox request does not deliver a real message.
