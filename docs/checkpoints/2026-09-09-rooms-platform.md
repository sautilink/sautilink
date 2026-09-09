# Rooms platform production checkpoint

**Date:** 2026-09-09  
**Canonical product name:** Rooms  
**Merged feature PR:** `sautilink/sautilink#77`  
**Feature production merge commit:** `e91f17cfdeb55c54d0aa187824a8d0e2416dc2cc`  
**Runtime wiring PR:** `sautilink/sautilink#78`  
**Current Rooms runtime production commit:** `f6fb9ec8e8f765164d814796fa0dd0db222ebf2f`

## Product decision

The former user-facing Sautify community experience is replaced by **Rooms**. Rooms are SautiLink's group/community product. Historic internal `social_circle*` database identifiers are intentionally retained so the change does not require a destructive data migration. Historic `/sautify` and `/app/circles` links remain readable for backward compatibility, while `/rooms` is canonical.

## Delivered Rooms capabilities

- Room names and canonical Room usernames/routes (`/rooms/<username>`).
- Topic/category discovery, including Technology & AI, Learning & Education, Business & Entrepreneurship, Marketplace & Trading, Creators & Media, Fashion & Style, Friends & Community, Gaming, Sports & Fitness, Music, Arts & Culture, Science, Health & Wellness, Travel, Local Community, Family & Parenting, Food & Cooking, Hobbies & Interests, and General.
- Public and Private Room content settings. Private Room metadata can be discovered so a member can understand its topic before requesting access; Room posts remain membership-gated.
- Cover photos backed by the existing production/staging R2 media boundary, with authenticated manager-only mutation and server-side image validation.
- Owner, Admin, Moderator and Member roles with database-enforced role transition/removal boundaries.
- Per-Room posting permission (`all_members` or `staff_only`).
- Per-Room invitation permission (`all_members` or `staff_only`).
- Recipient-controlled Room invitations with Accept/Decline and safe re-invitation after a declined invitation is cleared.
- Denormalized member counts maintained by trigger for Room discovery cards.
- Room posts can participate in Home only for a viewer who is authorized by the existing `social_posts` RLS membership boundary. Non-members cannot read Room posts through Home.

## Safety boundary

No destructive rename of `social_circles`, `social_circle_members`, `social_circle_join_requests`, `circle_id`, or other established persistence identifiers was performed. Existing unrelated social, identity, messaging, moderation, media and account-control systems were not structurally replaced by this work.

## Database rollout

The Rooms migrations were applied successfully to both Supabase environments:

- staging: `bbrydwzlhweuqxpgbahu`;
- production: `rggpyiterdbbugluejcs`.

Applied migration units:

1. `enable_rooms_platform`
2. `add_room_member_counts`
3. `refine_room_discovery_and_requests`
4. `enable_room_invitations`
5. `allow_room_reinvites`

Post-rollout schema checks confirmed the Room metadata/member-count columns, Room RLS policies, invitation policies and the security-invoker Home stream view are present in production. Supabase security advisor checks reported no new Rooms-specific finding; the remaining warnings are pre-existing account/auth advisories unrelated to Rooms.

## Verification and deployment

PR #77 head `33d6bc5adc3d8fd1754f6c941677821dd7973d70` passed all required repository workflows before merge:

- SautiLink Brand Guard — PASS
- Phase 1 Authentication — PASS
- Phase 32 Production Launch — PASS

The first main-branch rollout at feature merge commit `e91f17cfdeb55c54d0aa187824a8d0e2416dc2cc` completed successfully:

- SautiLink Brand Guard run `34298736789` — PASS
- Phase 1 Authentication run `34298736779` — PASS
- Phase 32 Production Launch run `34298736854` — PASS, including production build/verification and live cutover checks.

### Runtime wiring correction

A post-merge audit found that `package.json` passed the new Rooms files as `--inject` CLI arguments, while the actual `scripts/build-app.mjs` builder used its own hardcoded esbuild `inject` array and did not consume those arguments. This meant the repository feature code existed but its browser runtime was not guaranteed to be present in the generated production app bundle.

PR #78 fixed only that wiring boundary by explicitly adding these modules to the real builder:

- `src/rooms-platform.js`
- `src/rooms-invitations-style.js`
- `src/rooms-invitations.js`

A regression test now checks both the real build configuration and the generated `app/assets/app.js` artifact for Rooms runtime markers. PR #78 head `a51adf5eb1f6fe5588547b3cc7a4cc571b681560` passed Brand Guard, Phase 1 build/test/deploy validation and Phase 32 production verification before squash merge.

The corrected main commit `f6fb9ec8e8f765164d814796fa0dd0db222ebf2f` then passed:

- SautiLink Brand Guard run `34299565287` — PASS
- Phase 1 Authentication run `34299565259` — PASS, including successful `test.sautilink.com` deployment/readiness verification
- Phase 32 Production Launch run `34299565192` — PASS, including full production build, R2 check, Worker deployment and live production cutover verification

No additional database changes were required for PR #78.

## Continuity rule

Future community work should use **Room / Rooms** in user-facing product language. Legacy Sautify/Circles terms may remain only where required for backward-compatible routes, historical tests/migrations, or stable internal persistence identifiers.