# SautiLink checkpoint — on-demand post translation

Date: 2026-09-12
Branch: `feat/post-translation`
Target: production `main`

## Product behavior

- English remains the default translation target.
- English posts do not show a translation control.
- Conservatively detected Kiswahili and French post captions show `Translate this post`.
- Translation starts only after the viewer taps the control; feed loading does not call the translation model.
- While the request is in flight, only that post shows `Translating…`; the page does not reload.
- A successful translation replaces the visible caption with English and changes the control to `See Original Post`.
- `See Original Post` restores the original author text.
- The original post body is never rewritten by translation.

## Architecture

- Browser UI: `src/post-translation.js`.
- Worker endpoint: `POST /api/post-translations/:postId` in `src/post-translation-api.js`.
- Translation model: Cloudflare Workers AI `@cf/meta/m2m100-1.2b`.
- Supported source languages in v1: `sw`, `fr`.
- Target language in v1: `en`.
- Translation stylesheet: `app/assets/post-translation.css`.
- No database migration and no translation table were added.

## Privacy and authorization boundary

The browser sends only the post ID and the detected source language. The Worker reads the canonical post body itself through Supabase using the viewer Bearer token. Supabase RLS is therefore authoritative for whether the viewer may access the source post.

The Worker performs authentication and the RLS-backed post read before consulting the shared edge translation cache. A cached translation must never bypass post visibility, block, privacy, or other RLS rules.

## Cost and load controls

- No automatic feed-wide AI calls.
- One Workers AI request only on a cache miss after a viewer explicitly taps Translate.
- Successful translations are edge-cached by post ID, source language, body digest and English target so edits invalidate naturally.
- In-page memory also prevents duplicate requests while the current page remains open.
- New AI translations are protected by `POST_TRANSLATION_LIMITER` at 30 cache misses per minute per authenticated viewer.
- Post text remains capped at the existing 500-character post limit for translation.

## Language detection

Language detection is deliberately local and conservative. Clear Kiswahili and French captions get the control; clear English captions do not. Ambiguous text is left untouched rather than showing a possibly incorrect translation control or making an AI request during feed rendering.

## Production build correction discovered during this work

The isolated production release builder rebuilt `app.js` with its own inject list and was missing the already-merged `language-preference.js` module. That explains why Language Preference could exist in source but be absent from the final production browser bundle. The production builder now injects both `language-preference.js` and `post-translation.js`. A dedicated production-artifact verifier fails the release if either feature is absent from the actual deployed bundle.

## Safety scope

This feature does not change:

- Supabase schemas or migrations
- authentication/session semantics
- post create/edit/delete behavior
- comments, likes, reposts, follows or saves
- R2 media storage or responsive image logic
- Messages, Rooms/Sautify, profiles or moderation behavior
- original user-authored post text

Merge only after full repository verification, production artifact verification, authentication checks and production deployment checks pass on the exact PR head.
