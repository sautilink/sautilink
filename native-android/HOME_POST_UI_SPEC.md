# SautiLink Native — Home Post UI Specification (Design v1.0)

**Status:** Owner design direction, pending Samsung visual approval.  
**Reference:** Two web Home post screenshots supplied on 12 October 2026, plus the old Native Samsung screenshots.  
**Stack:** Kotlin + Jetpack Compose; **Inter** is the official typeface.  
**Scope:** Presentation and existing callbacks only. Do not alter backend, permissions, APIs, feed query semantics, signed release pipeline, or publishing status.

## Product target

Preserve the web post's familiar content order while presenting it as a polished, fluid Android-native social card:

**Author header → Caption → Edge-to-edge media → Compact actions → Optional verified audience label.**

Keep the app's SautiLink identity, not a literal iOS control clone. Brand blue `#0866FF` for selected/action states, red `#ED344B` for liked state. White or near-white surfaces in light theme; high-contrast neutral dark surfaces in dark theme. No oversized gray card or developer-facing text on a production Home.

## Layout tokens (density-independent dp, text sp)

| Component | Target |
| --- | --- |
| Home feed horizontal gutter | 0–10dp; posts visually span nearly all available width |
| Gap between post surfaces | 8–12dp |
| Post background | White in light; theme surface in dark |
| Post radius | 12–16dp, low/no shadow; 1dp subtle divider or outline if required |
| Header padding | 12–14dp horizontal; 12dp vertical |
| Avatar | 44×44dp circle |
| Avatar/name gap | 9–10dp |
| Author name | Inter SemiBold, 15–16sp, one line with ellipsis |
| Verified badge | Existing server-controlled SautiLink asset, 15–17dp, 4dp name gap |
| Handle | 13sp muted, one line with ellipsis |
| Follow button | 32–36dp visual height, 12–14dp corner radius, quiet outline or tonal fill; 48dp accessible click target |
| Overflow/options | 48×48dp click target, visually 20–22dp three-dot icon |
| Timestamp | 12–13sp muted; compact relative units |
| Caption | 15–16sp regular, 21–24sp line height, 12–14dp horizontal and 8–12dp vertical spacing |
| Media | Full post content width with **no extra inset inside the card**, natural aspect when available |
| Media corner | 0–10dp as needed within enclosing post shape; no oversized cropping |
| Media play control | Centered overlay, 44–52dp visual circle, accessible hit area |
| Action rail | 52–56dp height, white/neutral background; icons 22–24dp; click targets ≥48dp |
| Footer visibility | 12sp muted; only when API provides trustworthy visibility; hide otherwise |

Dimensions are targets, not absolute pixel positions. Adapt gracefully to 320dp narrow devices, font scaling, RTL, insets and landscape.

## Header behavior

1. Left: author avatar, display name and **correct original verified badge** on first line, handle on second.
2. Right: `Follow` / `Following` and a three-dot action. Keep underlying Follow semantics exactly as implemented.
3. Relative time: display `11h`, `3d`, `1w`, `2mo`, etc., derived from authoritative ISO timestamp. On widths ≥400dp it may sit at far right as in web; on narrower displays, append `· 11h` after handle or below name. Do not squeeze the display name or overlap buttons.
4. Tapping avatar/name navigates to profile; overflow goes to existing post details/safety flow, without changing authorization.
5. Loading relationship state must not block the header or surface developer-status prose. Actionable failures must remain recoverable.

## Caption and media

- Caption stays **above media**, matching the web Home order.
- Caption renders independently from media container, even for 2+ media items; never overlay caption or treat it as part of a collage.
- Media should visually span the card's width. Use actual aspect metadata/intrinsic dimensions when available and sensible placeholders when unavailable. Never stretch, inadvertently crop faces, or make all videos square by default.
- Multiple images/videos maintain original ordering and an accessible gallery layout. Open the existing viewer on tap.
- A video poster is not automatically evidence of playback. Keep existing authenticated Media3 playback, user mute choice and loading/error controls unchanged.
- Do not copy web-only "Install SautiLink" overlay into the native app.

## Action rail

Single horizontal row in this order:

`♥ Like + count` · `Comment + count` · `Repost + count` · `Share` · **`Save` aligned far right**.

- Unlike the older Android design, **do not** place actions in two rows.
- Counts compact: `0`, `4`, `1.2K`, `2.3M`, next to relevant icon only.
- Like red when active; Repost/Save use selected brand-blue state. Other icons neutral, not five identical bright-blue controls.
- Save is icon-only at the far right with TalkBack label `Save post` / `Remove from saved`.
- Keep independent request/optimistic-state logic for Like, Save, Repost and Follow. Unknown backend status must not imply a user has unliked/unsaved/unfollowed.
- Share opens Android native chooser. Opening a chooser is not proof of a completed share.
- Buttons must maintain at least 48dp hit areas even on compact widths.

## Time presentation

Use the shared `relativePostTime()` formatter for Home post and comment timestamps and Post Detail.

- Under 1 minute: `now`; <60m: `Xm`; <24h: `Xh`; <7d: `Xd`; <30d: `Xw`; <365d: `Xmo`; ≥365d: `Xy`.
- Parse timestamp offsets correctly; clamp server/device clock-skew to `now`.
- If parsing fails, show a safe fallback rather than inventing a time.
- Recompute relative labels when feed is refreshed/resumed; do not continuously rerender every post each second.

## Conditional audience footer

The web reference shows `Public`, but the current Native `StagingFeedPost` model does **not** expose a visibility attribute. Therefore **hide the audience footer by default**. Only show `Public`, `Followers` or equivalent if reliably supplied by an authorized existing API response. Never label non-public content as public based on assumption. No schema migration for a visual-only PR.

## Quality gates

- Light/dark screenshot comparison against owner web reference at 320, 360/393 and ≥400dp width.
- Samsung SM-A057F: full-width media, no top blank strip, no clipped name/badge, no overlapping Follow/time/options.
- Author name, verified badge, caption and video/image remain in the correct order.
- Like, Save, Follow, Comment, Repost, Share and overflow/deeplink remain functional; staging remains read-only.
- Verify 1h, 1d, 1w and month boundary cases; time-zone offsets; device clock skew.
- Test TalkBack, font scaling 130–200%, 48dp touch targets, navigation bar and system status bar, reduced-motion preferences.
- GitHub Native Android build/lint and Brand Guard must pass; inspect new preview APK on physical Samsung before approval.
- **Do not merge/publish to Google Play without explicit owner UI/UX signoff.**

## Implementation map

- `feature/home/StagingFeedScreen.kt`: `RealPostCard`, author header, caption, actions, relative labels.
- `feature/home/ProductionFeedMedia.kt`: media sizing/corners and viewer handoff, preserving Media3 transport.
- `ui/components/Components.kt`: shared bottom navigation.
- `feature/home/NativePostDetailScreen.kt`: timestamp consistency.
- Keep the current release work in PR #351 separate. UI design review continues in stacked draft PR #352.

**Design acceptance:** Web-inspired layout and interaction hierarchy, natively smooth presentation, consistent brand system, and owner-approved Samsung visual results.