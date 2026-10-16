# Native text entities and Create button

Owner requested clickable orange hashtags and mentions in displayed text, targeted web fixes, and the circular Create background using the existing logo's orange/pink. Current installed implementation: `688dffe0b8da459a54a072522c833df1ff270009` on both QA packages.

## Targeted scope and safeguards

- Shared native formatted-post text links only entity spans. Literal bios/comments keep their text. Composer previews remain noninteractive.
- Mentions use the existing member-profile destination. Hashtags seed existing Explore search, retaining case and literal underscores. Editable search spaces are retained; normalization occurs at commit/client boundaries.
- Canonical profile-card targets retain valid terminal dots; prose mentions still trim sentence punctuation. Email/URL fragments, Unicode-adjacent fragments and overlong tokens do not become partial internal links.
- Entity-aware formatting protects raw identifier underscores. `@cloud__engine__` stays the same target; `**@cloud__engine__**` stays bold; direct `__@foo__` and `__#Tag__` wrappers retain underline. Only a direct wrapper may close within a protected entity. Mixed phrase `__hello @cloud__engine__ world__` retains the full handle. Ambiguous suffixes remain literal. The original default formatter is unchanged.
- Create keeps its size, plus, accessibility label and action; its background uses logo endpoints `#FE682C` and `#FD3B45`.
- Entity orange is `#B84216` on light surfaces and `#FF9B70` on dark/media surfaces. Global theme colors and Inter typography are unchanged.
- Web restores links after same-value and nested repaint without observer loops, preserves literal underscores in Discover, and shares entity rendering/styles with profile activity. This is a source/artifact change, not an authenticated production-web deployment.

Player, video source, authentication, session, backend and schema behavior are outside this entity change.

## Build and local verification

Both 688 QA APKs passed assembly/full lint and independent source/package/signer/configuration checks. Both updates retained actual `@drcharlestz`/`@utaliiplus` identities. Native, Brand, Auth and APK GitHub checks passed for 688. The actual parser/format/query/route proof contains 91 checks; pure/source checks do not replace live QA.

The LF-sealed web production build, stamping/artifact verification and 26 focused checks passed. Local browser fixtures covered repaint, light/dark colors, exact underscores and entity/format collisions. An initial development-origin attempt served a stale formatting dependency; a fresh local origin fetched exact modules and passed. This is not a production failure or deployment claim. Ordinary Windows `build-app.mjs` also reproduced an existing CRLF-sensitive transform-anchor failure: baseline/current LF inputs passed, while CRLF inputs failed identically. The complete sealed LF workflow was used; unrelated transforms were not changed.

## Actual Samsung chronology

At 0a, Samsung confirmed the gradient Create control and existing composer, orange bio mentions, a loaded SautiLink Corporation target, orange post hashtags, seeded Explore and nested Back to the original observed post. D2QA also confirmed dark Home/bio visuals and a loaded dark-theme mention target; the original light setting was restored. Paired captures sometimes contain an earlier loading PNG and a later settled XML; the ledger excludes those PNGs from settled visual claims.

The 0a test exposed a real canonical terminal-dot profile-card failure. The 0b source correction passed RoomsQA assembly/full lint but was not separately installed. It is included in installed 688. The actual regression retest used the nested entity route: source post → seeded `#motivation` Explore → manually searched canonical profile card → loaded exact `@officialneystersantos.`. Back returned to the original source body and 8/2/4 counters. Root Explore's separate successful card was only a control because it bypasses that nested guard.

The extra expectation that a manually edited Explore query would survive Profile Back was not met; that helper stopped before capture. The existing screen reinitializes its seeded `initialQuery`. No general manually edited query-retention PASS or invented capture is claimed.

On 688, an owned private QA comment displayed orange `@utaliiplus` and `#SautiLink_QA`, alongside existing Love/Dislike/Reply controls. Tapping its hashtag opened exact `#SautiLink_QA` with the underscore/case intact. No matching public posts was truthful for the private fixture. Back returned to the private Room/body with comment count 1. This tested the comment hashtag; it did not independently exercise every comment mention/reply/truncation target.

The private QA comment was then explicitly deleted, followed by its one-member Room. Refreshed Your rooms was empty; exact read-only owned slug/body aggregates confirmed Room 0/post 0/comment 0. There are no retained fixtures from this block. D2QA was left on Home.

## Explicit remaining limits

- Actual Shorts-caption entity tapping remains NOT TESTED: six scanned public captions contained no hashtags/mentions.
- Native raw double-underscore formatting cases are covered by compiled source checks; not every such vector was manually entered on Samsung.
- All navigation stacks, maximal counter/narrow-width cases, new dark action-row layout and an expanded accessibility audit were not all tested live.
- The earlier video HTTP 500/timeouts and broader Final QA remain OPEN. The failed c166 delivery rollout was rolled back to diagnostic Worker `ba09db25-80c4-49f3-8184-e124becc2680`; these UI checks do not establish a video-delivery fix.

No Worker/schema deployment, PR merge or Google Play publication was performed for this UI request. No blanket Final QA or universal stability PASS is asserted.

Task workspace evidence: `outputs/Native-entities-Samsung-20261016.json`, `outputs/Native-actions-Samsung-20261016.json`, `outputs/Native-text-entities-canonical-91-parity-688dffe-20261016.json`, `outputs/Native-actions-688dffe-independent-gate-audit.json`, `outputs/Web-entity-format-browser-QA-0a2910e.json`, `outputs/Web-entities-local-check-20261016.json` and `outputs/Actions-688-private-fixture-cleanup.json`.
