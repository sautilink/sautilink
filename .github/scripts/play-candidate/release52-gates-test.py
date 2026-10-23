"""Offline fixtures for the new release52 artifact gates; no signer, network or Gradle."""
from contextlib import contextmanager
from pathlib import Path
import importlib.util, io, json, os, re, shutil, struct, sys, tempfile, unittest, zipfile
sys.dont_write_bytecode = True
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('release52_candidate', HERE/'release52.py')
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
    root = ET.Element('manifest', {'package': 'com.sautilink.app', candidate.ANDROID+'versionCode': '52',
                                 candidate.ANDROID+'versionName': '1.1.7'})
    ET.SubElement(root, 'uses-sdk', {candidate.ANDROID+'minSdkVersion': '26', candidate.ANDROID+'targetSdkVersion': '36'})
    app = ET.SubElement(root, 'application', {candidate.ANDROID+'debuggable': 'false'})
    ET.SubElement(app, 'service', {candidate.ANDROID+'name': 'com.sautilink.nativeapp.feature.videos.NativeShortVideoDownloadService',
        candidate.ANDROID+'exported':'false', candidate.ANDROID+'foregroundServiceType':'dataSync'})
    for permission in ('FOREGROUND_SERVICE','FOREGROUND_SERVICE_DATA_SYNC'):
        ET.SubElement(root,'uses-permission',{candidate.ANDROID+'name':'android.permission.'+permission})
    ET.SubElement(root,'uses-permission',{candidate.ANDROID+'name':'android.permission.WRITE_EXTERNAL_STORAGE',candidate.ANDROID+'maxSdkVersion':'28'})
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
    return {'schema': 1, 'suites': {key: sorted(cases) for key, cases in candidate.NATIVE_MEDIA_UNIT_SUITES.items()}}


