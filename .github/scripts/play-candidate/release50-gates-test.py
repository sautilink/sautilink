"""Offline fixtures for the new release50 artifact gates; no signer, network or Gradle."""
from contextlib import contextmanager
from pathlib import Path
import importlib.util, io, json, re, struct, sys, tempfile, unittest, zipfile
sys.dont_write_bytecode = True
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('release50_candidate', HERE/'release50.py')
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


@contextmanager
def override(**values):
    previous = {key: getattr(candidate, key) for key in values}
    try:
        for key, value in values.items(): setattr(candidate, key, value)
        yield
    finally:
        for key, value in previous.items(): setattr(candidate, key, value)


def manifest(**changes):
    root = ET.Element('manifest', {'package': 'com.sautilink.app', candidate.ANDROID+'versionCode': '50',
                                 candidate.ANDROID+'versionName': '1.1.5'})
    ET.SubElement(root, 'uses-sdk', {candidate.ANDROID+'minSdkVersion': '26', candidate.ANDROID+'targetSdkVersion': '36'})
    ET.SubElement(root, 'application', {candidate.ANDROID+'debuggable': 'false'})
    for key, value in changes.items():
        if key == 'debuggable': root.find('application').set(candidate.ANDROID+key, value)
        elif key in ('minSdkVersion', 'targetSdkVersion'): root.find('uses-sdk').set(candidate.ANDROID+key, value)
        elif key == 'package': root.set(key, value)
        else: root.set(candidate.ANDROID+key, value)
    return ET.tostring(root, encoding='unicode')


def dex(descriptors, extra_strings=()):
    # Structurally sufficient synthetic class_def tables. The production gate
    # additionally verifies the signed AAB with bundletool and JAR verification.
    strings = list(descriptors) + list(extra_strings)
    string_ids = 112
    type_ids = string_ids + len(strings) * 4
    class_defs = type_ids + len(descriptors) * 4
    string_data = class_defs + len(descriptors) * 32
    data = bytearray(string_data)
    data[:8] = b'dex\n035\0'
    struct.pack_into('<IIII', data, 56, len(strings), string_ids, len(descriptors), type_ids)
    struct.pack_into('<II', data, 96, len(descriptors), class_defs)
    for index, descriptor in enumerate(strings):
        encoded = descriptor.encode('ascii')
        assert len(encoded) < 128
        struct.pack_into('<I', data, string_ids + index * 4, len(data))
        data += bytes([len(encoded)]) + encoded + b'\0'
    for index in range(len(descriptors)):
        struct.pack_into('<I', data, type_ids + index * 4, index)
        struct.pack_into('<I', data, class_defs + index * 32, index)
    struct.pack_into('<I', data, 32, len(data))
    return bytes(data)


