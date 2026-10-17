# SautiLink account entry — iOS frontend refresh

## Purpose

Bring Login, Signup and their related account screens into the same visual family as SautiLink’s refreshed public pages. The previous account stylesheet hid useful field labels, forced one appearance regardless of the saved theme, and suppressed real authentication feedback.

The design uses the original SautiLink mark, self-hosted Inter, clear form labels, restrained surfaces and prominent primary actions. Desktop has room for an introduction beside the form. Narrow screens prioritize account access and allow the document to scroll naturally.

## Presentation scope

- Login and Signup share an account header, help access, appearance control and legal links.
- Signup groups personal details and password fields without splitting or replacing the existing form.
- Email verification, email-code login, phone verification, password recovery, new-password entry and conditional profile setup share the same form treatment.
- Supporting copy describes the existing flow. Profile setup remains conditional; the presentation must not create an additional required step.
- Decorative artwork is inline SVG styled by the external auth stylesheet. It does not require a downloaded image, a new library or a network request.

## Integration details to preserve

The account UI is part of `app/index.html`, not separate Login and Signup HTML files. `src/asset-router.js` serves the appropriate panel before JavaScript runs. Its current substitutions depend on specific opening tags, tab attributes and intro copy. The actual-page tests in `tests/auth-route-server-shell.test.mjs` protect those substitutions against markup changes.

The account stylesheet is linked in the initial document head. Its source version must match the presentation module’s version; the production build replaces both with the stylesheet’s content hash.

Date-of-birth controls are inserted by the existing installer before the email label. Do not pre-create its fieldset ID: that would skip its setup and validation. Login retains the `email` field name because the username-login bridge depends on it. Submit buttons retain the label structure used by the existing loading-state handler.

Authentication contracts remain in their existing modules: Google, Facebook and Microsoft OAuth; username/email login; an eight-digit email code; the current phone-code rules; password validation; explicit terms acceptance; recovery links; and session handling. The refresh changes account presentation, not these contracts or the database.

## Verification

Release verification includes the actual Login and Signup HTML on canonical and `www` routes, frontend behavior checks, a comparison of form attributes against the prior release, the repository’s existing build and test gates, and production route/asset checks after publication.

The local `npm run check` gate passed: app and preview builds, staging artifact verification, isolated production build, production artifact verification and all 181 test files. Direct execution also confirmed seven presentation behavior cases and the five server-shell cases, including eight actual route variants. The form comparison preserved all ten forms and 44 field/control contracts; the core authentication and backend files remain unchanged.

The guest profile and public-post gates retain their independent body-level roots, surface styles and underlying-app lock. Their regression test now checks that isolation directly instead of requiring the previous broad `main` selector.

Browser rendering is not available in this environment. Source, behavior, build and HTTP checks should not be described as a visual Safari or iPhone test.

## Design references

The form and control treatment draws on Apple’s guidance for [text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields) and [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons): persistent labels, orderly spacing, logical keyboard movement, clear action names, sufficiently large targets and visible interaction states. SautiLink keeps its own brand assets and product language.