class Release52GatesTest(unittest.TestCase):
    def test_manifest_accepts_only_expected_production_candidate(self):
        candidate.verify_manifest(manifest())
        for changes in ({'package': 'com.sautilink.preview.nativeapp'}, {'versionCode': '50'}, {'versionCode': '51'},
                        {'versionName': '1.1.5'}, {'versionName': '1.1.6'}, {'debuggable': 'true'}, {'targetSdkVersion': '35'},
                        {'minSdkVersion': '25'}):
            with self.subTest(changes=changes), self.assertRaises(AssertionError):
                candidate.verify_manifest(manifest(**changes))

    def test_source_placeholder_fails_before_git_or_secret_reads(self):
        def forbidden(*args, **kwargs): self.fail('unconfigured candidate must not invoke a subprocess')
        pins = {name:'a'*40 for name in ('SOURCE','SOURCE_TREE','REPOSITORY_TREE','MAIN_SOURCE_TREE')}
        for name in pins:
            with self.subTest(pin=name), override(**{**pins,name:'INVALID_REVIEWED_SOURCE_SHA'}, command=forbidden), self.assertRaises(AssertionError):
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

    def test_operator_and_test_classes_cannot_be_packaged_into_the_production_aab(self):
        for descriptor in ('Lcom/sautilink/nativeapp/ui/NativeRealHomeJourneyLatencyTest;',
                           'Lcom/sautilink/nativeapp/ui/NativeRealShortsJourneyLatencyTest$Harness;',
                           'Lcom/sautilink/nativeapp/operator/PlaybackObserver;',
                           'Landroidx/test/runner/AndroidJUnitRunner;', 'Lorg/junit/Test;'):
            with archive([('base/dex/classes.dex',dex(candidate.REQUIRED_RUNTIME_DESCRIPTORS+(descriptor,)))]) as bundle:
                with self.subTest(descriptor=descriptor), self.assertRaises(AssertionError):
                    candidate.verify_packaged_runtime(bundle)

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
        with tempfile.TemporaryDirectory(prefix='release52-offline-') as directory:
            folder = Path(directory)
            target = folder/'release52-jvm-tests.json'
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

    def test_reviewed_release52_snapshot_requires_all_256_cases_and_new_security_checks(self):
        payload = (HERE/'release52-jvm-tests.json').read_bytes()
        with override(JVM_MANIFEST_SHA256=candidate.sha(payload)):
            suites = candidate.reviewed_jvm_suites()
        self.assertEqual(len(suites), 39)
        self.assertEqual(sum(map(len, suites.values())), 256)
        name = 'com.sautilink.nativeapp.ui.components.NativePlaybackResumeReuseTest'
        self.assertEqual(suites[name], candidate.NATIVE_MEDIA_UNIT_SUITES[name])
        self.assertEqual(len(suites[name]), 12)
        self.assertEqual(suites, candidate.NATIVE_MEDIA_UNIT_SUITES)

    def test_prior_225_reviewed_cases_remain_required_alongside_all_new_cases(self):
        old=json.loads((HERE/'release51-jvm-tests.json').read_text(encoding='utf-8'))['suites']
        self.assertEqual(len(old),36)
        self.assertEqual(sum(map(len,old.values())),225)
        for name,cases in old.items():
            self.assertLessEqual(set(cases),candidate.NATIVE_MEDIA_UNIT_SUITES[name])
        self.assertEqual(len(candidate.NATIVE_MEDIA_UNIT_SUITES['com.sautilink.nativeapp.ui.components.NativeVideoLookaheadTest']),16)
        self.assertEqual(len(candidate.NATIVE_MEDIA_UNIT_SUITES['com.sautilink.nativeapp.feature.home.NativeFeedDetailReadsTest']),8)
        self.assertEqual(len(candidate.NATIVE_MEDIA_UNIT_SUITES['com.sautilink.nativeapp.feature.posts.NativePostUploadRecoveryTest']),6)

    def test_prior_243_reviewed_cases_are_preserved_exactly_before_the_thirteen_new_cases(self):
        prior = json.loads((HERE/'release52-jvm-tests.json').read_text(encoding='utf-8'))
        self.assertEqual(len(prior['suites'].pop('com.sautilink.nativeapp.feature.home.NativeFeedDetailReadsTest')),8)
        cases = prior['suites']['com.sautilink.nativeapp.ui.components.NativeVideoLookaheadTest']
        for name in (
            'bufferingSampleNewerThanThePreviousCoordinatorTickCannotEnableIdleSpeculation',
            'historyRetainsOnlyTwoParsedSources_withoutSelectingTracksOrLoadingPastSamples',
            'coldHistoryWaitsForHealthyCurrent_butPreparedMetadataSurvivesBufferingUntilExpiryOrOptOut',
            'historyDeadlineNeverExtendsTheOriginalGrant_andCapsMemoryRetentionAtTwoMinutes',
            'historyOptOutCanResumeOnlyTheExactStillMountedPlayerRevision_withoutAnotherAttach',
        ): cases.remove(name)
        payload = (json.dumps(prior,indent=2)+'\n').encode('utf-8')
        self.assertEqual(candidate.sha(payload),'18417a7d3cadfcaf3f5dd2371bae51e4e4c70c5412abbdfb760853b3b77880a4')

    def test_junit_failures_skips_duplicates_and_extra_suites_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix='release52-offline-') as directory:
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
        with tempfile.TemporaryDirectory(prefix='release52-offline-') as directory:
            target = Path(directory)/'fixture.aab'
            for name in ('../secret', '/absolute', 'base/../secret', 'base\\secret'):
                # Windows ZipInfo normalizes backslashes at construction. Patch
                # name bytes in this intentionally hostile synthetic ZIP only.
                written = name.replace(chr(92), 'X')
                with zipfile.ZipFile(target, 'w') as bundle: bundle.writestr(written, b'fixture')
                if written != name: target.write_bytes(target.read_bytes().replace(written.encode(), name.encode()))
                with self.subTest(name=name), self.assertRaises(AssertionError): candidate.safe_zip(target)

    def test_workflow_retains_expected_dispatch_and_action_pins(self):
        workflow = (HERE.parent.parent/'workflows/native-media-readiness-release52.yml').read_text(encoding='utf-8')
        for expected in (
            "name: Native media readiness Play release candidate 52",
            "group: native-media-readiness-release52",
            "name: SautiLink-Play-Release52-",
            "branches: [fix/native-media-readiness-20261023]",
            "github.repository == 'sautilink/sautilink'", "github.run_attempt == 1",
            "github.event.head_commit.message == 'ci: build native media readiness release 52'",
            "github.event.forced == false && github.event.deleted == false",
            'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
            'actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3',
            'gradle/actions/setup-gradle@ed408507eac070d1f99cc633dbcf757c94c7933a',
            'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
            'persist-credentials: false', 'if: always()', 'release52.py cleanup',
            'timeout-minutes: 90', '--max-workers=2 --no-parallel',
            '-Pkotlin.compiler.execution.strategy=in-process', '-Xmx6144m',
        ): self.assertIn(expected, workflow)
        source_checkout = re.search(r'\n          ref: ([A-Za-z0-9_]+)\n          path: candidate', workflow)
        self.assertIsNotNone(source_checkout)
        self.assertEqual(source_checkout[1], candidate.SOURCE)
        self.assertNotIn('workflow_dispatch:', workflow)
        self.assertNotIn('contents: write', workflow)


