"""Owner-requested release 43 AAB. No registration proof or publishing actions."""
from pathlib import Path
import base64, hashlib, json, os, re, shutil, subprocess, sys, urllib.request, zipfile
import xml.etree.ElementTree as ET

# Immutable source pins for the reviewed 1.0.1 (43) caption-link fix.
# Keep SOURCE identical to the candidate checkout ref in native-play-release43.yml.
SOURCE = '8694ac4bc9f3d148b22eef0ba1b0c9a7e9c80cb4'
SOURCE_TREE = '3d34ac1839f7402595bf7a2dc12f3288116ac78c'
CERT = '31c773a7229a563d92f7047a56735ad7b02027d27a6e020d8923dd5418f4b50f'
FIREBASE_SHA = 'be30a77f6be106c97b59ecdc6e7cc61100e0d9fd354ac883357e253fb69e6cae'
BUNDLETOOL_SHA = 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'
ANDROID = '{http://schemas.android.com/apk/res/android}'
ROOT = Path(os.environ.get('GITHUB_WORKSPACE', '.')).resolve()
TEMP = Path(os.environ.get('RUNNER_TEMP', '.')).resolve()
APP = ROOT / 'candidate/native-android/app'
OUT = TEMP / 'sautilink-release43-public'
KEYSTORE = TEMP / 'sautilink-play-release43-upload.jks'
TOOL = TEMP / 'sautilink-bundletool-1.18.3.jar'
TEXT_CHECK = TEMP / 'sautilink-release43-text-check'
TEXT_RECEIPT = TEXT_CHECK / 'checks.json'
ASSET = APP / 'src/main/assets/adi-registration.properties'
AAB = APP / 'build/outputs/bundle/productionRelease/app-production-release.aab'
HERE = Path(__file__).resolve().parent
CHECK_GATE = 'ACTION_DISPATCH'
MIN_TEXT_ENTITY_CHECKS = 191

# Match the portable runner's exact coordinates. This temporary, nontransitive
# configuration uses the project's existing repositories, never project edits.
TEXT_COMPILER_COORDINATES = (
    'org.jetbrains.kotlin:kotlin-compiler-embeddable:2.2.20',
    'org.jetbrains.kotlin:kotlin-stdlib:2.2.20',
    'org.jetbrains.kotlin:kotlin-script-runtime:2.2.20',
    'org.jetbrains.kotlin:kotlin-reflect:1.6.10',
    'org.jetbrains.kotlin:kotlin-daemon-embeddable:2.2.20',
    'org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.8.0',
    'org.jetbrains:annotations:23.0.0',
)


def gate(name):
    global CHECK_GATE
    CHECK_GATE = name


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


def safe_zip(path):
    archive = zipfile.ZipFile(path)
    names = archive.namelist()
    assert len(names) == len(set(names))
    assert all(not n.startswith('/') and '\\' not in n and '..' not in n.split('/') for n in names)
    assert archive.testzip() is None
    return archive


def verify_source():
    gate('PINNED_SOURCE_AND_CLEAN_TRACKED_FILES')
    assert re.fullmatch(r'[a-f0-9]{40}', SOURCE) and re.fullmatch(r'[a-f0-9]{40}', SOURCE_TREE)
    assert command(['git', '-C', APP.parent.parent, 'rev-parse', 'HEAD']).strip() == SOURCE
    assert command(['git', '-C', APP.parent.parent, 'rev-parse', 'HEAD:native-android/app/src']).strip() == SOURCE_TREE
    assert not command(['git', '-C', APP.parent.parent, 'status', '--porcelain', '--untracked-files=no']).strip()


def verify_manifest(xml):
    root = ET.fromstring(xml)
    assert root.tag == 'manifest' and root.get('package') == 'com.sautilink.app'
    assert root.get(ANDROID+'versionCode') == '43'
    assert root.get(ANDROID+'versionName') == '1.0.1'
    sdk, app = root.find('uses-sdk'), root.find('application')
    assert sdk is not None and app is not None
    assert sdk.get(ANDROID+'minSdkVersion') == '26' and sdk.get(ANDROID+'targetSdkVersion') == '36'
    assert app.get(ANDROID+'debuggable', 'false') == 'false'


