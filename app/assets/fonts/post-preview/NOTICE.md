# SautiLink Post Preview font

`SautiLinkPostPreview-Regular.woff2` is a renamed, static, monochrome font for
the horizontal text share-card renderer. It combines the existing self-hosted
Inter face (weight 400, optical size 14) with Google's Noto Emoji face (weight
400). No remote font dependency is needed at render time.

The derivative retains Inter's Latin, extended Latin, punctuation and common
Swahili coverage, and Noto Emoji's monochrome emoji outlines and sequence
substitutions. This is a regular face; it is not a color emoji font or a new
application-wide font. Both upstream fonts use 2048 units per em. FontTools
merges their outlines, cmap and OpenType layout tables. Noto's optional vertical
metrics and raster gasp tables are omitted for this horizontal-only use.

Both components and this derivative are licensed under the SIL Open Font License
1.1. The complete original notices and license texts are preserved in
`OFL-Inter.txt` and `OFL-NotoEmoji.txt`. The derivative uses a separate family
name. `provenance.json` records source and output hashes.

Sources:

- Inter Project Authors: <https://github.com/rsms/inter>; the exact input is the
  repository's existing `assets/fonts/inter/InterVariable.woff2`, with its
  accompanying original license.
- Google Fonts Noto Emoji, pinned to commit
  `47d54ca1ebb14fd864695f1d39dc734f39017c33`:
  <https://github.com/google/fonts/tree/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/notoemoji>.

Rebuild using Python with `fonttools[woff]==4.67.0` and `brotli==1.2.0`:

```sh
python scripts/build-post-preview-font.py --source-cache /absolute/path/to/font-source-cache
```

The script verifies the pinned source hashes, instantiates and merges the fonts,
renames the derivative, checks Latin/Swahili and U+1F525/U+1F680/U+1F440 cmap
coverage, verifies nonempty emoji outlines and checks the output is under 2 MB.
Original source font downloads and intermediate static TTFs remain in the
specified build cache and are not deployed.