class Release52ExperienceGatesTest(unittest.TestCase):
    @contextmanager
    def source_fixture(self):
        actual_app = Path(os.environ.get('RELEASE52_CANDIDATE_APP', candidate.APP))
        actual = actual_app/'src/main/java/com/sautilink/nativeapp'
        self.assertTrue(actual.is_dir(), 'SOURCE_FIXTURE_DIRECTORY_REQUIRED')
        files = (
            'feature/posts/NativePostMediaPolicy.kt','feature/posts/NativePostUploadPolicy.kt',
            'feature/posts/NativeMediaClient.kt','feature/posts/NativePostsScreens.kt',
            'feature/posts/NativeMediaEditor.kt','feature/posts/NativeMediaEditPolicy.kt',
            'feature/stories/NativeStoryPolicy.kt','feature/stories/NativeStoryComposer.kt',
            'feature/videos/NativeShortVideoDownloadPolicy.kt','feature/videos/NativeShortVideoDownload.kt',
            'feature/videos/NativeShortVideoDownloadService.kt','feature/videos/ProductionShortVideosScreen.kt',
            'feature/videos/ShortsAuthorIdentityRow.kt',
            'feature/posts/NativePostUploadRecovery.kt',
            'ui/components/NativeVideoReplayPool.kt','ui/components/NativeStreamPlayback.kt',
            'ui/components/NativeShortsPreloading.kt','ui/components/NativeVideoLookahead.kt',
            'feature/home/FeedVideoLookahead.kt','feature/home/StagingFeedScreen.kt',
            'feature/home/ProductionFeedMedia.kt','feature/home/StagingFeedClient.kt',
            'feature/home/NativeFeedDetailReads.kt',
        )
        with tempfile.TemporaryDirectory(prefix='release52-source-fixture-') as directory:
            app = Path(directory)/'app'
            native = app/'src/main/java/com/sautilink/nativeapp'
            for relative in files:
                target = native/relative
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_text((actual/relative).read_text(encoding='utf-8'),encoding='utf-8')
            (app/'src/main/AndroidManifest.xml').write_text((actual_app/'src/main/AndroidManifest.xml').read_text(encoding='utf-8'),encoding='utf-8')
            yield native

    def test_literal_numeric_gate_is_not_evaluated_from_mutable_or_executable_source(self):
        self.assertEqual(candidate.kotlin_integer_constant('const val LIMIT = 250L * 1024 * 1024','LIMIT'),262144000)
        for expression in ('OTHER_LIMIT','getLimit()','250 << 20','__import__("os")','-1','True','2 ** 30'):
            with self.subTest(expression=expression),self.assertRaises((AssertionError,SyntaxError)):
                candidate.kotlin_integer_constant('const val LIMIT = '+expression,'LIMIT')

    def test_current_exact_source_contract_is_accepted_but_does_not_attest_execution(self):
        with self.source_fixture() as native:
            receipt = candidate.verify_native_experience_source(native)
            self.assertEqual(receipt['nativePostAttachmentLimit'],10)
            self.assertEqual(receipt['nativeNewPostImageMaxBytes'],5242880)
            self.assertEqual(receipt['nativePostVideoMaxBytes'],262144000)
            self.assertEqual(receipt['nativePostVideoMaxMilliseconds'],180000)
            self.assertEqual(receipt['nativeBoundedDownloadIoBytes'],65536)
            self.assertEqual(receipt['nativeUpcomingVideoWindow'],5)
            self.assertEqual(receipt['nativeSpeculativeMetadataConcurrency'],2)
            self.assertEqual(receipt['nativeReplayStoreLimit'],8)
            self.assertEqual(receipt['nativeReplayTotalByteLimit'],64*1024*1024)
            self.assertEqual(receipt['nativeReplayPerStoreByteLimit'],8*1024*1024)
            self.assertEqual(receipt['nativeReplayIdleMilliseconds'],120000)
            self.assertEqual(receipt['nativePastParsedSourceLimit'],2)
            self.assertEqual(receipt['nativePastParsedSourceMaxMilliseconds'],120000)
            self.assertFalse(receipt['nativePastParsedSourceLoadsTracksOrSamples'])
            self.assertEqual(receipt['nativeFeedDetailReadMaxBytes'],400000)
            self.assertTrue(receipt['nativeFeedDetailsParallelMediaOnly'])
            self.assertEqual(receipt['nativeUploadReadWriteTimeoutSeconds'],90)
            self.assertEqual(receipt['nativeUploadRetryAttemptLimit'],3)
            self.assertFalse(receipt['nativeFeedWarmupBuildsOffscreenPlayer'])
            self.assertFalse(receipt['nativeLiveReadinessOrPlaybackSpeedAttestedBySourceContract'])
            self.assertFalse(receipt['uploadDownloadOrDeviceExecutionAttestedBySourceContract'])

    def test_complete_current_stream_story_and_readiness_contract_remains_compatible(self):
        app=Path(os.environ.get('RELEASE52_CANDIDATE_APP',candidate.APP))
        with override(APP=app):
            receipt=candidate.verify_stream_stories_source()
        self.assertEqual(receipt['nativeUpcomingVideoWindow'],5)
        self.assertEqual(receipt['nativeStoryVideoLimitSeconds'],30)
        self.assertFalse(receipt['cloudflareStreamActivationVerifiedByCi'])

    def test_replay_lookahead_concurrency_ownership_and_visible_priority_drift_are_rejected(self):
        mutations=(
            ('ui/components/NativeVideoReplayPool.kt','maxStores: Int = 8','maxStores: Int = 3'),
            ('ui/components/NativeVideoReplayPool.kt','maxBytes: Long = 64L','maxBytes: Long = 128L'),
            ('ui/components/NativeVideoReplayPool.kt','idleTtlMillis: Long = 120_000L','idleTtlMillis: Long = 300_000L'),
            ('ui/components/NativeVideoReplayPool.kt','it.references == 0','it.references >= 0'),
            ('ui/components/NativeVideoReplayPool.kt','authOwner === other.authOwner','authOwner != null'),
            ('ui/components/NativeStreamPlayback.kt','maxGrants: Int = 8','maxGrants: Int = 4'),
            ('ui/components/NativeStreamPlayback.kt','metadataPermit.withPermit','metadataPermit.toString'),
            ('ui/components/NativeShortsPreloading.kt','NATIVE_VIDEO_LOOKAHEAD = 5','NATIVE_VIDEO_LOOKAHEAD = 6'),
            ('ui/components/NativeShortsPreloading.kt','NATIVE_VIDEO_RETAIN_BEHIND = 2','NATIVE_VIDEO_RETAIN_BEHIND = 3'),
            ('ui/components/NativeShortsPreloading.kt','if (createPlayer)','if (true)'),
            ('ui/components/NativeShortsPreloading.kt','incoming != null && ownedPlayer','ownedPlayer'),
            ('ui/components/NativeShortsPreloading.kt','permitted = false\n            historyPermitted = false\n            manager.invalidate()',
             'permitted = true\n            historyPermitted = false\n            manager.invalidate()'),
            ('ui/components/NativeVideoLookahead.kt','Semaphore(2)','Semaphore(5)'),
            ('ui/components/NativeVideoLookahead.kt','!saveData && !stressed && !denied','!saveData'),
            ('feature/home/FeedVideoLookahead.kt','createPlayer=false','createPlayer=true'),
            ('feature/home/FeedVideoLookahead.kt','visible?.manualPaused != true','true'),
        )
        with self.source_fixture() as native:
            for relative,old,new in mutations:
                target=native/relative;original=target.read_text(encoding='utf-8')
                self.assertIn(old,original)
                try:
                    target.write_text(original.replace(old,new),encoding='utf-8')
                    with self.subTest(relative=relative,mutation=new),self.assertRaises((AssertionError,SyntaxError,ValueError)):
                        candidate.verify_native_readiness_source(native)
                finally:target.write_text(original,encoding='utf-8')

    def test_past_parsed_source_cannot_load_samples_extend_expiry_or_survive_opt_out(self):
        mutations=(
            ('elapsedNow + (expiresAtMillis-wallNow-5_000L).coerceIn(0L,120_000L)',
             'elapsedNow + 300_000L'),
            ('now >= 0L && now < deadline && (prepared || permitted)',
             'now >= 0L && (prepared || permitted)'),
            ('ShortsPreloadTarget.RETAIN_SOURCE -> DefaultPreloadManager.PreloadStatus.PRELOAD_STATUS_SOURCE_PREPARED',
             'ShortsPreloadTarget.RETAIN_SOURCE -> DefaultPreloadManager.PreloadStatus.PRELOAD_STATUS_TRACKS_SELECTED'),
            ('sourceGenerations[source.mediaId] == source.cacheKey','true'),
            ('.setTag(Any())',''),
            ('takeIf { it.first == mediaItem }','takeIf { true }'),
            ('retainIncoming && (wasRetained || playerOwnsExactIncoming)','wasRetained || playerOwnsExactIncoming'),
            ('incomingItem != null && ownedPlayer?.currentMediaItem == incomingItem',
             'incomingItem != null && ownedPlayer?.currentMediaItem?.mediaId == incomingItem.mediaId'),
            ('entry.second < currentIndex && id != playing','entry.second <= currentIndex'),
            ('removePastSources(expiredOnly=true)','historyPrepared.clear()'),
            ('removePastSources(expiredOnly=false)','historyPrepared.clear()'),
        )
        with self.source_fixture() as native:
            target=native/'ui/components/NativeShortsPreloading.kt';original=target.read_text(encoding='utf-8')
            for old,new in mutations:
                self.assertIn(old,original)
                try:
                    target.write_text(original.replace(old,new),encoding='utf-8')
                    with self.subTest(mutation=new),self.assertRaises((AssertionError,SyntaxError,ValueError)):
                        candidate.verify_native_readiness_source(native)
                finally:target.write_text(original,encoding='utf-8')

    def test_parallel_feed_reads_preserve_owner_cancellation_dependencies_and_bounded_gets(self):
        mutations=(
            ('feature/home/FeedVideoLookahead.kt','feedVideoHealthAt(state.health, SystemClock.elapsedRealtime())',
             'feedVideoHealthAt(state.health, tick)'),
            ('feature/home/FeedVideoLookahead.kt','now >= it.sampledAt && now - it.sampledAt <= 1_250L',
             'now - it.sampledAt <= 1_250L'),
            ('feature/home/NativeFeedDetailReads.kt','= coroutineScope {','= supervisorScope {'),
            ('feature/home/NativeFeedDetailReads.kt','val authors = readAuthors(posts)',
             'val authors = readAuthors(JSONArray())'),
            ('feature/home/NativeFeedDetailReads.kt','currentCoroutineContext().ensureActive(); checkOwner()',
             'currentCoroutineContext().ensureActive()'),
            ('feature/home/NativeFeedDetailReads.kt','continuation.invokeOnCancellation { call.cancel() }',''),
            ('feature/home/NativeFeedDetailReads.kt','require(call.request().method == "GET" && call.request().body == null)',''),
            ('feature/home/NativeFeedDetailReads.kt','if (!continuation.isActive) return',''),
            ('feature/home/NativeFeedDetailReads.kt','bytes.size() + count > 400_000','bytes.size() + count > 4_000_000'),
            ('feature/home/StagingFeedClient.kt','.retryOnConnectionFailure(false).cache(null)',
             '.retryOnConnectionFailure(true).cache(null)'),
            ('feature/home/StagingFeedClient.kt','val postRows = details.posts','val postRows = JSONArray()'),
        )
        with self.source_fixture() as native:
            for relative,old,new in mutations:
                target=native/relative;original=target.read_text(encoding='utf-8')
                self.assertIn(old,original)
                try:
                    target.write_text(original.replace(old,new),encoding='utf-8')
                    with self.subTest(relative=relative,mutation=new),self.assertRaises((AssertionError,SyntaxError,ValueError)):
                        candidate.verify_native_readiness_source(native)
                finally:target.write_text(original,encoding='utf-8')

    def test_upload_recovery_cannot_expand_retries_recreate_begin_or_hide_owner_and_security_errors(self):
        mutations=(
            ('feature/posts/NativeMediaClient.kt','.readTimeout(90, TimeUnit.SECONDS)','.readTimeout(10, TimeUnit.SECONDS)'),
            ('feature/posts/NativeMediaClient.kt','.writeTimeout(90, TimeUnit.SECONDS)','.writeTimeout(10, TimeUnit.SECONDS)'),
            ('feature/posts/NativeMediaClient.kt','finishNativePostUpload(plan, checkActiveOwner','finishNativePostUpload(plan, {}'),
            ('feature/posts/NativePostUploadRecovery.kt','++attempt >= 3','++attempt >= 4'),
            ('feature/posts/NativePostUploadRecovery.kt','it is CancellationException || it is SSLException','it is CancellationException'),
            ('feature/posts/NativePostUploadRecovery.kt','causes.drop(1).any { it is AuthRequestException }','false'),
            ('feature/posts/NativePostUploadRecovery.kt','setOf(408, 425, 500, 502, 503, 504)','setOf(401, 408, 425, 500, 502, 503, 504)'),
            ('feature/posts/NativePostUploadRecovery.kt','val confirmed = finalize()','val confirmed = transfer(1)'),
            ('feature/posts/NativePostUploadRecovery.kt','retry { complete() }','complete()'),
            ('feature/videos/NativeShortVideoDownloadService.kt','FOREGROUND_SERVICE_IMMEDIATE','FOREGROUND_SERVICE_DEFAULT'),
        )
        with self.source_fixture() as native:
            for relative,old,new in mutations:
                target=native/relative;original=target.read_text(encoding='utf-8')
                self.assertIn(old,original)
                try:
                    target.write_text(original.replace(old,new),encoding='utf-8')
                    with self.subTest(relative=relative,mutation=new),self.assertRaises((AssertionError,SyntaxError)):
                        candidate.verify_native_readiness_source(native)
                finally:target.write_text(original,encoding='utf-8')

    def test_post_boundary_drift_and_story_limit_coupling_are_rejected_independently(self):
        mutations = (
            ('feature/posts/NativePostMediaPolicy.kt','MAX_ATTACHMENTS = 10','MAX_ATTACHMENTS = 11'),
            ('feature/posts/NativePostMediaPolicy.kt','MAX_IMAGE_BYTES = 5L','MAX_IMAGE_BYTES = 8L'),
            ('feature/posts/NativePostMediaPolicy.kt','MAX_VIDEO_BYTES = 250L','MAX_VIDEO_BYTES = 251L'),
            ('feature/posts/NativePostMediaPolicy.kt','MAX_VIDEO_MS = 180_000L','MAX_VIDEO_MS = 30_000L'),
            ('feature/stories/NativeStoryPolicy.kt','MAX_VIDEO_MS = 30_000L','MAX_VIDEO_MS = 180_000L'),
            ('feature/stories/NativeStoryPolicy.kt','MAX_IMAGES_PER_DAY = 4','MAX_IMAGES_PER_DAY = 10'),
            ('feature/stories/NativeStoryPolicy.kt','MAX_VIDEOS_PER_DAY = 2','MAX_VIDEOS_PER_DAY = 10'),
        )
        with self.source_fixture() as native:
            for relative,old,new in mutations:
                target=native/relative;original=target.read_text(encoding='utf-8')
                self.assertEqual(original.count(old),1)
                try:
                    target.write_text(original.replace(old,new),encoding='utf-8')
                    with self.subTest(relative=relative,mutation=new),self.assertRaises(AssertionError):
                        candidate.verify_native_experience_source(native)
                finally:target.write_text(original,encoding='utf-8')

    def test_unbounded_io_auth_intent_owner_loss_and_sticky_download_are_rejected(self):
        mutations = (
            ('feature/videos/NativeShortVideoDownloadPolicy.kt','ByteArray(64 * 1024)','ByteArray(expectedBytes.toInt())'),
            ('feature/videos/NativeShortVideoDownloadPolicy.kt','if (!active())','if (false)'),
            ('feature/videos/NativeShortVideoDownload.kt','EXTRA_TICKET, ticket.id','EXTRA_TICKET, ticket.auth.accessTokenForStagingRead()'),
            ('feature/videos/NativeShortVideoDownload.kt','EXTRA_TICKET, ticket.id))','EXTRA_TICKET, ticket.id).putExtras(android.os.Bundle()))'),
            ('feature/videos/NativeShortVideoDownload.kt','auth.account?.id == owner','auth.account != null'),
            ('feature/videos/NativeShortVideoDownloadService.kt','START_NOT_STICKY','START_STICKY'),
            ('feature/videos/NativeShortVideoDownloadService.kt','followRedirects(false)','followRedirects(true)'),
            ('feature/posts/NativeMediaClient.kt','retryOnConnectionFailure(false)','retryOnConnectionFailure(true)'),
        )
        with self.source_fixture() as native:
            for relative,old,new in mutations:
                target=native/relative;original=target.read_text(encoding='utf-8')
                self.assertIn(old,original)
                try:
                    target.write_text(original.replace(old,new),encoding='utf-8')
                    with self.subTest(relative=relative,mutation=new),self.assertRaises((AssertionError,SyntaxError)):
                        candidate.verify_native_experience_source(native)
                finally:target.write_text(original,encoding='utf-8')

    def test_packaged_manifest_requires_private_data_sync_service_and_legacy_only_storage(self):
        candidate.verify_manifest(manifest())
        def service(root):return root.find('application/service')
        for equivalent in ('dataSync','1','0x00000001'):
            root=ET.fromstring(manifest())
            service(root).set(candidate.ANDROID+'foregroundServiceType',equivalent)
            with self.subTest(equivalent=equivalent):candidate.verify_manifest(ET.tostring(root,encoding='unicode'))
        for forbidden in ('0','2','3','0x00000000','0x00000002','0x00000003',
                          'mediaPlayback','dataSync|mediaPlayback','dataSync|location',
                          '0x1','01','DATA_SYNC','unknown',''):
            root=ET.fromstring(manifest())
            service(root).set(candidate.ANDROID+'foregroundServiceType',forbidden)
            with self.subTest(forbidden=forbidden),self.assertRaises(AssertionError):
                candidate.verify_manifest(ET.tostring(root,encoding='unicode'))
        mutations=(lambda r:service(r).set(candidate.ANDROID+'exported','true'),
                   lambda r:service(r).set(candidate.ANDROID+'foregroundServiceType','mediaPlayback'),
                   lambda r:ET.SubElement(service(r),'intent-filter'),
                   lambda r:r.find('application').remove(service(r)),
                   lambda r:ET.SubElement(r,'uses-permission',{candidate.ANDROID+'name':'android.permission.MANAGE_EXTERNAL_STORAGE'}),
                   lambda r:next(n for n in r.findall('uses-permission') if n.get(candidate.ANDROID+'name')=='android.permission.WRITE_EXTERNAL_STORAGE').set(candidate.ANDROID+'maxSdkVersion','36'))
        for index,mutate in enumerate(mutations):
            root=ET.fromstring(manifest());mutate(root)
            with self.subTest(mutation=index),self.assertRaises(AssertionError):candidate.verify_manifest(ET.tostring(root,encoding='unicode'))


if __name__ == '__main__':
    unittest.main(verbosity=1)
