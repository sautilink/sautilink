# Rooms chat presentation

Rooms uses `app/assets/rooms-chat.css` for its directory, conversation, group information, settings, member management, invitations and creation form. The retired `rooms.css` and `rooms-invitations.css` are removed, alongside the previously retired Facebook/mobile/native Room styles. Shared native feed CSS and header decoration explicitly exclude Rooms.

Group info opens from the conversation header. Edit group, Members & requests and Invite members are separate panel views. Existing forms and action nodes are retained so their authorization, validation and event handlers remain authoritative. Photo/video filtering applies to the recent messages already loaded and can be cleared from the conversation toolbar. Message actions remain available from each bubble's menu. Reply permissions are under Message options. Enter sends, Shift+Enter inserts a newline, and IME composition does not send.

The normal site navigation is available through SautiLink menu in the Room directory. The Rooms-specific navigation and styles are removed from view on other routes.

## Verification

Run `npm run check` for both artifact builds and the repository tests.

For browser QA, install `playwright-core` in a separate tooling directory or make it available to Node. After a production build, run `node scripts/verify-rooms-chat-browser.mjs` with these optional environment variables:

- `SAUTILINK_PLAYWRIGHT_MODULE`: importable module name or absolute file URL to Playwright Core.
- `SAUTILINK_CHROME`: browser executable path (defaults to Chrome's usual Windows location).
- `SAUTILINK_QA_OUTPUT`: screenshot directory (defaults to `work/rooms-chat-qa`).

The browser script uses the built production HTML, current source CSS and transformed Room presentation code. It exercises the actual settings, member management and invitation form functions with in-memory API fixtures. Checks cover desktop and mobile, dark/light themes, directory filters, bubble alignment, media-caption visibility, message menus, send controls, reply permissions, settings submission, role changes, request approvals, invitations, media filter reset and navigation. It does not use or change real accounts. Real-account integration is covered separately from this visual fixture test.