def archive(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as output:
        for name, payload in entries: output.writestr(name, payload)
    stream.seek(0)
    return zipfile.ZipFile(stream)


def suites_fixture():
    suites = {key: sorted(cases) for key, cases in candidate.NATIVE_MEDIA_UNIT_SUITES.items()}
    for name in (
        'feature.inbox.NativeDmSocketListenerTest', 'feature.rooms.NativeRoomInvitationProtocolTest',
        'ui.components.NativeStreamPlaybackPolicyTest', 'feature.home.FeedFreshnessTest', 'feature.stories.NativeStoryPolicyTest',
        'feature.stories.NativeStoryUploadDestinationTest', 'feature.stories.NativeStoryUploadRecoveryTest',
        'feature.home.PublishedVideoPlaybackPolicyTest', 'feature.profile.ProfileStoryRingStateTest',
        'feature.stories.NativeStoryUploadProgressTest', 'ui.components.NativePlaybackBootstrapTest',
        'ui.components.NativeStartupServerTimingTest', 'ui.components.NativeStoryPlaybackPrefetchTest',
    ): suites['com.sautilink.nativeapp.'+name] = ['syntheticCase']
    return {'schema': 1, 'suites': suites}


class Release50GatesTest(unittest.TestCase):
    def test_manifest_accepts_only_expected_production_candidate(self):
        candidate.verify_manifest(manifest())
        for changes in ({'package': 'com.sautilink.preview.nativeapp'}, {'versionCode': '49'},
                        {'versionName': '1.1.4'}, {'debuggable': 'true'}, {'targetSdkVersion': '35'},
                        {'minSdkVersion': '25'}):
            with self.subTest(changes=changes), self.assertRaises(AssertionError):
                candidate.verify_manifest(manifest(**changes))

    def test_source_placeholder_fails_before_git_or_secret_reads(self):
        def forbidden(*args, **kwargs): self.fail('unconfigured candidate must not invoke a subprocess')
        with override(SOURCE='INVALID_REVIEWED_SOURCE_SHA', command=forbidden), self.assertRaises(AssertionError):
            candidate.verify_source()

    def test_actual_dex_class_definitions_are_required(self):
        required = candidate.REQUIRED_RUNTIME_DESCRIPTORS
        self.assertEqual(candidate.dex_class_descriptors(dex(required)), set(required))
        with archive([('base/dex/classes.dex', dex(required))]) as bundle:
            receipt = candidate.verify_packaged_runtime(bundle)
            self.assertTrue(receipt['hlsAndStoriesCompiledIntoProductionAab'])
        # A class name appearing as an unrelated string cannot pass as compiled code.
        for missing in required:
            with archive([('base/dex/classes.dex', dex([value for value in required if value != missing], [missing]))]) as bundle:
                with self.subTest(missing=missing), self.assertRaises(AssertionError): candidate.verify_packaged_runtime(bundle)

    def test_multidex_classes10_is_not_silently_ignored(self):
        required = candidate.REQUIRED_RUNTIME_DESCRIPTORS
        with archive([('base/dex/classes.dex', dex(required[:3])), ('base/dex/classes10.dex', dex(required[3:]))]) as bundle:
            self.assertEqual(candidate.verify_packaged_runtime(bundle)['dexFilesChecked'], 2)

    def test_malformed_dex_bounds_and_missing_runtime_fail_closed(self):
        valid = dex(candidate.REQUIRED_RUNTIME_DESCRIPTORS)
        corrupt = bytearray(valid)
        struct.pack_into('<I', corrupt, 60, len(valid) + 4)
        for payload in (valid[:100], bytes(corrupt), b'not a dex', valid[:-1]):
            with self.subTest(length=len(payload)), self.assertRaises(AssertionError):
                candidate.dex_class_descriptors(payload)
        with archive([('base/dex/classes.dex', dex(['Lfixture/Unrelated;']))]) as bundle:
            with self.assertRaises(AssertionError): candidate.verify_packaged_runtime(bundle)

    def test_jvm_manifest_requires_reviewed_hash_and_all_security_suites(self):
        with tempfile.TemporaryDirectory(prefix='release50-offline-') as directory:
            folder = Path(directory)
            target = folder/'release50-jvm-tests.json'
            document = suites_fixture()
            def check(value):
                payload = (json.dumps(value)+'\n').encode()
                target.write_bytes(payload)
                with override(HERE=folder, JVM_MANIFEST_SHA256=candidate.sha(payload)):
                    return candidate.reviewed_jvm_suites()
            self.assertEqual(set(check(document)), set(document['suites']))
            with override(HERE=folder, JVM_MANIFEST_SHA256='0'*64), self.assertRaises(AssertionError):
                candidate.reviewed_jvm_suites()
            removed = json.loads(json.dumps(document))
            removed['suites'].pop('com.sautilink.nativeapp.ui.components.NativeStreamPlaybackPolicyTest')
            with self.assertRaises(AssertionError): check(removed)
            for suite in (
                'feature.home.PublishedVideoPlaybackPolicyTest', 'feature.profile.ProfileStoryRingStateTest',
                'feature.stories.NativeStoryUploadProgressTest', 'ui.components.NativePlaybackBootstrapTest',
                'ui.components.NativeStartupServerTimingTest', 'ui.components.NativeStoryPlaybackPrefetchTest',
            ):
                removed = json.loads(json.dumps(document))
                removed['suites'].pop('com.sautilink.nativeapp.'+suite)
                with self.subTest(suite=suite), self.assertRaises(AssertionError): check(removed)
            skipped = json.loads(json.dumps(document))
            skipped['suites']['com.sautilink.nativeapp.feature.auth.AuthRequestDeadlineTest'].pop()
            with self.assertRaises(AssertionError): check(skipped)
            duplicate = json.loads(json.dumps(document))
            cases = duplicate['suites']['com.sautilink.nativeapp.feature.stories.NativeStoryPolicyTest']
            cases.append(cases[0])
            with self.assertRaises(AssertionError): check(duplicate)

    def test_junit_failures_skips_duplicates_and_extra_suites_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix='release50-offline-') as directory:
            app = Path(directory)
            reports = app/'build/test-results/testPreviewDebugUnitTest'
            reports.mkdir(parents=True)
            name = 'com.sautilink.nativeapp.fixture.PolicyTest'
            target = reports/('TEST-'+name+'.xml')
            def report(cases=('one', 'two'), failed='0', skipped='0'):
                root = ET.Element('testsuite', {'name': name, 'tests': str(len(cases)), 'failures': failed, 'errors': '0', 'skipped': skipped})
                for case in cases: ET.SubElement(root, 'testcase', {'name': case, 'classname': name})
                target.write_bytes(ET.tostring(root))
            with override(APP=app):
                report()
                self.assertEqual(candidate.verify_unit_suite(name, {'one', 'two'})['checkCount'], 2)
                for cases, failed, skipped in ((('one',), '0', '0'), (('one','one'), '0', '0'),
                                              (('one','two'), '1', '0'), (('one','two'), '0', '1')):
                    report(cases, failed, skipped)
                    with self.assertRaises(AssertionError): candidate.verify_unit_suite(name, {'one', 'two'})
                report()
                with override(reviewed_jvm_suites=lambda: {name: {'one', 'two'}}):
                    self.assertEqual(candidate.verify_native_media_unit_tests()['checkCount'], 2)
                    (reports/'TEST-unreviewed.xml').write_text('<testsuite/>')
                    with self.assertRaises(AssertionError): candidate.verify_native_media_unit_tests()

    def test_zip_traversal_or_absolute_names_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix='release50-offline-') as directory:
            target = Path(directory)/'fixture.aab'
            for name in ('../secret', '/absolute', 'base/../secret', 'base\\secret'):
                # Windows ZipInfo normalizes backslashes at construction. Patch
                # name bytes in this intentionally hostile synthetic ZIP only.
                written = name.replace(chr(92), 'X')
                with zipfile.ZipFile(target, 'w') as bundle: bundle.writestr(written, b'fixture')
                if written != name: target.write_bytes(target.read_bytes().replace(written.encode(), name.encode()))
                with self.subTest(name=name), self.assertRaises(AssertionError): candidate.safe_zip(target)

    def test_workflow_retains_expected_dispatch_and_action_pins(self):
        workflow = (HERE.parent.parent/'workflows/native-stream-stories-release50.yml').read_text(encoding='utf-8')
        for expected in (
            "branches: [feat/native-stream-stories-20261021]",
            "github.repository == 'sautilink/sautilink'", "github.run_attempt == 1",
            "github.event.head_commit.message == 'ci: build native Stream and Stories release 50'",
            "github.event.forced == false && github.event.deleted == false",
            'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
            'actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3',
            'gradle/actions/setup-gradle@ed408507eac070d1f99cc633dbcf757c94c7933a',
            'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
            'persist-credentials: false', 'if: always()', 'release50.py cleanup',
            'timeout-minutes: 90', '--max-workers=2 --no-parallel',
            '-Pkotlin.compiler.execution.strategy=in-process', '-Xmx6144m',
        ): self.assertIn(expected, workflow)
        source_checkout = re.search(r'\n          ref: ([A-Za-z0-9_]+)\n          path: candidate', workflow)
        self.assertIsNotNone(source_checkout)
        self.assertEqual(source_checkout[1], candidate.SOURCE)
        self.assertNotIn('workflow_dispatch:', workflow)
        self.assertNotIn('contents: write', workflow)


if __name__ == '__main__':
    unittest.main(verbosity=1)