def tools():
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
    selected = sdk/'build-tools/36.0.0'
    gate('SDK_BUILD_TOOLS_36_PRESENT')
    assert selected.is_dir(), 'ANDROID_36_BUILD_TOOLS_REQUIRED'
    return selected


def prepare():
    verify_source()
    assert not command(['git', '-C', APP.parent.parent, 'status', '--porcelain', '--untracked-files=all']).strip()
    assert not (APP.parent/'local.properties').exists() and not ASSET.exists()
    assert not KEYSTORE.exists() and not OUT.exists() and not TOOL.exists()
    assert not TEXT_CHECK.exists() and not TEXT_RECEIPT.exists()
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
               'bundletoolSha256': BUNDLETOOL_SHA, 'registrationAssetAbsentBeforeAab': True,
               'sourceCleanBeforeBuild': True})


def check_caption():
    verify_source()
    gate('CAPTION_COMPILER_CACHE')
    assert not TEXT_CHECK.exists()
    TEXT_CHECK.mkdir(mode=0o700)
    init = TEXT_CHECK/'resolve-compiler.gradle'
    coordinates = ',\n                '.join(json.dumps(c) for c in TEXT_COMPILER_COORDINATES)
    init.write_text('''gradle.projectsEvaluated {
    rootProject.tasks.register("resolveRelease43TextCompiler") {
        doLast {
            def requested = [
                ''' + coordinates + '''
            ].collect { rootProject.dependencies.create(it) }
            def pinned = rootProject.configurations.detachedConfiguration(*requested)
            pinned.transitive = false
            if (pinned.resolve().size() != 7) {
                throw new GradleException("Expected seven pinned text-compiler jars")
            }
        }
    }
}
''', encoding='utf-8')
    # Resolve via the existing Gradle repositories/cache after the Android build.
    # No signing secrets are supplied to this workflow step.
    command(['gradle', '--project-dir', APP.parent, '--init-script', init,
             ':resolveRelease43TextCompiler', '--no-daemon', '--no-configuration-cache',
             '--max-workers=1', '--no-parallel',
             '-Dorg.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8'], timeout=600)
    cache_home = Path(os.environ.get('GRADLE_USER_HOME') or Path.home()/'.gradle').resolve()
    gate('NATIVE_TEXT_ENTITY_BEHAVIOR')
    java = shutil.which('java')
    assert java is not None
    result = command([sys.executable, APP.parent/'validation/run-text-entity-check.py',
                      '--java-path', java, '--native-root', APP.parent,
                      '--output-directory', TEXT_CHECK/'output',
                      '--gradle-module-cache', cache_home/'caches/modules-2/files-2.1'], timeout=300)
    counts = re.findall(r'^PASS ([0-9]+) native text entity/format/query/actual-route checks$', result, re.MULTILINE)
    assert len(counts) == 1 and int(counts[0]) >= MIN_TEXT_ENTITY_CHECKS
    verify_source()
    receipt = {'sourceSha': SOURCE, 'appSourceTree': SOURCE_TREE, 'passed': True,
               'checkCount': int(counts[0]), 'kotlinCompilerVersion': '2.2.20'}
    with TEXT_RECEIPT.open('x', encoding='utf-8') as stream:
        json.dump(receipt, stream, indent=2); stream.write('\n')
    print('NATIVE_TEXT_ENTITY_CHECKS_PASS_COUNT_'+counts[0])


