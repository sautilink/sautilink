# Compact native post actions

Owner follow-up, 16 October 2026, on Draft PR #352. Implementation checkpoint: `688dffe0b8da459a54a072522c833df1ff270009`, following `0b155e1`.

## Cause and targeted change

Home's four leading actions each used `weight(1f)`, spreading them across the row despite the existing compact-group comment. Post Detail used `SpaceBetween`; profile activity and Room posts also distributed the actions. Room counters were stacked below their icons.

One shared horizontal layout groups Like, Comment, Repost and Share at the start, with Save outside the group at the end. Leading glyphs are 20dp, with a 2dp icon/count gap and no additional gap between the minimum 48dp touch targets. Home Save is 24dp inside a 48dp target. Other Save artwork keeps its existing size. Counters retain their values and formatting. Overflow can scroll within the leading group while Save remains available.

The five-file change covers Home, Post Detail, profile activity and Room post cards. Existing artwork, handlers, pending/online guards and state updates are retained. The entire Room icon/count target is clickable and retains press/tint animation. Shorts' vertical rail and all player/media/quality code are unchanged. There are no backend, configuration, auth or route changes in this layout patch.

## Build and source gates

- Owner reference image inspected; two independent source reviews completed. Final proposal SHA256: `d014031bddba270cd6f3498df503beb1ba9110dddf8ce4d73d2b399097124ee4`.
- Both 688 QA APKs passed assembly and full lint: zero errors, 102/103 warnings and two hints. Source mirrors, APK bytes, signer and restored configuration were independently audited.
- RoomsQA APK SHA256: `4e002d6a0512462a6c3b0e80fd6628260b84f85fa7869b04e64b79d4d6b086b2`.
- D2QA APK SHA256: `a0dbfe73b4e58440b68cfc21f6db3e2250581e73e488894234cc8cd80822b3c4`.
- Both were installed with the existing signer; actual Menu identities remained `@drcharlestz` and `@utaliiplus`.
- Exact 688 GitHub checks passed: Native 38934900188, Brand 38934900446, Auth 38934900394 and APK 38934900324. These are build/source gates, separate from live results.

## Actual Samsung checks

The task workspace ledger `outputs/Native-actions-Samsung-20261016.json` records the bounded cases and their capture paths.

| Check | Actual result |
| --- | --- |
| Home, Post Detail, profile activity and Room row | PASS: screenshots viewed and XML bounds measured; leading glyphs approximately 20dp and all targets 48×48dp |
| Separate Save | PASS: Home/Detail/Room artwork approximately 24dp; existing Profile artwork approximately 21dp; right-side separation retained |
| Profile at font scale 1.3 | PASS after activity-recreation wait; original 1.0 restored in `finally` |
| Home and private Room Comments | PASS: existing sheets opened |
| Home Share | PASS: Android chooser opened, no recipient selected, Cancel returned to QA app |
| Private Room Like/Repost/Save | PASS: six add/undo events, selected colors/counts, then refreshed enabled baseline with no reaction counters |
| Entity navigation regression | PASS: nested canonical terminal-dot target and Back to original source post; detailed in the entity review |
| Owned fixture cleanup | PASS: explicit UI deletions and exact read-only aggregate Room 0/post 0/comment 0 |

The first font helper stopped before measurement while the activity recreated; it restored the original setting and is not counted as PASS. The first reaction-cycle helper recorded all six successful events but stopped at a loading skeleton during its final refresh check. A separate refreshed confirmation completed that check without repeating reactions. Both original records remain intact.

The fixture was a private one-member Room, `qa-actions-20261016-1658`, owned by `@utaliiplus`, with one text post and one synthetic comment. The comment and Room were explicitly deleted; refreshed Your rooms was empty. `outputs/Actions-688-private-fixture-cleanup.json` records exact slug/body-scoped database counts. No existing Room, recipient or invitation was changed.

## Limits and handoff

This completes the reported bounded new UI checks. New dark action-row layout, narrow/max-counter overflow, expanded accessibility testing and busy/offline action states were not all exercised live. Profile font 1.3 does not establish every screen/font combination. Actual Shorts-caption entity tapping remains untested because six scanned public captions contained no entities.

The separate HTTP 500/timeout and broader playback/network investigation remains OPEN. No Full Final QA, release or universal stability PASS is claimed. No Worker/schema deployment, PR merge or Google Play publication was performed for this UI change. D2QA was left on Home after Back/Close Menu.

Primary evidence in the task workspace: `outputs/Native-actions-688dffe-independent-gate-audit.json`, `outputs/Native-actions-Samsung-20261016.json`, `outputs/Actions-688-font-scale-retest.json`, `outputs/Actions-688-private-room-state-refresh-confirmation.json` and `outputs/Actions-688-private-fixture-cleanup.json`.
