# Native icon artwork

Run `node native-android/icons/generate.mjs` from the repository root after updating `source.json`. The generated Compose vectors are cached locally and require no icon network requests.

- Heart, paper-plane-tilt, chat-circle, bell and user use the official Phosphor **Light** geometry, with a small 2.6-unit contour expansion on the 256-unit grid for clearer navigation and reactions.
- Repost uses Pulso **Repeat2**, with a 1.6 stroke on its 24-unit grid.
- Bookmark keeps its existing Hugeicons shape, with a 1.6 stroke and an internal filled variant.
- Rooms deliberately keeps the original Hugeicons user-group, as requested after the Phosphor version was reviewed.
- Navigation keeps the existing Home, Search, Messages and Shorts shapes, with 1.6-unit outlines. Profile navigation restores the original Hugeicons separate head and shoulder arch. Its 26dp artwork slots match the 26dp post reaction slots; touch targets remain at least 48dp.
- The Home Rooms and Stories shortcuts share 25dp slots. Their different silhouettes are checked by painted footprint, rather than forcing a wide group into a circular shape.
- `opticalScale` centers selected artwork inside its viewport. Its nominal dominant extent is 20.5 units on a 24dp grid. The filled heart uses the outline's outer contour and identical transform, so selection does not change its resting size.
- Artwork is still when it enters the feed. Finite press and selection motion respects the system animation clock.

Other native controls retain the pinned `@animateicons/vanilla@0.1.0` Hugeicons definitions in `source.json`. Brand/verification artwork keeps its original geometry. The adapter observes touches without consuming parent input, and preserves callbacks, TalkBack labels and touch targets. No browser engine or runtime icon dependency is required.

Original SVGs, Repeat2 sources and licenses are retained under `upstream/`. Release notices are also included under `app/src/main/assets/licenses/`.
