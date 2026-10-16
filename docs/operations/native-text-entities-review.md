# Native text entities and Create button

Owner requested clickable orange hashtags and mentions in bios, posts and other displayed text, web bug fixes using the existing implementation, and the circular Create background in the logo's orange/pink.

## Scope

- Shared native formatted-post text adds links only to the entity spans. Literal bios and comments retain their text and use the same internal links. Composer previews remain noninteractive.
- Mentions open the existing member-profile destination. Hashtags seed the existing Explore search, preserving case and underscores. Back retains the source post/profile context.
- The Create button retains its size, plus artwork, accessibility label and action; only its background uses logo colors `#FE682C` to `#FD3B45`.
- Orange entity text uses `#B84216` on light surfaces and `#FF9B70` on dark/media surfaces. Global theme colors and Inter typography remain unchanged.
- Web restores links after same-value bio repaint, preserves literal underscores in search, and uses the shared renderer/styles for profile activity. Email/URL fragments and overlong identifiers must not become partial internal links.

## Existing behavior protected

The player, video sources, authentication, sessions, backend and schema are outside this change. Existing post formats remain supported; entity/format collisions require a narrow safeguard because removing `__` from a valid handle could navigate to another account. Raw identifiers must keep their intended targets.

## Verification status

At source `0a2910e`, both QA assembly/full lint passed (15m06s and 15m02s; zero errors, 102/103 existing warnings and two hints). RoomsQA was updated with the same signer and retained the actual Dr. Charles session. Samsung observed the gradient Create button and working composer, orange public bio mentions and correct SautiLink Corporation target, orange post hashtags, exact seeded hashtag search, nested post Back and return to the original post with unchanged counters. The nested live example selected the same post; different post-ID restoration was covered by compiled actual route closures.

Samsung then reproduced a canonical profile-card failure for an existing registered handle ending in a dot. The card target was incorrectly validated using prose punctuation rules. The follow-up validates the canonical target with the existing username shape; prose punctuation and backend lookup rules are unchanged. The actual parser/format/query/route checks now pass 91 cases. Its new APK build/full lint and terminal-dot Samsung retest remain pending at this source checkpoint.

Exact-source local LF web production build/stamp/artifact verification and 26 focused checks passed. Browser fixture checks cover repaint, light/dark colors, exact underscores and entity/format collisions; they do not establish an authenticated production deployment. Evidence is recorded under `outputs/Native-text-entities-check-20261016.json`, `outputs/Native-entities-0a2910e.json`, and `outputs/Entities-web-0a2910e-lf-build.json` in the task workspace.

The separate video delivery investigation remains OPEN. The failed c166 rollout was rolled back to diagnostic Worker `ba09db25-80c4-49f3-8184-e124becc2680`; this UI change does not establish a fix for the earlier HTTP 500 failures. No production deployment, PR merge or Google Play publication is authorized by this UI request.
