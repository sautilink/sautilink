# SautiLink Huge animated icons

The selected icon geometry and shared animation runtime are vendored from
[`@animateicons/vanilla@0.1.0`](https://www.npmjs.com/package/@animateicons/vanilla/v/0.1.0),
published by the [AnimateIcons project](https://github.com/Avijit07x/animateicons).
This is its framework-free package; SautiLink does not require React to use it.

The npm archive was fetched from:

`https://registry.npmjs.org/@animateicons/vanilla/-/vanilla-0.1.0.tgz`

Archive SHA-256:
`199935569f41a9e5609dfb9b6b077121fdebf90a44fac3c1e28325bb7743d07b`

Its SHA-512 matches the npm registry integrity value recorded in `manifest.json`.
The manifest records each selected data module's exact upstream path and SHA-256.
The selected Huge and Lucide `vendor/animateicons/data/*.js` files and
`vendor/animateicons/upstream/runtime.js` are byte-for-byte copies of the
published package. The shared runtime already includes Motion; no dependency
installation or CDN connection is needed in the browser or during this build.

`LICENSE` contains AnimateIcons' MIT license. `THIRD_PARTY_NOTICES.md` contains the
upstream icon notices, including Hugeicons' MIT and Lucide's ISC/MIT licenses. The bundled Motion code
is MIT licensed; its notice is retained in `LICENSE-MOTION.md` (copied from the
official `motion@14.3.0` package, the minimum version specified by this AnimateIcons
release). The AnimateIcons archive does not identify the exact resolved Motion
patch used by its publisher.

## SautiLink adapter and build

`vendor/animateicons/source/member-icons.mjs` provides the small application adapter. It uses the
original resting geometry and animation player. Its renderer applies the
upstream resting styles with `CSSStyleDeclaration.setProperty()` instead of
`setAttribute('style', ...)`, so it works with SautiLink's Content Security Policy.
No upstream animation definitions or geometry have been altered. Huge is the
primary family (67 selected definitions). Five narrow functional exceptions use
the exact `cloud`, `router`, `hash`, `pin` and `picture-in-picture` icons from the
same AnimateIcons release's Lucide collection, because its 501-icon Huge
collection does not provide these symbols. Their application keys are prefixed
`lucide:` and their source library is recorded in the manifest. They use the
same shared runtime, with no second engine or additional dependency.

`sautilink:justice-scale` preserves SautiLink's original appeals scales SVG from
`app/index.html`. It adds a small balance-beam animation through the same player
and retains the existing symbol's meaning. It is application-owned geometry,
rather than an upstream AnimateIcons icon; its provenance is explicit in the
manifest.

`vendor/animateicons/source/catalog.mjs` and `app/assets/huge-icons/runtime.js` are generated. Rebuild them offline with:

```
node scripts/build-member-icons.mjs
```

The script first verifies the recorded hashes of the original vendored files,
then bundles only the selected member icons and the shared player with the
repository's existing esbuild. It also builds the member adapter from
`src/member-animated-icons.js` when that source is present. It does not modify
package manifests, lockfiles, authentication, API calls, or backend code.

The runtime exports `SautiHugeIcons.renderIcon(name, size, document)` and
`SautiHugeIcons.play(svg, name, options)` for the member interface's existing SVG
nodes. `createIcon()` and `mountIcon()` are also available. All icon names are the
exact upstream Huge names or the explicit exception keys listed in `manifest.json`; `names` and `catalog` expose
the selected set. The application owns visibility, reduced-motion preferences,
interaction triggers and cleanup.
