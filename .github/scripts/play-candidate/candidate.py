"""One approved CI run. Fixed public outputs; credentials stay in env/temp inputs."""
from pathlib import Path
import base64, hashlib, json, os, re, shutil, subprocess, sys, urllib.request, zipfile
import xml.etree.ElementTree as ET

SOURCE = '688dffe0b8da459a54a072522c833df1ff270009'
SOURCE_TREE = 'f7de64a83b140ffec5010a8b94e8974efb56d095'
CERT = '31c773a7229a563d92f7047a56735ad7b02027d27a6e020d8923dd5418f4b50f'
FIREBASE_SHA = 'be30a77f6be106c97b59ecdc6e7cc61100e0d9fd354ac883357e253fb69e6cae'
BUNDLETOOL_SHA = 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'
ANDROID = '{http://schemas.android.com/apk/res/android}'
ROOT = Path(os.environ.get('GITHUB_WORKSPACE', '.')).resolve()
TEMP = Path(os.environ.get('RUNNER_TEMP', '.')).resolve()
APP = ROOT / 'candidate/native-android/app'
OUT = TEMP / 'sautilink-play-candidate-public'
KEYSTORE = TEMP / 'sautilink-play-candidate-upload.jks'
TOOL = TEMP / 'sautilink-bundletool-1.18.3.jar'
ASSET = APP / 'src/main/assets/adi-registration.properties'
AAB = APP / 'build/outputs/bundle/productionRelease/app-production-release.aab'
PROOF = APP / 'build/outputs/apk/production/release/app-production-release.apk'
HERE = Path(__file__).resolve().parent


def sha(data): return hashlib.sha256(data).hexdigest()


def command(args, timeout=90):
    process = subprocess.run(list(map(str, args)), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             timeout=timeout, check=False)
    if process.returncode != 0: raise RuntimeError('COMMAND_FAILED')
    return process.stdout.decode('utf-8', errors='strict')


def write_json(name, value):
    with (OUT/name).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2); stream.write('\n')


def secret(name):
    value = os.environ.get(name, '')
    if not value: raise ValueError('REQUIRED_SECRET_MISSING')
    return value


def registration_bytes():
    value = secret('REGISTRATION_ID').strip()
    if not re.fullmatch(r'[A-Z2-7]{16,128}', value): raise ValueError('REGISTRATION_ID_INVALID')
    return (value+'\n').encode('ascii')


def safe_zip(path):
    archive = zipfile.ZipFile(path)
    names = archive.namelist()
    assert len(names) == len(set(names))
    assert all(not n.startswith('/') and '\\' not in n and '..' not in n.split('/') for n in names)
    assert archive.testzip() is None
    return archive


def verify_manifest(xml):
    root = ET.fromstring(xml)
    assert root.tag == 'manifest' and root.get('package') == 'com.sautilink.app'
    assert root.get(ANDROID+'versionCode') == '41'
    assert root.get(ANDROID+'versionName') == '0.9.0-native-performance'
    sdk, app = root.find('uses-sdk'), root.find('application')
    assert sdk is not None and app is not None
    assert sdk.get(ANDROID+'minSdkVersion') == '26' and sdk.get(ANDROID+'targetSdkVersion') == '36'
    assert app.get(ANDROID+'debuggable', 'false') == 'false'


def tools():
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
    selected = sdk/'build-tools/36.0.0'
    assert selected.is_dir(), 'ANDROID_36_BUILD_TOOLS_REQUIRED'
    return selected


def prepare():
    assert command(['git', '-C', APP.parent.parent, 'rev-parse', 'HEAD']).strip() == SOURCE
    assert command(['git', '-C', APP.parent.parent, 'rev-parse', 'HEAD:native-android/app/src']).strip() == SOURCE_TREE
    assert not (APP.parent/'local.properties').exists() and not ASSET.exists()
    assert not KEYSTORE.exists() and not OUT.exists() and not TOOL.exists()
    OUT.mkdir(mode=0o700)
    firebase = base64.b64decode(''.join(secret('FIREBASE_CONFIG').split()), validate=True)
    assert sha(firebase) == FIREBASE_SHA
    config = json.loads(firebase)
    clients = [c for c in config.get('client', []) if c.get('client_info', {}).get('android_client_info', {}).get('package_name') == 'com.sautilink.app']
    assert config.get('project_info', {}).get('project_id') == 'sautilink' and len(clients) == 1
    for name in ('STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD'): secret(name)
    keybytes = base64.b64decode(''.join(secret('KEYSTORE_BASE64').split()), validate=True)
    assert 0 < len(keybytes) <= 1048576
    with KEYSTORE.open('xb') as stream: stream.write(keybytes)
    KEYSTORE.chmod(0o600)
    certificate = command(['keytool', '-exportcert', '-rfc', '-keystore', KEYSTORE,
                           '-alias', secret('KEY_ALIAS'), '-storepass:env', 'STORE_PASSWORD'])
    match = re.fullmatch(r'\s*-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----\s*', certificate)
    assert match and sha(base64.b64decode(''.join(match[1].split()), validate=True)) == CERT
    (OUT/'existing-upload-certificate.pem').write_text(certificate, encoding='ascii')
    (APP/'google-services.json').write_bytes(firebase)
    (APP/'google-services.json').chmod(0o600)
    url = 'https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar'
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(32520402)
    assert len(data) == 32520401 and sha(data) == BUNDLETOOL_SHA
    with TOOL.open('xb') as stream: stream.write(data)
    write_json('source-and-signer.json', {'sourceSha': SOURCE, 'appSourceTree': SOURCE_TREE,
               'uploadCertificateSha256': CERT, 'firebaseConfigSha256': FIREBASE_SHA,
               'productionFirebaseClientExactlyOne': True, 'bundletoolVersion': '1.18.3',
               'bundletoolSha256': BUNDLETOOL_SHA, 'registrationAssetAbsentBeforeAab': True})


