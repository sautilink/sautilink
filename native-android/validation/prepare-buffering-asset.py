"""Reproduce the native-compatible derivative of the user's free dotLottie export.

Only the two exact layer-reference expressions are baked into their source
keyframes. Colors, artboard, timing, layer order and blending remain unchanged.
The original supplied archive is retained next to this script for provenance.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import zipfile

project = Path(__file__).resolve().parent.parent
source = project / 'validation/assets/loading-source.lottie'
target = project / 'app/src/main/res/raw/sauti_buffering.lottie'
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
original = source.read_bytes()
assert hashlib.sha256(original).hexdigest() == 'e22afc139b482c6d7aec6d06cb4f92af88d4444df8d4bb2d4b5bfd9a9d33669b'
with zipfile.ZipFile(io.BytesIO(original)) as archive:
    assert set(archive.namelist()) == {'manifest.json', 'animations/12345.json'}
    manifest = archive.read('manifest.json')
    animation = json.loads(archive.read('animations/12345.json'))
before = copy.deepcopy(animation)
layers = {layer['nm']: layer for layer in animation['layers']}
assert len(layers) == 3 and animation['assets'] == []
for property_name, transform_name in [('p', 'position'), ('s', 'scale')]:
    destination = layers['Shape Layer 3']['ks'][property_name]
    expected_expression = "var $bm_rt;\n$bm_rt = thisComp.layer('Shape Layer 2').transform." + transform_name + ';'
    assert destination['x'] == expected_expression
    layers['Shape Layer 3']['ks'][property_name] = copy.deepcopy(layers['Shape Layer 2']['ks'][property_name])
expected = copy.deepcopy(before)
for property_name in ('p', 's'):
    expected['layers'][2]['ks'][property_name] = copy.deepcopy(before['layers'][0]['ks'][property_name])
assert animation == expected, 'Only the two approved referenced transforms may change'
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, payload in [('manifest.json', manifest), ('animations/12345.json', json.dumps(animation, separators=(',', ':')).encode())]:
        entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(entry, payload, compresslevel=9)
prepared = buffer.getvalue()
if args.check:
    assert target.read_bytes() == prepared, 'Bundled asset differs from reproducible derivative'
else:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        assert target.read_bytes() == prepared, 'Refusing to overwrite a different asset'
    else:
        target.write_bytes(prepared)
print(json.dumps({'result': 'PASS', 'source_bytes': len(original), 'bundled_bytes': len(prepared),
                  'baked_properties': 2, 'sha256': hashlib.sha256(prepared).hexdigest()}))
