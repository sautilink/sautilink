# Native animated icons

The production native client shares the Web Huge icon family from
`@animateicons/vanilla@0.1.0` (AnimateIcons). `source.json` preserves the local
definitions, original package provenance and upstream notices. Native-only
controls also use selected definitions from the same pinned package.

Run `node native-android/icons/generate.mjs` to translate resting SVG shapes to
locally cached Compose ImageVectors. No WebView, JavaScript engine, CDN, network
lookup or new runtime dependency is used. Unsupported precise native symbols
retain their artwork through the same adapter; original verification/brand
artwork is preserved.

`SautiIcon` and `SautiGlyph` supply finite native motion on entry, selection and
touch. This is a Compose adaptation of the Web motion language; the native app
does not execute the browser Motion engine. System animation duration controls
apply. Parent touch events are observed without being consumed, and original
button callbacks, TalkBack descriptions and touch targets remain in place.

MIT/ISC attribution is retained in LICENSE and THIRD_PARTY_NOTICES.md.