def seal_aab():
    verify_source()
    gate('CAPTION_CHECK_RECEIPT')
    caption = json.loads(TEXT_RECEIPT.read_text(encoding='utf-8'))
    assert caption['sourceSha'] == SOURCE and caption['appSourceTree'] == SOURCE_TREE
    assert caption['passed'] is True and caption['kotlinCompilerVersion'] == '2.2.20'
    assert type(caption['checkCount']) is int and caption['checkCount'] >= MIN_TEXT_ENTITY_CHECKS
    assert not ASSET.exists()
    with safe_zip(AAB) as archive:
        assert not any(n.endswith('/adi-registration.properties') for n in archive.namelist())
    gate('AAB_SIGNATURE')
    signature = json.loads(command(['java', HERE/'VerifyPlayBundle.java', AAB], timeout=180))
    assert signature['allPayloadEntriesSignedByExpectedCertificate'] is True
    jarsigner = command(['jarsigner', '-verify', AAB], timeout=180)
    assert 'jar verified' in jarsigner.lower()
    gate('BUNDLETOOL_VALIDATE')
    command(['java', '-jar', TOOL, 'validate', '--bundle='+str(AAB)], timeout=180)
    manifest = command(['java', '-jar', TOOL, 'dump', 'manifest', '--bundle='+str(AAB), '--module=base'])
    gate('RELEASE_MANIFEST')
    verify_manifest(manifest)
    gate('PRODUCTION_FULL_LINT')
    lint = APP/'build/reports/lint-results-productionRelease.xml'
    issues = ET.parse(lint).getroot().findall('issue')
    assert not any(i.get('severity') in ('Error', 'Fatal') for i in issues)
    shutil.copyfile(AAB, OUT/'sautilink-production-clean.aab')
    shutil.copyfile(lint, OUT/'lint-results-productionRelease.xml')
    write_json('clean-aab.json', {'status': 'PASS_SIGNED_CLEAN_ARTIFACT', 'sourceSha': SOURCE,
               'package': 'com.sautilink.app', 'versionCode': 43, 'versionName': '1.0.1',
               'minSdk': 26, 'targetSdk': 36, 'debuggable': False,
               'sha256': sha(AAB.read_bytes()), 'uploadCertificateSha256': CERT,
               'bundletoolValidate': True, 'registrationAssetPresent': False,
               'nativeTextEntityChecks': caption,
               'lintFatalOrErrors': 0, 'lintWarnings': sum(i.get('severity') == 'Warning' for i in issues),
               'lintInformational': sum(i.get('severity') not in ('Error','Fatal','Warning') for i in issues),
               **signature, 'playConsoleValidationPerformed': False, 'device16KbValidationPerformed': False})


def seal_outputs():
    expected = {'existing-upload-certificate.pem', 'source-and-signer.json', 'clean-aab.json',
                'sautilink-production-clean.aab', 'lint-results-productionRelease.xml'}
    assert {p.name for p in OUT.iterdir()} == expected
    with (OUT/'SHA256SUMS').open('x', encoding='ascii') as stream:
        for name in sorted(expected): stream.write(sha((OUT/name).read_bytes())+'  '+name+'\n')


def cleanup():
    for path in (KEYSTORE, TOOL, APP/'google-services.json', ASSET):
        if path.is_file(): path.unlink()
    if TEXT_CHECK.is_dir(): shutil.rmtree(TEXT_CHECK)


if __name__ == '__main__':
    try:
        actions = {'prepare': prepare, 'check-caption': check_caption, 'seal-aab': seal_aab,
                   'seal-outputs': seal_outputs, 'cleanup': cleanup}
        assert len(sys.argv) == 2 and sys.argv[1] in actions
        gate('ACTION_'+sys.argv[1].upper().replace('-', '_'))
        actions[sys.argv[1]]()
        print('PLAY_CANDIDATE_'+sys.argv[1].upper().replace('-', '_')+'_PASS')
    except Exception:
        # Command output/errors may contain provider/config/keystore material; never echo them.
        print('::error::PLAY_CANDIDATE_CHECK_FAILED_GATE_'+CHECK_GATE, file=sys.stderr)
        sys.exit(1)
