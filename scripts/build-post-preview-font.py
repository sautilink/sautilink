"""Build the self-hosted static Latin + monochrome emoji share-card font.

Build dependencies: fonttools[woff]==4.67.0 (with brotli==1.2.0).
Run from any directory with Python 3.12; sources are SHA-256 checked.
"""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

from fontTools import __version__ as fonttools_version
from fontTools.merge import Merger
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "app/assets/fonts/post-preview"
GOOGLE_FONTS_COMMIT = "47d54ca1ebb14fd864695f1d39dc734f39017c33"
SOURCE_BASE = f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_FONTS_COMMIT}/ofl/notoemoji"
INTER_SHA = "693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3"
NOTO_SHA = "de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551"
NOTO_OFL_SHA = "500bb1ccf43df7bbb522112f9133a52b16e1c35e809632f5d8609b179152de5b"
FIXED_TIMESTAMP = int(datetime(2026, 10, 19, tzinfo=timezone.utc).timestamp()) + 2082844800


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked_file(path, expected, url=None):
    if not path.exists() and url:
        with urlopen(url, timeout=60) as response:
            path.write_bytes(response.read())
    if sha256(path) != expected:
        raise ValueError(f"Unexpected source SHA-256: {path}")
    return path


def rename(font):
    # Derivative names intentionally do not use either upstream family name.
    names = {
        0: "Copyright 2016 The Inter Project Authors; Copyright 2013 Google LLC",
        1: "SautiLink Post Preview",
        2: "Regular",
        3: "SautiLinkPostPreview-Regular-1.000",
        4: "SautiLink Post Preview Regular",
        5: "Version 1.000",
        6: "SautiLinkPostPreview-Regular",
        8: "SautiLink",
        9: "The Inter Project Authors; Google",
        13: "Licensed under the SIL Open Font License, Version 1.1. See accompanying OFL-Inter.txt and OFL-NotoEmoji.txt.",
        14: "https://openfontlicense.org/",
        16: "SautiLink Post Preview",
        17: "Regular",
    }
    for name_id, text in names.items():
        font["name"].removeNames(nameID=name_id)
        font["name"].setName(text, name_id, 3, 1, 0x409)
        font["name"].setName(text, name_id, 1, 0, 0)
    font["head"].created = FIXED_TIMESTAMP
    font["head"].modified = FIXED_TIMESTAMP
    font.recalcTimestamp = False


def build(cache):
    cache.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    inter_path = checked_file(ROOT / "assets/fonts/inter/InterVariable.woff2", INTER_SHA)
    noto_path = checked_file(cache / "NotoEmoji-wght.ttf", NOTO_SHA, f"{SOURCE_BASE}/NotoEmoji%5Bwght%5D.ttf")
    noto_ofl = checked_file(cache / "OFL-NotoEmoji.txt", NOTO_OFL_SHA, f"{SOURCE_BASE}/OFL.txt")

    inter = instantiateVariableFont(TTFont(inter_path), {"opsz": 14, "wght": 400}, inplace=True)
    inter.flavor = None
    inter.save(cache / "Inter-static.ttf")
    noto = instantiateVariableFont(TTFont(noto_path), {"wght": 400}, inplace=True)
    # Horizontal-only share cards need no vertical metrics or raster gasp table.
    # Removing these optional Noto-only tables also avoids incompatible merge maps.
    for tag in ("vhea", "vmtx", "gasp"):
        if tag in noto:
            del noto[tag]
    noto.save(cache / "NotoEmoji-horizontal.ttf")
    assert inter["head"].unitsPerEm == noto["head"].unitsPerEm == 2048

    # FontTools merges cmap/layout/metrics and retains emoji sequence GSUB rules.
    # Inter comes first so ordinary Latin, spaces and numbers remain Inter.
    merged = Merger().merge([str(cache / "Inter-static.ttf"), str(cache / "NotoEmoji-horizontal.ttf")])
    rename(merged)
    merged.flavor = "woff2"
    target = OUTPUT / "SautiLinkPostPreview-Regular.woff2"
    merged.save(target)
    (OUTPUT / "OFL-Inter.txt").write_bytes((ROOT / "assets/fonts/inter/OFL.txt").read_bytes())
    (OUTPUT / "OFL-NotoEmoji.txt").write_bytes(noto_ofl.read_bytes())

    verified = TTFont(target)
    cmap = verified.getBestCmap()
    required = set(map(ord, "SautiLink Karibu Tanzania Kiswahili 0123456789 ’ é ê ñ ü 🔥🚀👀"))
    assert required <= cmap.keys(), f"Missing cmap entries: {required - cmap.keys()}"
    assert "fvar" not in verified and "gvar" not in verified
    assert "GSUB" in verified and "GPOS" in verified
    glyphs = verified.getGlyphSet()
    for codepoint in (0x1F525, 0x1F680, 0x1F440):
        pen = BoundsPen(glyphs)
        glyphs[cmap[codepoint]].draw(pen)
        assert pen.bounds and pen.bounds[2] > pen.bounds[0], f"Empty emoji U+{codepoint:X}"
    assert target.stat().st_size < 2_000_000

    report = {
        "file": target.name,
        "sha256": sha256(target),
        "bytes": target.stat().st_size,
        "fontToolsVersion": fonttools_version,
        "family": "SautiLink Post Preview",
        "weight": 400,
        "unitsPerEm": verified["head"].unitsPerEm,
        "mappedCodepoints": len(cmap),
        "glyphs": len(verified.getGlyphOrder()),
        "verifiedEmoji": ["U+1F525", "U+1F680", "U+1F440"],
        "sources": {
            "inter": {"file": "assets/fonts/inter/InterVariable.woff2", "sha256": INTER_SHA},
            "notoEmoji": {"url": f"{SOURCE_BASE}/NotoEmoji%5Bwght%5D.ttf", "sha256": NOTO_SHA},
            "notoLicense": {"url": f"{SOURCE_BASE}/OFL.txt", "sha256": NOTO_OFL_SHA},
        },
    }
    (OUTPUT / "provenance.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=Path, required=True)
    build(parser.parse_args().source_cache.resolve())
