"""Owner-requested Stream, Stories and native feed experience release 50 AAB. Builds only an immutable reviewed source; performs no backend deployment or Google Play publishing."""
from pathlib import Path
import base64, hashlib, json, os, re, shutil, struct, subprocess, sys, urllib.request, zipfile
import xml.etree.ElementTree as ET

# Immutable source pins for the reviewed Stream, Stories and feed experience 1.1.5 (50) candidate.
# Keep SOURCE identical to the candidate checkout ref in native-stream-stories-release50.yml.
SOURCE = 'bbf26ada068742ca86c863cf3385a54572208161'
SOURCE_TREE = 'c00b7c6518b79d0eb9e02caf9d082d10919069ac'
REPOSITORY_TREE = '1957e47f7f3dfc4e639a0fa92f81172371f6ba93'
MAIN_SOURCE_TREE = 'efc8716d80647feff75e4c395c2ced75a1f8f4d8'
JVM_MANIFEST_SHA256 = '242fd0c8ad52c13e6c11e0dcbb1770049e064b0ae416a7b019dc336a9ae42572'
CERT = '31c773a7229a563d92f7047a56735ad7b02027d27a6e020d8923dd5418f4b50f'
FIREBASE_SHA = 'be30a77f6be106c97b59ecdc6e7cc61100e0d9fd354ac883357e253fb69e6cae'
BUNDLETOOL_SHA = 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'
ANDROID = '{http://schemas.android.com/apk/res/android}'
ROOT = Path(os.environ.get('GITHUB_WORKSPACE', '.')).resolve()
TEMP = Path(os.environ.get('RUNNER_TEMP', '.')).resolve()
APP = ROOT / 'candidate/native-android/app'
OUT = TEMP / 'sautilink-release50-public'
KEYSTORE = TEMP / 'sautilink-play-release50-upload.jks'
TOOL = TEMP / 'sautilink-bundletool-1.18.3.jar'
TEXT_CHECK = TEMP / 'sautilink-release50-text-check'
TEXT_RECEIPT = TEXT_CHECK / 'checks.json'
INTEGRITY_CHECK = TEMP / 'sautilink-release50-integrity-check'
INTEGRITY_RECEIPT = INTEGRITY_CHECK / 'checks.json'
VIDEO_CHECK = TEMP / 'sautilink-release50-video-check'
VIDEO_RECEIPT = VIDEO_CHECK / 'checks.json'
ASSET = APP / 'src/main/assets/adi-registration.properties'
AAB = APP / 'build/outputs/bundle/productionRelease/app-production-release.aab'
HERE = Path(__file__).resolve().parent
CHECK_GATE = 'ACTION_DISPATCH'
MIN_TEXT_ENTITY_CHECKS = 191
MIN_INTEGRITY_CHECKS = 63
MIN_VIDEO_TRANSPORT_CHECKS = 43

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

VIDEO_API_COORDINATES = (
    'androidx.media3:media3-common:1.11.1@aar',
    'androidx.media3:media3-datasource:1.11.1@aar',
    'androidx.annotation:annotation-experimental:1.4.1@aar',
    'com.google.guava:guava:33.3.1-android@jar',
)

NATIVE_MEDIA_UNIT_SUITES = {
    'com.sautilink.nativeapp.feature.auth.AuthRequestDeadlineTest': {
        'successAndOrdinaryTransportFailurePassThroughWithoutRetry',
        'ownDeadlineBecomesSocketTimeout_andLeavesCallerActive',
        'outerDeadlineRemainsCancellation_andNeverBecomesTransportFailure',
        'explicitJobCancellationRemainsCancellation_andCleansUp',
    },
    'com.sautilink.nativeapp.feature.home.AuthorizedImagePreviewPolicyTest': {
        'postPhotoUsesExisting480Width_andKeepsVersionEncoding',
        'roomCoverUses480_andPreservesImmutableRevision',
        'alreadySmallRequests_andVideoPosters_doNotDoubleDownload',
        'unsupportedProtectedEndpoints_neverInventPreviewRoutes',
        'absoluteUrls_fragments_ambiguousWidths_andInvalidMedia_areRejected',
        'accountSwitchErasesPreviews_andOldCompletionsCannotPolluteNewSession',
        'signOutCancelsCacheOwnership_evenWhenSameAccountSignsInAgain',
        'previewExpiryDoesNotExtendOnRead_andClockRollbackFailsClosed',
        'boundedMemoryEvictsLeastRecentlyUsed_andOversizedImagesAreNotStored',
        'sessionTokenRefreshAndBackendSwitchClearOldPreviews',
    },
    'com.sautilink.nativeapp.feature.home.AuthorizedImageRequestTest': {
        'recycledCellCancelsSocket_andDisposesAnyLateResponseWithoutReading',
        'validAuthenticatedImageBodyIsReturnedAndClosed',
        'chunkedResponsesCannotBypassTheByteLimit',
        'declaredOversizedNonImageAndDeniedResponsesFailBeforeDecoding',
        'transientNetworkFailureRetriesOnlyOnceThenReturnsImageBytes',
        'transientHttpStatusesRetryOnce_andCloseEveryFailedBody',
        'authMissingAndRedirectStatusesNeverRetry',
        'invalidBodyAndOversizeNeverRetry',
        'cancellingDuringBackoffNeverStartsAReplacementCall',
        'lostAccountEligibilityDuringBackoffStopsBeforeRetry',
        'retryAfterSecondsAndHttpDatesAreHonouredWithinBudget',
        'longOrOverflowingRetryAfterDoesNotCreateAnEarlyRequest',
        'repeatedTransientFailureStopsAtTwoAttempts',
        'obsoleteScopeAndNonGetRequestsNeverStartImageTransport',
        'wrappedAuthTransportFailureAllowsEnvironmentRecovery_withoutAutomaticRequestRetry',
        'authEnvironmentRecoveryRequiresTransientStatus_andNeverBypassesDeniedOrMissingSessions',
    },
    'com.sautilink.nativeapp.feature.home.FollowReadRecoveryTest': {
        'oneTransientGetFailureRetriesThenReturnsOnlySuccessfulResponseBytes',
        'transientHttpFailuresRetryOnlyOnce_andEveryResponseCloses',
        'denialMissingAndRedirectStatusesNeverRetryOrInventFollowState',
        'persistentNetworkFailureStopsAfterTwoAttempts',
        'cancellationDuringBackoffPreventsAnotherGet',
        'accountChangeDuringBackoffPreventsAnotherGet',
        'lateResponseFromPreviousAccountIsDiscarded',
        'cancelledFeedCancelsSocket_andClosesUnreadLateBody',
        'mutationCallsCannotEnterTheReadRetryBoundary',
        'invalidOrOversizedJsonIsNotRetried_andChunkedBytesRemainBounded',
        'retryAfterAndTypedCausesRespectCooldownAndAuthorization',
        'malformedOrCrossBatchRowsStayUnknown_insteadOfBecomingFalse',
        'aConfirmedFollowDuringReadRecoveryCannotBeOverwrittenByLateGet',
    },
    'com.sautilink.nativeapp.ui.components.RecentVideoTransferObservationTest': {
        'startupAndConnectionSignalsNeverBecomeAnInitialBandwidthGuess',
        'aNewVideoCellCanReuseRecentActualTransferOnTheSameNetwork',
        'tinyFastInvalidAndEmptySamplesCannotReplaceOrExtendAnActualMeasurement',
        'measurementExpiresAtThirtySeconds_andReadsNeverExtendItsLifetime',
        'networkHandoffForgetsOldCapacity_andReturningToWifiDoesNotResurrectIt',
        'delayedTransferThatOverlapsNetworkHandoffIsNotAssignedToTheNewNetwork',
        'offlineUnvalidatedOrUnknownNetworksCannotRetainOrCreateAMeasurement',
        'newSubstantialTransferUpdatesTheCapacity_andTheNextCellUsesIt',
        'dataSaverAndMeteringOverrideRecentFastCapacityForTheNextVideo',
        'clockRollbackDiscardsTheOldMeasurement_andPreRollbackSamplesCannotRepopulateIt',
    },
    'com.sautilink.nativeapp.ui.components.VideoPlaybackLabelsTest': {
        'timelineUsesMinutesAndHours_andNeverDisplaysNegativeUnsetTime',
        'autoLabelRequiresMeasuredDecodedQuality_manualChoiceRemainsExplicit',
    },
}


