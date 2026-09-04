# Profile avatar and verification request checkpoint

**Date:** 2026-09-04  
**Canonical repository:** `sautilink/sautilink`  
**Production destination:** `sautilink.com`

## Product decision

SautiLink uses one current `social_profiles` identity wherever a member appears. A saved profile photo must therefore replace the initial-letter fallback across Home, comments, notifications, Discover, Messages, safety lists and account chrome. The letter remains only as a safe fallback when no image exists or image delivery fails.

## Avatar contract

- social profile reads that render a compact identity include `username`, `display_name`, `avatar_key` and `updated_at`;
- one shared browser renderer builds the protected `/api/profile-media/{username}/avatar` URL and uses `avatar_key` as a cache version;
- uploaded or removed photos refresh the signed-in member chrome immediately;
- notification and message views rehydrate profiles when revisited, and active views refresh when the page regains focus;
- image loading is lazy and asynchronous, with the initial-letter fallback retained on failure;
- no R2 object key, service-role key or privileged media credential is exposed to the browser.

## Verification request contract

- **Settings > Account** displays `Verified` or `Unverified` from the canonical profile record;
- verified accounts display the existing official SautiLink PNG badge and do not receive a request action;
- unverified accounts can open an accessible modal over a blurred backdrop;
- the form collects legal name, optional public name, signed-in email, SautiLink username, category, country, public social handles, article links and a short verification reason;
- Facebook, Instagram, TikTok and YouTube inputs accept handles only and compose their known URL prefixes;
- news/blog references accept up to five full HTTP(S) URLs;
- government ID upload is explicitly excluded;
- Send remains disabled until required fields, public evidence and explicit Privacy Policy/Terms consent are valid;
- submission opens the member's email composer addressed to `team@sautilink.com`, with subject `Verification Badge Request` and a fully populated body;
- request copy sets the expected feedback window at 72 hours.

## Preserved contracts

- official verification PNG files and their approved sizing are unchanged;
- verification status remains server controlled;
- existing Like, Comment, Repost, Share, Save, theme and social navigation behavior remains intact;
- the production app continues to target the `sautilink` Supabase project and production R2 binding, never `sautilink-test`.

## Verification before merge

- canonical production Supabase profile columns: **7/7 present**;
- app and production builds: PASS;
- staging artifact allowlist/secret scan: PASS, 69 files;
- production artifact isolation/secret scan: PASS, 22 files;
- complete repository regression suite: **252/252 PASS**;
- staging Worker dry deployment: PASS;
- production Worker dry deployment: PASS.

## Deployment rule

Merge only after all canonical repository pull-request checks pass. After merge, require staging and production deployment workflows plus live `sautilink.com` smoke checks to pass before marking this checkpoint released.