def seal_aab():
    assert not ASSET.exists()
    with safe_zip(AAB) as archive:
        assert not any(n.endswith('/adi-registration.properties') for n in archive.namelist())
    signature = json.loads(command(['java', HERE/'VerifyPlayBundle.java', AAB], timeout=180))
    assert signature['allPayloadEntriesSignedByExpectedCertificate'] is True
    jarsigner = command(['jarsigner', '-verify', AAB], timeout=180)
    assert 'jar verified' in jarsigner.lower()
    command(['java', '-jar', TOOL, 'validate', '--bundle='+str(AAB)], timeout=180)
    manifest = command(['java', '-jar', TOOL, 'dump', 'manifest', '--bundle='+str(AAB), '--module=base'])
    verify_manifest(manifest)
    lint = APP/'build/reports/lint-results-productionRelease.xml'
    issues = ET.parse(lint).getroot().findall('issue')
    assert not any(i.get('severity') in ('Error', 'Fatal') for i in issues)
    shutil.copyfile(AAB, OUT/'sautilink-production-clean.aab')
    shutil.copyfile(lint, OUT/'lint-results-productionRelease.xml')
    write_json('clean-aab.json', {'status': 'PASS_SIGNED_CLEAN_ARTIFACT', 'sourceSha': SOURCE,
               'package': 'com.sautilink.app', 'versionCode': 41, 'versionName': '0.9.0-native-performance',
               'minSdk': 26, 'targetSdk': 36, 'debuggable': False,
               'sha256': sha(AAB.read_bytes()), 'uploadCertificateSha256': CERT,
               'bundletoolValidate': True, 'registrationAssetPresent': False,
               'lintFatalOrErrors': 0, 'lintWarnings': sum(i.get('severity') == 'Warning' for i in issues),
               'lintInformational': sum(i.get('severity') not in ('Error','Fatal','Warning') for i in issues),
               **signature, 'playConsoleValidationPerformed': False, 'device16KbValidationPerformed': False})


def prepare_proof():
    report = json.loads((OUT/'clean-aab.json').read_text())
    assert sha((OUT/'sautilink-production-clean.aab').read_bytes()) == report['sha256']
    assert not ASSET.exists()
    ASSET.parent.mkdir(parents=True, exist_ok=True)
    with ASSET.open('xb') as stream: stream.write(registration_bytes())
    ASSET.chmod(0o600)


def seal_proof():
    with safe_zip(PROOF) as archive:
        assert archive.read('assets/adi-registration.properties') == registration_bytes()
    output = command([tools()/'apksigner', 'verify', '--verbose', '--print-certs', PROOF])
    fingerprints = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)$', output, re.M)
    assert [f.lower() for f in fingerprints] == [CERT]
    badging = command([tools()/'aapt2', 'dump', 'badging', PROOF])
    assert re.search(r"^package: name='com\.sautilink\.app' versionCode='41' versionName='0\.9\.0-native-performance'", badging, re.M)
    assert "sdkVersion:'26'" in badging and "targetSdkVersion:'36'" in badging
    assert "application-label:'SautiLink'" in badging and 'application-debuggable' not in badging
    clean = json.loads((OUT/'clean-aab.json').read_text())
    assert sha((OUT/'sautilink-production-clean.aab').read_bytes()) == clean['sha256']
    assert sha(AAB.read_bytes()) == clean['sha256']
    with safe_zip(OUT/'sautilink-production-clean.aab') as archive:
        assert not any(n.endswith('/adi-registration.properties') for n in archive.namelist())
    shutil.copyfile(PROOF, OUT/'sautilink-registration-proof-only.apk')
    write_json('registration-proof.json', {'status': 'PASS_PROOF_ONLY_NOT_FOR_DISTRIBUTION',
               'sourceSha': SOURCE, 'package': 'com.sautilink.app', 'versionCode': 41,
               'sha256': sha(PROOF.read_bytes()), 'uploadCertificateSha256': CERT,
               'exactAccountAssetVerified': True, 'cleanAabSha256Unchanged': True,
               'identifierValueOrHashEmitted': False, 'installedOrDistributed': False})
    names = sorted(p.name for p in OUT.iterdir())
    assert set(names) == {'existing-upload-certificate.pem','source-and-signer.json','clean-aab.json',
                         'sautilink-production-clean.aab','lint-results-productionRelease.xml',
                         'sautilink-registration-proof-only.apk','registration-proof.json'}
    with (OUT/'SHA256SUMS').open('x', encoding='ascii') as stream:
        for name in names: stream.write(sha((OUT/name).read_bytes())+'  '+name+'\n')


def cleanup():
    for path in (KEYSTORE, TOOL, APP/'google-services.json', ASSET):
        if path.is_file(): path.unlink()


if __name__ == '__main__':
    try:
        actions = {'prepare': prepare, 'seal-aab': seal_aab, 'prepare-proof': prepare_proof,
                   'seal-proof': seal_proof, 'cleanup': cleanup}
        assert len(sys.argv) == 2 and sys.argv[1] in actions
        actions[sys.argv[1]]()
        print('PLAY_CANDIDATE_'+sys.argv[1].upper().replace('-', '_')+'_PASS')
    except Exception:
        # Command output/errors may contain provider/config/keystore material; never echo them.
        print('::error::PLAY_CANDIDATE_CHECK_FAILED', file=sys.stderr)
        sys.exit(1)