def gate(name):
    global CHECK_GATE
    CHECK_GATE = name


def sha(data): return hashlib.sha256(data).hexdigest()


def command(args, timeout=90, failure_context=None):
    assert failure_context in (None, 'VIDEO_API_DEPENDENCY_RESOLUTION', 'ACTUAL_NATIVE_VIDEO_TRANSPORT_BEHAVIOR')
    def diagnostic(reason, exit_code=None):
        if failure_context is not None:
            suffix = ('_EXIT_'+str(int(exit_code))) if exit_code is not None else ''
            # Fixed labels only: never echo arguments, raw output, URLs or environment.
            print('::error::PLAY_CANDIDATE_COMMAND_'+failure_context+'_'+reason+suffix, file=sys.stderr)
    try:
        process = subprocess.run(list(map(str, args)), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        diagnostic('TIMEOUT')
        raise RuntimeError('COMMAND_TIMEOUT') from None
    except OSError:
        diagnostic('TOOL_UNAVAILABLE')
        raise RuntimeError('COMMAND_TOOL_UNAVAILABLE') from None
    if process.returncode != 0:
        output = (process.stdout + process.stderr).lower()
        reason = 'PROCESS_FAILED'
        if b'matching variant' in output or b'cannot choose between' in output:
            reason = 'DEPENDENCY_VARIANT_SELECTION_FAILED'
        elif b'no cached version' in output or b'expected one cached dependency' in output:
            reason = 'REQUIRED_DEPENDENCY_NOT_CACHED'
        elif b'could not resolve' in output or b'could not find' in output:
            reason = 'DEPENDENCY_RESOLUTION_FAILED'
        diagnostic(reason, process.returncode)
        raise RuntimeError('COMMAND_FAILED')
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
    try:
        names = archive.namelist()
        assert names == [entry.orig_filename for entry in archive.infolist()]
        assert len(names) == len(set(names))
        assert all(not n.startswith('/') and '\\' not in n and '..' not in n.split('/') for n in names)
        assert archive.testzip() is None
        return archive
    except Exception:
        archive.close()
        raise


def verify_native_libraries(archive):
    """Retain release45's downloaded-artifact 16KB ELF check in the build gate."""
    libraries = []
    for name in archive.namelist():
        leaf = name.rsplit('/', 1)[-1].lower()
        assert leaf not in {'adi-registration.properties', 'google-services.json',
                            'local.properties', 'id_rsa', 'id_ed25519'}
        assert not leaf.endswith(('.jks', '.keystore', '.p12', '.pfx', '.key'))
        if not name.endswith('.so') or not any('/'+abi+'/' in name for abi in ('arm64-v8a', 'x86_64')):
            continue
        data = archive.read(name)
        assert len(data) >= 64 and data[:4] == b'\x7fELF' and data[4] == 2 and data[5] == 1
        phoff = struct.unpack_from('<Q', data, 32)[0]
        phsize, phnum = struct.unpack_from('<HH', data, 54)
        assert phnum > 0 and phsize >= 56 and phoff + phsize * phnum <= len(data)
        alignments = []
        for index in range(phnum):
            entry = struct.unpack_from('<IIQQQQQQ', data, phoff + index * phsize)
            if entry[0] == 1:
                alignment = entry[7]
                assert alignment >= 16384 and alignment & (alignment - 1) == 0
                assert (entry[3] - entry[2]) % 16384 == 0
                alignments.append(alignment)
        assert alignments
        libraries.append({'library': name, 'loadSegmentAlignments': alignments})
    assert libraries
    return libraries


def verify_source():
    gate('PINNED_SOURCE_AND_CLEAN_TRACKED_FILES')
    assert all(re.fullmatch(r'[a-f0-9]{40}', value) for value in (SOURCE, SOURCE_TREE, REPOSITORY_TREE, MAIN_SOURCE_TREE))
    assert command(['git', '-C', APP.parent.parent, 'rev-parse', 'HEAD']).strip() == SOURCE
    assert command(['git', '-C', APP.parent.parent, 'rev-parse', 'HEAD^{tree}']).strip() == REPOSITORY_TREE
    assert command(['git', '-C', APP.parent.parent, 'rev-parse', 'HEAD:native-android/app/src']).strip() == SOURCE_TREE
    assert command(['git', '-C', APP.parent.parent, 'rev-parse', 'HEAD:native-android/app/src/main']).strip() == MAIN_SOURCE_TREE
    reviewed_jvm_suites()
    assert not command(['git', '-C', APP.parent.parent, 'status', '--porcelain', '--untracked-files=no']).strip()


def verify_integrity_source():
    gate('MONITOR_ONLY_INTEGRITY_SOURCE')
    native = APP/'src/main/java/com/sautilink/nativeapp'
    monitor = (native/'feature/integrity/NativePlayIntegrityMonitor.kt').read_text(encoding='utf-8')
    policy = (native/'feature/integrity/PlayIntegrityMonitorPolicy.kt').read_text(encoding='utf-8')
    auth = (native/'feature/auth/StagingAuthClient.kt').read_text(encoding='utf-8')
    main = (native/'MainActivity.kt').read_text(encoding='utf-8')
    gradle = (APP/'build.gradle.kts').read_text(encoding='utf-8')
    assert gradle.count('implementation("com.google.android.play:integrity:1.6.0")') == 1
    assert len(re.findall(r'^\s*versionCode = 50\s*$', gradle, re.MULTILINE)) == 1
    assert len(re.findall(r'^\s*versionName = "1\.1\.5"\s*$', gradle, re.MULTILINE)) == 1
    assert 'const val MODE = "monitor"' in policy
    assert 'BuildConfig.APPLICATION_ID != "com.sautilink.app"' in monitor
    assert 'auth.backend != SautiBackend.PRODUCTION' in monitor
    assert 'auth.cachedAccessTokenForObservation(accountId)' in monitor
    assert not any(name in monitor for name in ('accessTokenForStagingRead(', 'restoreSession(',
        'signOut(', 'forgetSavedSession(', 'Log.', 'println(', 'printStackTrace('))
    snapshot = re.search(r'    fun cachedAccessTokenForObservation\([^\n]+\)\s*:\s*String\?\s*\{(.*?)\n    \}', auth, re.DOTALL)
    assert snapshot is not None
    assert 'sessionState != StagingSessionState.SIGNED_IN' in snapshot[1]
    assert 'currentUser?.id != expectedAccountId' in snapshot[1]
    assert not any(name in snapshot[1] for name in ('activeAccessToken(', 'refreshSession(',
        'restoreSession(', 'clearLocalSession(', 'vault.'))
    hook = re.search(r'    LaunchedEffect\(activeAccountId, visibleOnScreen, appResumeVersion\)\s*\{(.*?)\n    \}', main, re.DOTALL)
    assert hook is not None and main.count('NativePlayIntegrityMonitor.syncIfDue(') == 1
    assert 'NativePlayIntegrityMonitor.syncIfDue(' in hook[1] and 'delay(2_000)' in hook[1]
    assert 'activeAccountId == null || !visibleOnScreen' in hook[1]
    return {'playIntegrityModeInSource': 'monitor', 'playIntegrityLibraryVersion': '1.6.0',
            'integrityUsesReadOnlyCachedAuthSnapshot': True, 'integrityHookSeparateFromAppAccess': True,
            'integrityProductionPackageAndBackendOnly': True,
            'playIntegrityLiveTokenValidationPerformed': False, 'googlePlayPublishingPerformed': False}


def verify_stream_stories_source():
    """Require the reviewed first-party HLS route, Story lifecycle and thin controls.

    Immutable source pins are authoritative. These explicit contracts catch an
    accidentally reverted module before signing; JVM cases check actual behavior.
    They do not claim to validate a production backend or physical-device playback.
    """
    gate('NATIVE_STREAM_STORIES_SOURCE_CONTRACT')
    native = APP/'src/main/java/com/sautilink/nativeapp'
    gradle = (APP/'build.gradle.kts').read_text(encoding='utf-8')
    expected_media3 = {'media3-exoplayer', 'media3-exoplayer-hls',
                       'media3-datasource-okhttp', 'media3-ui', 'media3-transformer'}
    coordinates = re.findall(r'implementation\("androidx\.media3:([^":]+):([^"\n]+)"\)', gradle)
    assert {module for module, _ in coordinates} == expected_media3
    assert len(coordinates) == len(expected_media3) and all(version == '1.11.1' for _, version in coordinates)
    resolver = (native/'ui/components/NativeStreamPlayback.kt').read_text(encoding='utf-8')
    origin = (native/'ui/components/NativeVideoOriginDataSource.kt').read_text(encoding='utf-8')
    selector = (native/'ui/components/NativeHlsTrackSelection.kt').read_text(encoding='utf-8')
    feed = (native/'feature/home/ProductionFeedMedia.kt').read_text(encoding='utf-8')
    shorts = (native/'feature/videos/ProductionShortVideosScreen.kt').read_text(encoding='utf-8')
    story_player = (native/'ui/components/NativeStoryVideo.kt').read_text(encoding='utf-8')
    thin = (native/'ui/components/ThinVideoSeekBar.kt').read_text(encoding='utf-8')
    controls = (native/'ui/components/VideoPlaybackControls.kt').read_text(encoding='utf-8')
    policy = (native/'feature/stories/NativeStoryPolicy.kt').read_text(encoding='utf-8')
    client = (native/'feature/stories/NativeStoriesClient.kt').read_text(encoding='utf-8')
    composer = (native/'feature/stories/NativeStoryComposer.kt').read_text(encoding='utf-8')
    viewer = (native/'feature/stories/NativeStoryViewer.kt').read_text(encoding='utf-8')
    profile = (native/'feature/profile/NativeProfileScreen.kt').read_text(encoding='utf-8')
    profile_ring = (native/'feature/profile/ProfileStoryRingState.kt').read_text(encoding='utf-8')
    for marker in ('trustedPlaybackMetadataPath', 'authenticatedHlsUrl', 'parseNativeVideoSource',
                   'NativeHlsGrantRegistry', 'nativePlaybackRefreshDelay', 'expires_at',
                   'https://sautilink.com', 'https://test.sautilink.com', 'followRedirects(false)',
                   'followSslRedirects(false)', 'state.denied', 'fallbackPath'):
        assert marker in resolver
    for marker in ('authenticatedHlsUrl', 'authenticatedVideoUrl', 'sessionActive()',
                   'followRedirects(false)', 'followSslRedirects(false)', 'authorizationToken()', 'hlsGrants.allows'):
        assert marker in origin
    assert 'clearOverridesOfType(C.TRACK_TYPE_VIDEO)' in selector and 'TrackSelectionOverride' in selector
    assert '.setForceLowestBitrate(false)' in selector
    assert 'setMediaItem' not in selector and '.prepare(' not in selector
    for consumer in (feed, shorts, story_player):
        assert 'rememberNativePlaybackSource' in consumer and 'NativeHlsQualitySelection' in consumer
        assert 'DefaultMediaSourceFactory' in consumer
    # Bootstrap is an explicit descriptor opt-in and a bounded, one-use memory
    # handoff. It must never become a persistent or generic HTTP response cache.
    for marker in ('header("X-Sauti-Playback-Bootstrap", "1")', 'class NativePlaybackBootstrap',
                   'rows.length() in 1..9', 'total <= 256 * 1024', 'entries.remove(url)',
                   'receivedAtMillis + 5_000L', 'elapsedNanos >= 5_000_000_000L',
                   'require(entries.containsKey(masterUrl))', 'it.fill(0)',
                   'class NativeStoryPlaybackWindow', 'while (reads.size > 2)',
                   'nativePlaybackReusableDelay', 'read.ownerId != owner'):
        assert marker in resolver
    # Codec initialization is the only binary bootstrap extension. It must be
    # referenced by an authorized MAP, contain no top-level samples/fragments,
    # and retain the same small, short-lived, single-use boundary as playlists.
    for marker in ('fun nativePlaybackInitialization(bytes: ByteArray)', 'bytes.size !in 24..16_384',
                   'boxes >= 2', 'type != if (boxes == 0) "ftyp" else "moov"',
                   'inits.length() <= 8', 'url in mapUris', 'nativePlaybackInitialization(bytes)',
                   'combined <= 256 * 1024', 'entries.putAll(initializations)'):
        assert marker in resolver
    initialization_extension = resolver[resolver.index('val initializations = runCatching {'):
                                        resolver.index('entries.putAll(initializations)')]
    assert '}.getOrNull().orEmpty()' in initialization_extension
    for marker in ('dataSpec.position == 0L', 'dataSpec.length == androidx.media3.common.C.LENGTH_UNSET.toLong()',
                   'hlsGrants.consumeBootstrap(dataSpec.uri.toString())', 'ByteArrayDataSource(initialPlaylist)'):
        assert marker in origin
    assert 'publishedVideoAdaptivePlayback(media.id, mediaPath, adaptivePlaybackEnabled)' in feed
    for marker in ('NativeStoryPlaybackWindow()', 'currentPlayback =', 'nextVideo =',
                   'enabled = foreground && ready && !paused && error == null', 'retainedRead = nextPlayback',
                   'playbackRead = currentPlayback'):
        assert marker in viewer
    assert 'retainedRead = playbackRead' in story_player
    assert 'rememberProfileStoryRingActive(auth, profile, refresh)' in profile and 'ProfileStoryAvatarFrame(' in profile
    for marker in ('ProfileStoryRingState', 'state.complete(ticket, result)', 'scope == expected',
                   'StoryAvatarRing(active, onOpen, modifier)', 'Surface(shape = CircleShape',
                   'delay(60_000)', 'refreshRevision, foreground, online, sharedActive'):
        assert marker in profile_ring
    frame = profile_ring[profile_ring.index('internal fun ProfileStoryAvatarFrame('):]
    assert frame.index('StoryAvatarRing(active, onOpen, modifier)') < frame.index('Surface(shape = CircleShape')
    assert 'VideoPlaybackControls(' in feed and 'ShortVideoProgressControls(' in shorts
    assert controls.count('ThinVideoSeekBar(') == 2 and 'Slider(' not in controls
    assert 'Canvas(' in thin and 'StrokeCap.Round' in thin and 'setProgress' in thin
    assert 'detectHorizontalDragGestures' in thin and 'Slider(' not in thin
    for marker in ('MAX_VIDEO_MS = 30_000L', 'MAX_IMAGES_PER_DAY = 4', 'MAX_VIDEOS_PER_DAY = 2',
                   'MAX_CAPTION = 500', 'fun active(', 'serverOffsetMs'):
        assert marker in policy
    for marker in ('followRedirects(false)', 'followSslRedirects(false)', 'checkOwner(expected)',
                   'NativeStoryPolicy.MAX_VIDEO_MS', 'storyUploadDestinationAllowed',
                   'storyUploadRecovery', 'suspend fun edit(', 'suspend fun delete(',
                   'suspend fun markViewed(', 'suspend fun viewers(', 'suspend fun react('):
        assert marker in client
    assert 'maximumVideoMs = NativeStoryPolicy.MAX_VIDEO_MS' in composer and 'storyPhoto = !video' in composer
    assert 'View profile' in viewer or 'View Profile' in viewer
    assert 'ModalBottomSheet' in viewer
    return {'mediaInfrastructure': 'authenticated-first-party-HLS-gateway-with-existing-MP4-fallback',
            'nativeHlsRuntimeIncluded': True, 'nativeStoriesRuntimeIncluded': True,
            'media3Version': '1.11.1', 'nativePlaybackUsesFirstPartyGateway': True,
            'nativeStoryVideoLimitSeconds': 30, 'nativeStoryDailyVideoLimit': 2,
            'nativeStoryDailyImageLimit': 4, 'nativeThinAccessibleVideoTimelineIncluded': True,
            'nativeOneUsePlaybackBootstrapIncluded': True, 'nativeBoundedNextStoryHandoffIncluded': True,
            'nativeBoundedCodecInitializationIncluded': True,
            'nativeProfileStoryRingOutsideSurfaceBorder': True,
            'cloudflareStreamActivationVerifiedByCi': False, 'backendDeploymentPerformed': False}


def reviewed_jvm_suites():
    gate('REVIEWED_JVM_TEST_MANIFEST')
    assert re.fullmatch(r'[a-f0-9]{64}', JVM_MANIFEST_SHA256)
    payload = (HERE/'release50-jvm-tests.json').read_bytes()
    assert sha(payload) == JVM_MANIFEST_SHA256
    document = json.loads(payload)
    assert set(document) == {'schema', 'suites'} and document['schema'] == 1
    suites = document['suites']
    assert type(suites) is dict and suites
    required = set(NATIVE_MEDIA_UNIT_SUITES) | {
        'com.sautilink.nativeapp.feature.inbox.NativeDmSocketListenerTest',
        'com.sautilink.nativeapp.feature.rooms.NativeRoomInvitationProtocolTest',
        'com.sautilink.nativeapp.ui.components.NativeStreamPlaybackPolicyTest',
        'com.sautilink.nativeapp.feature.home.FeedFreshnessTest',
        'com.sautilink.nativeapp.feature.stories.NativeStoryPolicyTest',
        'com.sautilink.nativeapp.feature.stories.NativeStoryUploadDestinationTest',
        'com.sautilink.nativeapp.feature.stories.NativeStoryUploadRecoveryTest',
        'com.sautilink.nativeapp.feature.home.PublishedVideoPlaybackPolicyTest',
        'com.sautilink.nativeapp.feature.profile.ProfileStoryRingStateTest',
        'com.sautilink.nativeapp.feature.stories.NativeStoryUploadProgressTest',
        'com.sautilink.nativeapp.ui.components.NativePlaybackBootstrapTest',
        'com.sautilink.nativeapp.ui.components.NativeStartupServerTimingTest',
        'com.sautilink.nativeapp.ui.components.NativeStoryPlaybackPrefetchTest',
    }
    assert required <= set(suites)
    for name, cases in suites.items():
        assert re.fullmatch(r'com\.sautilink\.nativeapp\.[A-Za-z0-9_.]+Test', name)
        assert type(cases) is list and cases and len(cases) == len(set(cases))
        assert all(type(case) is str and 0 < len(case) <= 300 and not any(c in case for c in '\r\n\x00') for case in cases)
    for name, baseline in NATIVE_MEDIA_UNIT_SUITES.items():
        assert baseline <= set(suites[name])
    return {name: set(cases) for name, cases in suites.items()}


REQUIRED_RUNTIME_DESCRIPTORS = (
    'Landroidx/media3/exoplayer/hls/HlsMediaSource;',
    'Lcom/sautilink/nativeapp/ui/components/NativeStreamPlaybackKt;',
    'Lcom/sautilink/nativeapp/ui/components/NativePlaybackBootstrap;',
    'Lcom/sautilink/nativeapp/ui/components/NativeStoryPlaybackWindow;',
    'Lcom/sautilink/nativeapp/ui/components/NativeHlsTrackSelectionKt;',
    'Lcom/sautilink/nativeapp/ui/components/ThinVideoSeekBarKt;',
    'Lcom/sautilink/nativeapp/ui/components/NativeStoryVideoKt;',
    'Lcom/sautilink/nativeapp/feature/stories/NativeStoriesClient;',
    'Lcom/sautilink/nativeapp/feature/stories/NativeStoryPolicy;',
    'Lcom/sautilink/nativeapp/feature/stories/NativeStoryComposerKt;',
    'Lcom/sautilink/nativeapp/feature/stories/NativeStoryViewerKt;',
    'Lcom/sautilink/nativeapp/feature/stories/NativeStoriesScreenKt;',
    'Lcom/sautilink/nativeapp/feature/profile/ProfileStoryRingState;',
)


def dex_class_descriptors(data):
    """Read actual DEX class_def descriptors, not arbitrary embedded string markers."""
    assert len(data) >= 112 and data[:4] == b'dex\n' and data[7:8] == b'\0'
    assert data[4:7] in (b'035', b'037', b'038', b'039', b'040', b'041')
    assert struct.unpack_from('<I', data, 32)[0] == len(data)
    strings_count, strings_offset, types_count, types_offset = struct.unpack_from('<IIII', data, 56)
    classes_count, classes_offset = struct.unpack_from('<II', data, 96)
    for count, offset, width in ((strings_count, strings_offset, 4), (types_count, types_offset, 4),
                                 (classes_count, classes_offset, 32)):
        assert 0 < count <= 2_000_000 and 112 <= offset <= len(data) and count * width <= len(data) - offset
    descriptors = set()
    for index in range(classes_count):
        type_index = struct.unpack_from('<I', data, classes_offset + index * 32)[0]
        assert type_index < types_count
        string_index = struct.unpack_from('<I', data, types_offset + type_index * 4)[0]
        assert string_index < strings_count
        offset = struct.unpack_from('<I', data, strings_offset + string_index * 4)[0]
        assert 112 <= offset < len(data)
        # DEX strings start with a bounded ULEB128 UTF-16 length. These class
        # descriptors are ASCII; non-ASCII unrelated classes are not required.
        for octet in range(5):
            assert offset < len(data)
            value = data[offset]
            offset += 1
            if value < 128: break
        else: raise AssertionError('INVALID_DEX_STRING_LENGTH')
        end = data.find(b'\0', offset, min(len(data), offset + 4096))
        assert end >= offset
        descriptors.add(data[offset:end].decode('ascii', errors='replace'))
    return descriptors


def verify_packaged_runtime(archive):
    gate('AAB_INCLUDES_ACTUAL_HLS_STORIES_AND_THIN_TIMELINE_RUNTIME')
    names = sorted(name for name in archive.namelist() if re.fullmatch(r'base/dex/classes(?:[2-9]|[1-9][0-9]+)?\.dex', name))
    assert names
    compiled = set().union(*(dex_class_descriptors(archive.read(name)) for name in names))
    assert set(REQUIRED_RUNTIME_DESCRIPTORS) <= compiled
    return {'requiredRuntimeDescriptors': list(REQUIRED_RUNTIME_DESCRIPTORS),
            'dexFilesChecked': len(names), 'hlsAndStoriesCompiledIntoProductionAab': True}


def verify_manifest(xml):
    root = ET.fromstring(xml)
    assert root.tag == 'manifest' and root.get('package') == 'com.sautilink.app'
    assert root.get(ANDROID+'versionCode') == '50'
    assert root.get(ANDROID+'versionName') == '1.1.5'
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
    integrity_source = verify_integrity_source()
    media_source = verify_stream_stories_source()
    assert not command(['git', '-C', APP.parent.parent, 'status', '--porcelain', '--untracked-files=all']).strip()
    assert not (APP.parent/'local.properties').exists() and not ASSET.exists()
    assert not KEYSTORE.exists() and not OUT.exists() and not TOOL.exists()
    assert not TEXT_CHECK.exists() and not TEXT_RECEIPT.exists()
    assert not INTEGRITY_CHECK.exists() and not INTEGRITY_RECEIPT.exists()
    assert not VIDEO_CHECK.exists() and not VIDEO_RECEIPT.exists()
    OUT.mkdir(mode=0o700)
    firebase = base64.b64decode(''.join(secret('FIREBASE_CONFIG').split()), validate=True)
    assert sha(firebase) == FIREBASE_SHA
    config = json.loads(firebase)
    clients = [c for c in config.get('client', []) if c.get('client_info', {}).get('android_client_info', {}).get('package_name') == 'com.sautilink.app']
    assert config.get('project_info', {}).get('project_id') == 'sautilink' and len(clients) == 1
    preview_clients = [c for c in config.get('client', []) if c.get('client_info', {}).get('android_client_info', {}).get('package_name') == 'com.sautilink.preview.nativeapp']
    assert len(preview_clients) == 1
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
    write_json('source-and-signer.json', {'sourceSha': SOURCE, 'appSourceTree': SOURCE_TREE, 'repositoryTree': REPOSITORY_TREE, 'appMainSourceTree': MAIN_SOURCE_TREE,
               'uploadCertificateSha256': CERT, 'firebaseConfigSha256': FIREBASE_SHA,
               'productionFirebaseClientExactlyOne': True, 'previewFirebaseClientExactlyOne': True,
               'bundletoolVersion': '1.18.3',
               'bundletoolSha256': BUNDLETOOL_SHA, 'registrationAssetAbsentBeforeAab': True,
               'sourceCleanBeforeBuild': True, **integrity_source, **media_source})


def check_caption():
    verify_source()
    gate('CAPTION_COMPILER_CACHE')
    assert not TEXT_CHECK.exists()
    TEXT_CHECK.mkdir(mode=0o700)
    init = TEXT_CHECK/'resolve-compiler.gradle'
    coordinates = ',\n                '.join(json.dumps(c) for c in TEXT_COMPILER_COORDINATES)
    init.write_text('''gradle.projectsEvaluated {
    rootProject.tasks.register("resolveRelease50TextCompiler") {
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
             ':resolveRelease50TextCompiler', '--no-daemon', '--no-configuration-cache',
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


def check_integrity():
    verify_source()
    integrity_source = verify_integrity_source()
    gate('INTEGRITY_CHECK_REQUIRES_CAPTION_RECEIPT')
    caption = json.loads(TEXT_RECEIPT.read_text(encoding='utf-8'))
    assert caption['sourceSha'] == SOURCE and caption['appSourceTree'] == SOURCE_TREE
    assert caption['passed'] is True and caption['kotlinCompilerVersion'] == '2.2.20'
    assert type(caption['checkCount']) is int and caption['checkCount'] >= MIN_TEXT_ENTITY_CHECKS
    gate('NATIVE_INTEGRITY_MONITOR_BEHAVIOR')
    assert not INTEGRITY_CHECK.exists()
    INTEGRITY_CHECK.mkdir(mode=0o700)
    cache_home = Path(os.environ.get('GRADLE_USER_HOME') or Path.home()/'.gradle').resolve()
    java = shutil.which('java')
    assert java is not None
    # check-caption resolved the exact seven compiler jars. This step is offline
    # and receives no signing or Firebase secrets, and never calls Google Play.
    result = command([sys.executable, APP.parent/'validation/run-play-integrity-check.py',
                      '--java-path', java, '--native-root', APP.parent,
                      '--output-directory', INTEGRITY_CHECK/'output',
                      '--gradle-module-cache', cache_home/'caches/modules-2/files-2.1'], timeout=300)
    counts = re.findall(r'^PASS: ([0-9]+) actual Play Integrity policy, asynchronous observation, and auth snapshot checks; no network calls$', result, re.MULTILINE)
    assert len(counts) == 1 and int(counts[0]) >= MIN_INTEGRITY_CHECKS
    verify_source()
    assert verify_integrity_source() == integrity_source
    receipt = {'sourceSha': SOURCE, 'appSourceTree': SOURCE_TREE, 'passed': True,
               'checkCount': int(counts[0]), 'kotlinCompilerVersion': '2.2.20',
               'checksUsedActualKotlinSources': True, 'authSnapshotExtractedFromProductionSource': True,
               'offlineChecksOnly': True, **integrity_source}
    with INTEGRITY_RECEIPT.open('x', encoding='utf-8') as stream:
        json.dump(receipt, stream, indent=2); stream.write('\n')
    print('NATIVE_INTEGRITY_MONITOR_CHECKS_PASS_COUNT_'+counts[0])


def check_video():
    verify_source()
    media_source = verify_stream_stories_source()
    gate('VIDEO_COMPILER_REQUIRES_CAPTION_RECEIPT')
    caption = json.loads(TEXT_RECEIPT.read_text(encoding='utf-8'))
    assert caption['sourceSha'] == SOURCE and caption['appSourceTree'] == SOURCE_TREE
    assert caption['passed'] is True and caption['kotlinCompilerVersion'] == '2.2.20'
    assert type(caption['checkCount']) is int and caption['checkCount'] >= MIN_TEXT_ENTITY_CHECKS
    gate('VIDEO_CHECK_OUTPUT_DIRECTORY')
    assert not VIDEO_CHECK.exists()
    VIDEO_CHECK.mkdir(mode=0o700)
    # Clean runners may resolve newer transitive annotations/Guava versions in
    # the app build. Cache the portable runner's exact API artifacts explicitly.
    gate('VIDEO_API_DEPENDENCY_RESOLUTION')
    init = VIDEO_CHECK/'resolve-video-api.gradle'
    coordinates = ',\n                '.join(json.dumps(c) for c in VIDEO_API_COORDINATES)
    init.write_text('''gradle.projectsEvaluated {
    rootProject.tasks.register("resolveRelease50VideoApis") {
        doLast {
            def requested = [
                ''' + coordinates + '''
            ].collect { rootProject.dependencies.create(it) }
            def pinned = rootProject.configurations.detachedConfiguration(*requested)
            pinned.transitive = false
            // A detached root configuration has no Java/Android consumer attributes.
            // Guava publishes Android and JRE API/runtime variants of this version.
            pinned.attributes {
                attribute(org.gradle.api.attributes.Usage.USAGE_ATTRIBUTE,
                    rootProject.objects.named(org.gradle.api.attributes.Usage, "java-runtime"))
                attribute(org.gradle.api.attributes.java.TargetJvmEnvironment.TARGET_JVM_ENVIRONMENT_ATTRIBUTE,
                    rootProject.objects.named(org.gradle.api.attributes.java.TargetJvmEnvironment, "android"))
            }
            def files = pinned.resolve()
            def expected = ["media3-common-1.11.1.aar", "media3-datasource-1.11.1.aar",
                "annotation-experimental-1.4.1.aar", "guava-33.3.1-android.jar"] as Set
            if (files.size() != 4 || files.collect { it.name }.toSet() != expected ||
                    files.any { !it.isFile() || it.length() <= 0 }) {
                throw new GradleException("Expected the exact four pinned video API artifacts")
            }
        }
    }
}
''', encoding='utf-8')
    command(['gradle', '--project-dir', APP.parent, '--init-script', init,
             ':resolveRelease50VideoApis', '--no-daemon', '--no-configuration-cache',
             '--max-workers=1', '--no-parallel',
             '-Dorg.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8'], timeout=600,
             failure_context='VIDEO_API_DEPENDENCY_RESOLUTION')
    gate('VIDEO_RUNTIME_TOOLCHAIN')
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
    android_jar = sdk/'platforms/android-36/android.jar'
    assert android_jar.is_file()
    java = shutil.which('java')
    assert java is not None
    cache_home = Path(os.environ.get('GRADLE_USER_HOME') or Path.home()/'.gradle').resolve()
    gate('ACTUAL_NATIVE_VIDEO_TRANSPORT_BEHAVIOR')
    result = command([sys.executable, APP.parent/'validation/run-video-http-check.py',
                      '--java-path', java, '--android-jar', android_jar,
                      '--output-directory', VIDEO_CHECK/'output',
                      '--gradle-module-cache', cache_home/'caches/modules-2/files-2.1'], timeout=300,
                      failure_context='ACTUAL_NATIVE_VIDEO_TRANSPORT_BEHAVIOR')
    gate('VIDEO_TRANSPORT_RESULT_COUNT')
    counts = re.findall(r'^PASS ([0-9]+) native video transport checks .*$', result, re.MULTILINE)
    assert len(counts) == 1 and int(counts[0]) >= MIN_VIDEO_TRANSPORT_CHECKS
    verify_source()
    assert verify_stream_stories_source() == media_source
    receipt = {'sourceSha': SOURCE, 'appSourceTree': SOURCE_TREE, 'repositoryTree': REPOSITORY_TREE, 'appMainSourceTree': MAIN_SOURCE_TREE,
               'passed': True, 'checkCount': int(counts[0]), 'kotlinCompilerVersion': '2.2.20',
               'media3Version': '1.11.1', 'androidApiJar': 36,
               'checksUsedActualKotlinSources': True, 'syntheticHttpAndUriFixturesOnly': True,
               'productionNetworkCallsPerformed': False, 'devicePlaybackValidationPerformed': False,
               'videoAdapterSourceSha256': sha((APP/'src/main/java/com/sautilink/nativeapp/ui/components/NativeVideoDataSource.kt').read_bytes()),
               'portableRunnerSha256': sha((APP.parent/'validation/run-video-http-check.py').read_bytes()),
               **media_source}
    gate('VIDEO_TRANSPORT_RECEIPT')
    with VIDEO_RECEIPT.open('x', encoding='utf-8') as stream:
        json.dump(receipt, stream, indent=2); stream.write('\n')
    print('NATIVE_VIDEO_TRANSPORT_CHECKS_PASS_COUNT_'+counts[0])



def verify_unit_suite(suite_name, expected):
    """Require every reviewed test, with no skip, failure, duplicate or missing report."""
    report = APP/'build/test-results/testPreviewDebugUnitTest'/('TEST-'+suite_name+'.xml')
    suite = ET.parse(report).getroot()
    assert suite.tag == 'testsuite' and suite.get('name') == suite_name
    assert suite.get('tests') == str(len(expected))
    assert all(suite.get(key) == '0' for key in ('failures', 'errors', 'skipped'))
    cases = suite.findall('testcase')
    assert len(cases) == len(expected) and {case.get('name') for case in cases} == expected
    assert all(case.get('classname') == suite_name and
               all(case.find(tag) is None for tag in ('failure', 'error', 'skipped')) for case in cases)
    return {'sourceSha': SOURCE, 'appSourceTree': SOURCE_TREE, 'passed': True,
            'checkCount': len(expected), 'suite': suite_name, 'testCases': sorted(expected),
            'reportSha256': sha(report.read_bytes()), 'productionNetworkCallsPerformed': False}


def verify_realtime_unit_tests():
    gate('NATIVE_REALTIME_EIGHT_UNIT_TESTS')
    expected = {
        'server1008GetsAcknowledgedWithoutWaitingForThe25SecondPingFailure',
        'server1008FinishesLocallyEvenWhenServerKeepsTcpOpenAfterTheCloseAcknowledgement',
        'obsoleteAttemptCannotOpenDeliverMessagesOrDisconnectItsReplacement',
        'obsoleteClosingStillAcknowledgesTransportWithoutClearingCurrentStateOrEchoingReason',
        'rejectedCloseCodeCancelsTheTransportAndClearsCurrentState',
        'currentCloseAndFailureClearStateButInactiveCallbacksAreIgnored',
        'stalePredicateCannotMutateReplacementAndRetirementInvalidatesBackoffCallbacks',
        'callbackMutationAndReplacementAreSerializedAcrossThreads',
    }
    return {**verify_unit_suite('com.sautilink.nativeapp.feature.inbox.NativeDmSocketListenerTest', expected),
            'actualProductionAdapterTested': True, 'loopbackCloseHandshakeTested': True,
            'serverHeldTcpOpenAfterCloseAcknowledgementTested': True}


def verify_room_invitation_unit_tests():
    gate('NATIVE_ROOM_INVITATION_EIGHT_UNIT_TESTS')
    expected = {
        'pendingInvitation_neverDeletesOrPosts_evenWhenItHasAnEndedMarker',
        'acceptedActiveOrLegacyInvitation_cannotBeReusedOrDeleted',
        'endedAcceptedReceipt_requiresExactOptimisticDeleteBeforeFreshPendingInvitation',
        'existingMembership_blocksAllInvitationLookupAndWrites_evenWithHistoricalEndedReceipt',
        'malformedOrIncompleteEndedReceipt_neverAuthorizesDeletion',
        'staleOrRlsDeniedEndedReceipt_neverContinuesToPost',
        'declinedInvitation_keepsItsExistingDeleteThenPostBehavior',
        'firstInvitation_postsOnce_andUnconfirmedPostStillFails',
    }
    return {**verify_unit_suite('com.sautilink.nativeapp.feature.rooms.NativeRoomInvitationProtocolTest', expected),
            'actualProductionInvitationSequenceTested': True, 'syntheticRestResponsesOnly': True,
            'jsonReferenceImplementation': 'org.json:json:20260814'}


def verify_native_media_unit_tests():
    gate('NATIVE_RELEASE50_EXACT_REVIEWED_JVM_TEST_SUITES')
    expected_suites = reviewed_jvm_suites()
    reports = APP/'build/test-results/testPreviewDebugUnitTest'
    assert {p.name for p in reports.glob('TEST-*.xml')} == {'TEST-'+name+'.xml' for name in expected_suites}
    suites = [verify_unit_suite(name, expected) for name, expected in sorted(expected_suites.items())]
    return {'sourceSha': SOURCE, 'appSourceTree': SOURCE_TREE, 'passed': True,
            'reviewedJvmManifestSha256': JVM_MANIFEST_SHA256,
            'checkCount': sum(suite['checkCount'] for suite in suites), 'suiteCount': len(suites),
            'suites': suites, 'productionNetworkCallsPerformed': False}


def seal_aab():
    verify_source()
    integrity_source = verify_integrity_source()
    media_source = verify_stream_stories_source()
    gate('CAPTION_CHECK_RECEIPT')
    caption = json.loads(TEXT_RECEIPT.read_text(encoding='utf-8'))
    assert caption['sourceSha'] == SOURCE and caption['appSourceTree'] == SOURCE_TREE
    assert caption['passed'] is True and caption['kotlinCompilerVersion'] == '2.2.20'
    assert type(caption['checkCount']) is int and caption['checkCount'] >= MIN_TEXT_ENTITY_CHECKS
    gate('INTEGRITY_CHECK_RECEIPT')
    integrity = json.loads(INTEGRITY_RECEIPT.read_text(encoding='utf-8'))
    assert integrity['sourceSha'] == SOURCE and integrity['appSourceTree'] == SOURCE_TREE
    assert integrity['passed'] is True and integrity['kotlinCompilerVersion'] == '2.2.20'
    assert type(integrity['checkCount']) is int and integrity['checkCount'] >= MIN_INTEGRITY_CHECKS
    assert integrity['checksUsedActualKotlinSources'] is True
    assert integrity['authSnapshotExtractedFromProductionSource'] is True and integrity['offlineChecksOnly'] is True
    assert all(type(integrity[name]) is type(value) and integrity[name] == value
               for name, value in integrity_source.items())
    gate('VIDEO_TRANSPORT_CHECK_RECEIPT')
    video = json.loads(VIDEO_RECEIPT.read_text(encoding='utf-8'))
    assert video['sourceSha'] == SOURCE and video['appSourceTree'] == SOURCE_TREE and video['repositoryTree'] == REPOSITORY_TREE
    assert video['appMainSourceTree'] == MAIN_SOURCE_TREE
    assert video['passed'] is True and video['kotlinCompilerVersion'] == '2.2.20' and video['media3Version'] == '1.11.1'
    assert type(video['checkCount']) is int and video['checkCount'] >= MIN_VIDEO_TRANSPORT_CHECKS
    assert video['checksUsedActualKotlinSources'] is True and video['syntheticHttpAndUriFixturesOnly'] is True
    assert video['productionNetworkCallsPerformed'] is False and video['devicePlaybackValidationPerformed'] is False
    assert video['videoAdapterSourceSha256'] == sha((APP/'src/main/java/com/sautilink/nativeapp/ui/components/NativeVideoDataSource.kt').read_bytes())
    assert video['portableRunnerSha256'] == sha((APP.parent/'validation/run-video-http-check.py').read_bytes())
    assert all(type(video[name]) is type(value) and video[name] == value for name, value in media_source.items())
    assert not ASSET.exists()
    realtime_unit_tests = verify_realtime_unit_tests()
    room_invitation_unit_tests = verify_room_invitation_unit_tests()
    native_media_unit_tests = verify_native_media_unit_tests()
    gate('NATIVE_64BIT_ELF_16KB_ALIGNMENT_AND_PUBLIC_PAYLOAD')
    with safe_zip(AAB) as archive:
        native_libraries = verify_native_libraries(archive)
        packaged_runtime = verify_packaged_runtime(archive)
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
    write_json('native-video-transport.json', video)
    write_json('clean-aab.json', {'status': 'PASS_SIGNED_CLEAN_ARTIFACT', 'sourceSha': SOURCE,
               'appSourceTree': SOURCE_TREE, 'repositoryTree': REPOSITORY_TREE, 'appMainSourceTree': MAIN_SOURCE_TREE,
               'package': 'com.sautilink.app', 'versionCode': 50, 'versionName': '1.1.5',
               'minSdk': 26, 'targetSdk': 36, 'debuggable': False,
               'sha256': sha(AAB.read_bytes()), 'uploadCertificateSha256': CERT,
               'bundletoolValidate': True, 'registrationAssetPresent': False,
               'native64BitElf16KbAlignment': native_libraries,
               'nativePackagedRuntime': packaged_runtime,
               'nativeTextEntityChecks': caption,
               'nativeRealtimeUnitTests': realtime_unit_tests,
               'nativeRoomInvitationUnitTests': room_invitation_unit_tests,
               'nativeMediaUnitTests': native_media_unit_tests,
               'nativeVideoTransportChecks': video, **media_source,
               'nativePlayIntegrityChecks': integrity, **integrity_source,
               'lintFatalOrErrors': 0, 'lintWarnings': sum(i.get('severity') == 'Warning' for i in issues),
               'lintInformational': sum(i.get('severity') not in ('Error','Fatal','Warning') for i in issues),
               **signature, 'playConsoleValidationPerformed': False, 'device16KbValidationPerformed': False})


def public_artifact_provenance(bundle, aab_sha256):
    assert all(re.fullmatch(r'[a-f0-9]{40}', value) for value in (SOURCE, SOURCE_TREE, REPOSITORY_TREE, MAIN_SOURCE_TREE))
    assert re.fullmatch(r'[a-f0-9]{64}', aab_sha256) and bundle['sha256'] == aab_sha256
    assert bundle['sourceSha'] == SOURCE and bundle['package'] == 'com.sautilink.app'
    assert bundle['versionCode'] == 50 and bundle['versionName'] == '1.1.5'
    public = {'sourceSha': SOURCE, 'appSourceTree': SOURCE_TREE, 'repositoryTree': REPOSITORY_TREE, 'appMainSourceTree': MAIN_SOURCE_TREE,
              'package': 'com.sautilink.app', 'versionCode': 50, 'versionName': '1.1.5',
              'aabSha256': aab_sha256}
    value = json.dumps(public, sort_keys=True, separators=(',', ':'))
    assert len(value.encode('ascii')) <= 1024
    return 'PLAY_CANDIDATE_PUBLIC_PROVENANCE_'+value


def seal_outputs():
    verify_source()
    integrity_source = verify_integrity_source()
    media_source = verify_stream_stories_source()
    gate('OUTPUT_METADATA_AND_BEHAVIOR_RECEIPTS')
    expected = {'existing-upload-certificate.pem', 'source-and-signer.json', 'clean-aab.json',
                'sautilink-production-clean.aab', 'lint-results-productionRelease.xml', 'native-video-transport.json'}
    assert {p.name for p in OUT.iterdir()} == expected
    source = json.loads((OUT/'source-and-signer.json').read_text(encoding='utf-8'))
    bundle = json.loads((OUT/'clean-aab.json').read_text(encoding='utf-8'))
    assert source['sourceSha'] == SOURCE and source['appSourceTree'] == SOURCE_TREE
    assert source['repositoryTree'] == REPOSITORY_TREE and source['appMainSourceTree'] == MAIN_SOURCE_TREE
    assert source['uploadCertificateSha256'] == CERT and source['firebaseConfigSha256'] == FIREBASE_SHA
    assert source['productionFirebaseClientExactlyOne'] is True and source['previewFirebaseClientExactlyOne'] is True
    assert bundle['sourceSha'] == SOURCE and bundle['versionCode'] == 50 and bundle['versionName'] == '1.1.5'
    assert bundle['appSourceTree'] == SOURCE_TREE and bundle['repositoryTree'] == REPOSITORY_TREE
    assert bundle['appMainSourceTree'] == MAIN_SOURCE_TREE
    assert bundle['sha256'] == sha((OUT/'sautilink-production-clean.aab').read_bytes())
    with safe_zip(OUT/'sautilink-production-clean.aab') as archive:
        assert bundle['native64BitElf16KbAlignment'] == verify_native_libraries(archive)
        assert bundle['nativePackagedRuntime'] == verify_packaged_runtime(archive)
    assert bundle['nativeRealtimeUnitTests'] == verify_realtime_unit_tests()
    assert bundle['nativeRoomInvitationUnitTests'] == verify_room_invitation_unit_tests()
    assert bundle['nativeMediaUnitTests'] == verify_native_media_unit_tests()
    assert bundle['nativeVideoTransportChecks'] == json.loads(VIDEO_RECEIPT.read_text(encoding='utf-8'))
    assert bundle['nativeVideoTransportChecks'] == json.loads((OUT/'native-video-transport.json').read_text(encoding='utf-8'))
    assert bundle['nativeTextEntityChecks'] == json.loads(TEXT_RECEIPT.read_text(encoding='utf-8'))
    assert bundle['nativePlayIntegrityChecks'] == json.loads(INTEGRITY_RECEIPT.read_text(encoding='utf-8'))
    for metadata in (source, bundle):
        assert all(type(metadata[name]) is type(value) and metadata[name] == value
                   for name, value in integrity_source.items())
        assert all(type(metadata[name]) is type(value) and metadata[name] == value
                   for name, value in media_source.items())
    with (OUT/'SHA256SUMS').open('x', encoding='ascii') as stream:
        for name in sorted(expected): stream.write(sha((OUT/name).read_bytes())+'  '+name+'\n')
    gate('PUBLIC_SEALED_ARTIFACT_PROVENANCE')
    assert {p.name for p in OUT.iterdir()} == expected | {'SHA256SUMS'}
    print(public_artifact_provenance(bundle, sha((OUT/'sautilink-production-clean.aab').read_bytes())))


def cleanup():
    for path in (KEYSTORE, TOOL, APP/'google-services.json', ASSET):
        if path.is_file(): path.unlink()
    if TEXT_CHECK.is_dir(): shutil.rmtree(TEXT_CHECK)
    if INTEGRITY_CHECK.is_dir(): shutil.rmtree(INTEGRITY_CHECK)
    if VIDEO_CHECK.is_dir(): shutil.rmtree(VIDEO_CHECK)


if __name__ == '__main__':
    try:
        actions = {'prepare': prepare, 'check-caption': check_caption, 'check-integrity': check_integrity,
                   'check-video': check_video, 'seal-aab': seal_aab,
                   'seal-outputs': seal_outputs, 'cleanup': cleanup}
        assert len(sys.argv) == 2 and sys.argv[1] in actions
        gate('ACTION_'+sys.argv[1].upper().replace('-', '_'))
        actions[sys.argv[1]]()
        print('PLAY_CANDIDATE_'+sys.argv[1].upper().replace('-', '_')+'_PASS')
    except Exception:
        # Command output/errors may contain provider/config/keystore material; never echo them.
        print('::error::PLAY_CANDIDATE_CHECK_FAILED_GATE_'+CHECK_GATE, file=sys.stderr)
        sys.exit(1)
