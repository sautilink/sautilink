# SautiLink Native Design System · v0.1

## Identity

- Brand typography: **Inter** only (downloadable font in prototype; for production bundle via supported font dependency or vetted assets if licensing allows).
- Appearance: SautiLink-original shapes and colors with iOS-inspired rounded surfaces, breathable layout and subtle depth.
- Android-native interaction model (Back gestures, edge insets, keyboards, TalkBack).

## Color tokens

| Token | Light | Dark |
|---|---|---|
| Primary action | #0866FF | #3188FF |
| Brand red accent | #ED344B | #ED344B |
| Brand yellow accent | #FFC83D | #FFC83D |
| App background | #FFFFFF | #0E141E |
| Elevated card | #F3F6FB | #1E2735 |
| Primary text | #141D2E | #F1F5FC |

## Shape tokens

- Standard card radius: 24dp.
- Button radius: 22dp.
- Bottom sheet top corner radius: 32dp.
- Incoming bubble: 22dp on most corners, 7dp on lower-left.
- Outgoing bubble: 22dp on most corners, 7dp on lower-right.
- Floating navigation: pill shape.

## Screen 1: Home Feed

1. SautiLink wordmark, top actions and feed selectors.
2. Story rings in a horizontal, accessible scroll row.
3. Composer entry point; first real implementation should open the post composer.
4. Feed card with name, verification, timestamp, caption above media, and reactions.
5. For You, Following and Short Videos selectors currently demonstrate UI state only.
6. Initial feed media is a local Compose illustration (zero third-party image dependencies).

## Screen 2: Chat

1. Contact header, online state, call actions (not wired).
2. Messages bubble shapes with timestamp and optional read check.
3. Chat background remains calm in both themes with 12dp vertical rhythm.
4. Composer supports writing and visually appending mock messages only.
5. Native keyboard insets, scroll and Back behavior must be tested on devices before production.

## Performance and accessibility targets

- Aiming for smooth 60 FPS on reference hardware; measure frame timing rather than promise a multiplier over web.
- Minimum 48dp touch hit areas for actions wherever practicable; avoid reliance on color alone.
- Verify dynamic font scaling, TalkBack, dark-mode contrasts and RTL mirroring where relevant.
- No unnecessary heavy blur, no gradients over critical interactive labels, no dead-end loading states.

## Extension policy

Components are shared; future Profile, Settings, Rooms, Media viewer, Notifications and Short Videos must use the same tokens. Backend integration should consume existing SautiLink API contracts and authorization flows rather than replicate or replace production infrastructure.
