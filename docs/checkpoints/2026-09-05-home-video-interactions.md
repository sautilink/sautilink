# Home video interaction checkpoint

Date: 2026-09-05

## Locked behavior

- Home feed videos are muted, inline and looping, and autoplay only when at least 58% visible. Only the most visible eligible video plays; the rest pause.
- Home feed video playback pauses while the document is hidden or the full media viewer is open.
- Double tap works only on Home post/media surfaces. It adds a like when needed, never removes an existing like, and leaves comments, repost, share, save, links and other controls unchanged.
- A single media tap still opens the full viewer after the short double-tap recognition window; keyboard activation remains immediate.

## Preserved contracts

- The existing branded profile loading/unavailable module and its adaptive dark/light styling remain unchanged.
- No database, Supabase policy, profile discoverability, post mutation or media delivery contract changed.
- Existing verification badge sizes and light/dark badge asset rules remain unchanged.
- Sautify, Discover, Saved, conversation and Circle feed interactions do not receive Home autoplay or double-tap behavior.
- The existing five-item media carousel behavior remains part of the canonical build.
- Production remains `sautilink.com`.

## Release markers

- App assets: `20260905-profilevideo`.
- Service Worker: `sautilink-shell-v42`.
- Release generation remains `31`.

## Verification state

- Targeted Home, profile-state and carousel regression tests: **17/17 PASS**.
- Staging artifact verification: **PASS** with 81 allowlisted files.
- Production artifact verification: **PASS** with 41 release files.
- Full automated test suite: **309/309 PASS**.
