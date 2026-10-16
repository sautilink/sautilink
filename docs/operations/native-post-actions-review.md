# Compact native post actions

Owner follow-up, 16 October 2026, on Draft PR #352. Continue from `0b155e1417c2105fcea8100f8d3e3f860263b050`.

## Cause and targeted change

Home's four leading actions each used `weight(1f)`, spreading them across the row despite the existing comment describing a compact group. Post Detail used `SpaceBetween`; profile activity and Room posts also distributed the actions. Room counters were stacked below their icons.

One shared horizontal layout now groups Like, Comment, Repost and Share at the start, with Save outside the group at the end. Leading glyphs are 20dp, with a 2dp icon/count gap and no extra gap between the minimum 48dp touch targets. Home Save is 24dp inside a 48dp target. Other Save artwork remains at its existing size. Counters retain their existing values and formatting. If large text or a narrow display overflows, the leading group can scroll horizontally while Save remains available.

The five-file change covers Home, Post Detail, profile activity and Room post cards. It preserves each caller's existing Like artwork, handlers, pending/online guards and state updates. The Room count is now part of the same accessible button as its icon, retaining press/tint animation. Shorts' vertical rail and all player/media/quality code are unchanged. No backend, configuration, auth or route changes.

## Review and verification

- Owner reference image inspected; source cause confirmed before editing.
- Two independent source reviews completed. Final proposal SHA256: `d014031bddba270cd6f3498df503beb1ba9110dddf8ce4d73d2b399097124ee4`.
- Patch preflight passed; applied only after the prior immutable RoomsQA build/full lint finished PASS.
- New exact-source Android assembly/full lint and Samsung layout/tap verification are **PENDING**. No device PASS is inferred from source review.
- Live checks should cover grouping, count/selected state, Comments, Share cancellation, Save, Back, vertical scrolling and enlarged text. Record the actual surfaces exercised and any untested cases.

The separate entity-link canonical-handle fix is included in the parent checkpoint and still needs its Samsung retest. Earlier HTTP500/timeout investigation and broader Final QA remain OPEN. No merge or publication is authorized.
