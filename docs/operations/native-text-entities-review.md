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

Implementation and source checks are in progress at this review checkpoint. Android assembly/full lint, installation and Samsung link/Back/gesture checks must be recorded against the final immutable native source before claiming a live PASS. Local web fixture checks do not establish an authenticated production deployment.

The separate video delivery investigation remains OPEN. The failed c166 rollout was rolled back to diagnostic Worker `ba09db25-80c4-49f3-8184-e124becc2680`; this UI change does not establish a fix for the earlier HTTP 500 failures. No production deployment, PR merge or Google Play publication is authorized by this UI request.
