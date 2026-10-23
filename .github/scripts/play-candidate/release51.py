"""Owner-requested Stream, Stories and native feed experience release 51 AAB. Builds only an immutable reviewed source; performs no backend deployment or Google Play publishing."""
from pathlib import Path
import base64, hashlib, json, os, re, shutil, struct, subprocess, sys, urllib.request, zipfile
import xml.etree.ElementTree as ET

# Immutable source pins for the reviewed Stream, Stories and feed experience 1.1.6 (51) candidate.
# Keep SOURCE identical to the candidate checkout ref in native-stream-stories-release51.yml.
SOURCE = 'e371b25e043db516ae0becbd25478036836f1d3b'
SOURCE_TREE = 'c653e2fcec294be78b13169ee3f2279a4be6b5ee'
REPOSITORY_TREE = '000ed38387d10c945c2cd05cf80e9a8007d7d0ef'
MAIN_SOURCE_TREE = '69fc83491ad5d575e31e32bb6b78bff55428ad5a'
JVM_MANIFEST_SHA256 = '4ac1f57231af0b439b79268b9be1ec17c5f0fe078e82ed158a22145b7b51c535'
CERT = '31c773a7229a563d92f7047a56735ad7b02027d27a6e020d8923dd5418f4b50f'
FIREBASE_SHA = 'be30a77f6be106c97b59ecdc6e7cc61100e0d9fd354ac883357e253fb69e6cae'
BUNDLETOOL_SHA = 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'
ANDROID = '{http://schemas.android.com/apk/res/android}'
ROOT = Path(os.environ.get('GITHUB_WORKSPACE', '.')).resolve()
TEMP = Path(os.environ.get('RUNNER_TEMP', '.')).resolve()
APP = ROOT / 'candidate/native-android/app'
OUT = TEMP / 'sautilink-release51-public'
KEYSTORE = TEMP / 'sautilink-play-release51-upload.jks'
TOOL = TEMP / 'sautilink-bundletool-1.18.3.jar'
TEXT_CHECK = TEMP / 'sautilink-release51-text-check'
TEXT_RECEIPT = TEXT_CHECK / 'checks.json'
INTEGRITY_CHECK = TEMP / 'sautilink-release51-integrity-check'
INTEGRITY_RECEIPT = INTEGRITY_CHECK / 'checks.json'
VIDEO_CHECK = TEMP / 'sautilink-release51-video-check'
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

NATIVE_MEDIA_UNIT_SUITES = {'com.sautilink.nativeapp.feature.auth.AuthRequestDeadlineTest': {'explicitJobCancellationRemainsCancellation_andCleansUp',
                                                                  'outerDeadlineRemainsCancellation_andNeverBecomesTransportFailure',
                                                                  'ownDeadlineBecomesSocketTimeout_andLeavesCallerActive',
                                                                  'successAndOrdinaryTransportFailurePassThroughWithoutRetry'},
 'com.sautilink.nativeapp.feature.dashboard.CreatorContentMediaTest': {'ForeignRowsAndUnsupportedMalformedMediaCannotBecomeDashboardThumbnails',
                                                                       'realFirstAttachedMediaIsSelectedWithoutDependingOnResponseOrder'},
 'com.sautilink.nativeapp.feature.explore.DiscoverTrendingPresentationTest': {'discoverKeepsTheExistingRankOrderAndShowsOnlyFiveDistinctPosts',
                                                                              'displayedIdentityAndCountsComeFromTheRankedPostWithoutInventedFallbackRows'},
 'com.sautilink.nativeapp.feature.home.AuthorizedImagePreviewPolicyTest': {'absoluteUrls_fragments_ambiguousWidths_andInvalidMedia_areRejected',
                                                                           'accountSwitchErasesPreviews_andOldCompletionsCannotPolluteNewSession',
                                                                           'alreadySmallRequests_andVideoPosters_doNotDoubleDownload',
                                                                           'boundedMemoryEvictsLeastRecentlyUsed_andOversizedImagesAreNotStored',
                                                                           'postPhotoUsesExisting480Width_andKeepsVersionEncoding',
                                                                           'previewExpiryDoesNotExtendOnRead_andClockRollbackFailsClosed',
                                                                           'roomCoverUses480_andPreservesImmutableRevision',
                                                                           'sessionTokenRefreshAndBackendSwitchClearOldPreviews',
                                                                           'signOutCancelsCacheOwnership_evenWhenSameAccountSignsInAgain',
                                                                           'unsupportedProtectedEndpoints_neverInventPreviewRoutes'},
 'com.sautilink.nativeapp.feature.home.AuthorizedImageRequestTest': {'authEnvironmentRecoveryRequiresTransientStatus_andNeverBypassesDeniedOrMissingSessions',
                                                                     'authMissingAndRedirectStatusesNeverRetry',
                                                                     'cancellingDuringBackoffNeverStartsAReplacementCall',
                                                                     'chunkedResponsesCannotBypassTheByteLimit',
                                                                     'declaredOversizedNonImageAndDeniedResponsesFailBeforeDecoding',
                                                                     'invalidBodyAndOversizeNeverRetry',
                                                                     'longOrOverflowingRetryAfterDoesNotCreateAnEarlyRequest',
                                                                     'lostAccountEligibilityDuringBackoffStopsBeforeRetry',
                                                                     'obsoleteScopeAndNonGetRequestsNeverStartImageTransport',
                                                                     'recycledCellCancelsSocket_andDisposesAnyLateResponseWithoutReading',
                                                                     'repeatedTransientFailureStopsAtTwoAttempts',
                                                                     'retryAfterSecondsAndHttpDatesAreHonouredWithinBudget',
                                                                     'transientHttpStatusesRetryOnce_andCloseEveryFailedBody',
                                                                     'transientNetworkFailureRetriesOnlyOnceThenReturnsImageBytes',
                                                                     'validAuthenticatedImageBodyIsReturnedAndClosed',
                                                                     'wrappedAuthTransportFailureAllowsEnvironmentRecovery_withoutAutomaticRequestRetry'},
 'com.sautilink.nativeapp.feature.home.FeedFreshnessTest': {'accountTabAndRefreshChangesRejectLateHeadAndPageCompletions',
                                                            'explicitRefreshCannotBeOverwrittenByAnOlderFirstPageCacheWrite',
                                                            'followFeedbackIsTemporaryAndNeverAddsAFeedUnfollowControl',
                                                            'initialPointersAndRankChangesDoNotInterruptReading',
                                                            'malformedOrOversizedHeadNeverBecomesAFakeNewPost',
                                                            'newerPostNoticeSurvivesRemovalsUntilASuccessfulRefresh',
                                                            'quietPollingHonorsServerCooldownRatherThanRetryingImmediately',
                                                            'realHeadProjectionsParseWithoutLoadingContent',
                                                            'timestampTiesAndPreviouslyEmptyFeedDoNotMissNewIds'},
 'com.sautilink.nativeapp.feature.home.FeedReturnPresentationTest': {'emptyDefaultsDoNotPretendThatAReturnSnapshotWasRestored',
                                                                     'headRevalidationUpdatesArtworkWithoutReplacingLoadedTailOrMovingReader',
                                                                     'leavingDuringAnUnacknowledgedWriteForcesItsStateToBeReadAgain'},
 'com.sautilink.nativeapp.feature.home.FeedVideoMetadataWarmupTest': {'aNewMountedScopeHasItsOwnOneShotButTheOldScopeCannotReplayIt',
                                                                      'actualVisibleAutoplayPageCanReadMetadataBeforeTheExistingPlayThreshold',
                                                                      'autoplayOffAndExplicitPauseDoNotCreateSpeculativeReads',
                                                                      'denialMissingSessionAndUnavailableAdaptivePathCannotBeRetriedByWarmupHandoff',
                                                                      'failedAbsentOrStaleGrantCanRecoverWithoutExtendingItsAuthorization',
                                                                      'failedPreIntentFallbackGetsOneAutoplayRecoveryWithoutPreparingThatFallback',
                                                                      'firstIntentConsumesAnInflightWarmupAndNeverRestartsItsLaterFailure',
                                                                      'foreignOwnerOrMediaStateIsNotMutatedByTheNewIntent',
                                                                      'healthyWarmGrantAndFailedRefreshOfAStillUsableGrantNeverRetryAtIntent',
                                                                      'manualFirstIntentLeavesExistingExplicitRetryBehaviorInCharge',
                                                                      'metadataWarmupRequiresSessionForegroundCurrentPageAndCanonicalPublishedMedia',
                                                                      'successfulMp4ProcessingDescriptorIsKeptWithoutAnAutomaticRetry'},
 'com.sautilink.nativeapp.feature.home.FollowReadRecoveryTest': {'aConfirmedFollowDuringReadRecoveryCannotBeOverwrittenByLateGet',
                                                                 'accountChangeDuringBackoffPreventsAnotherGet',
                                                                 'cancellationDuringBackoffPreventsAnotherGet',
                                                                 'cancelledFeedCancelsSocket_andClosesUnreadLateBody',
                                                                 'denialMissingAndRedirectStatusesNeverRetryOrInventFollowState',
                                                                 'invalidOrOversizedJsonIsNotRetried_andChunkedBytesRemainBounded',
                                                                 'lateResponseFromPreviousAccountIsDiscarded',
                                                                 'malformedOrCrossBatchRowsStayUnknown_insteadOfBecomingFalse',
                                                                 'mutationCallsCannotEnterTheReadRetryBoundary',
                                                                 'oneTransientGetFailureRetriesThenReturnsOnlySuccessfulResponseBytes',
                                                                 'persistentNetworkFailureStopsAfterTwoAttempts',
                                                                 'retryAfterAndTypedCausesRespectCooldownAndAuthorization',
                                                                 'transientHttpFailuresRetryOnlyOnce_andEveryResponseCloses'},
 'com.sautilink.nativeapp.feature.home.PostActionFeedCacheTest': {'actionAcknowledgementCannotInvalidateAnotherAccountOrBackend',
                                                                  'confirmedActionRetainsRowsButRejectsOldFirstPageWritesInEveryMode'},
 'com.sautilink.nativeapp.feature.home.PublishedVideoPlaybackPolicyTest': {'pendingSubmissionsDraftsAndUnrelatedPathsCannotRequestStreamMetadata',
                                                                           'publishedVideoAdaptationDoesNotDependOnTheSurfaceLoadingChrome'},
 'com.sautilink.nativeapp.feature.inbox.InboxReturnPresentationTest': {'freshConversationStartsAtTailButReturnKeepsItsHistoryAnchor',
                                                                       'logoutAndBackgroundCannotStartEitherInboxReader',
                                                                       'readingHistoryDoesNotJumpForIncomingActivity',
                                                                       'searchResultsNeverForceTailScrolling',
                                                                       'selectedThreadDoesNotReloadHiddenInboxButForwardCanFetchItsMissingDestinations'},
 'com.sautilink.nativeapp.feature.inbox.NativeDmSocketListenerTest': {'callbackMutationAndReplacementAreSerializedAcrossThreads',
                                                                      'currentCloseAndFailureClearStateButInactiveCallbacksAreIgnored',
                                                                      'obsoleteAttemptCannotOpenDeliverMessagesOrDisconnectItsReplacement',
                                                                      'obsoleteClosingStillAcknowledgesTransportWithoutClearingCurrentStateOrEchoingReason',
                                                                      'rejectedCloseCodeCancelsTheTransportAndClearsCurrentState',
                                                                      'server1008FinishesLocallyEvenWhenServerKeepsTcpOpenAfterTheCloseAcknowledgement',
                                                                      'server1008GetsAcknowledgedWithoutWaitingForThe25SecondPingFailure',
                                                                      'stalePredicateCannotMutateReplacementAndRetirementInvalidatesBackoffCallbacks'},
 'com.sautilink.nativeapp.feature.posts.NativePostMediaBoundariesTest': {'laterTrimUsesUnchangedOriginalTimeline',
                                                                         'threeMinutePostAllowsLongerClipsButKeepsStoryOverrideStrict'},
 'com.sautilink.nativeapp.feature.posts.NativePostUploadPolicyTest': {'cancellationOrOwnerChangeStopsBeforeNextWriteAndClosesFile',
                                                                      'exactImageVideoAndDurationBoundariesAreEnforced',
                                                                      'maximumVideoHas32OrderedBoundedPartsAnd2MiBFinalPart',
                                                                      'pathOrIdChangesAndMalformedCountsCannotAcquireUploadAuthority',
                                                                      'rangeBodyWritesOnlyRequestedBytesAndKeepsTransportProgressMonotonic',
                                                                      'smallVideosAndImagesKeepTheirSinglePutPath',
                                                                      'uploadResponsesAreBoundedBeforeJsonParsing'},
 'com.sautilink.nativeapp.feature.profile.ProfileStoryRingStateTest': {'accountAndProfileSwitchesInvalidateOldAsyncResponsesImmediately',
                                                                       'authoritativeStateAndLateResponsesCannotSuppressAnotherAccountsOrProfilesInitialHint',
                                                                       'lateEmptyResponseCannotEraseNewerPublishedStoryPresence',
                                                                       'malformedExpiryAndExactDeadlineNeverLeaveAnActiveRing',
                                                                       'onlyResolvedSignedInProfileCanCreateLookupScope',
                                                                       'refreshKeepsValidatedRingDuringReadButConfirmedEmptyClearsIt',
                                                                       'reusedUsernameOrWrongAuthorCannotAttachAnotherMembersStoryToThisAvatar',
                                                                       'sharedHomePresenceOnlyHelpsUntilThisProfileHasAnAuthoritativeResponse'},
 'com.sautilink.nativeapp.feature.rooms.NativeRoomInvitationProtocolTest': {'acceptedActiveOrLegacyInvitation_cannotBeReusedOrDeleted',
                                                                            'declinedInvitation_keepsItsExistingDeleteThenPostBehavior',
                                                                            'endedAcceptedReceipt_requiresExactOptimisticDeleteBeforeFreshPendingInvitation',
                                                                            'existingMembership_blocksAllInvitationLookupAndWrites_evenWithHistoricalEndedReceipt',
                                                                            'firstInvitation_postsOnce_andUnconfirmedPostStillFails',
                                                                            'malformedOrIncompleteEndedReceipt_neverAuthorizesDeletion',
                                                                            'pendingInvitation_neverDeletesOrPosts_evenWhenItHasAnEndedMarker',
                                                                            'staleOrRlsDeniedEndedReceipt_neverContinuesToPost'},
 'com.sautilink.nativeapp.feature.stories.NativeStoryPolicyTest': {'applyingPhotoFilterPreservesFramingAndResetReturnsOriginalColors',
                                                                   'dailyQuotaBoundariesAndUnknownKindAreRejected',
                                                                   'expiredStoriesAndOwnStoriesNeverInflateUnreadBadge',
                                                                   'expiryIsExclusiveAndMalformedExpiryFailsClosed',
                                                                   'navigationStopsAtLastStoryAndPreviousNeverUnderflows',
                                                                   'progressNeverExceedsSegmentAndUnknownDurationStaysAtZero',
                                                                   'reactionsToggleOrReplaceWithoutImpossibleCombination',
                                                                   'storyTrimCapsActualExportSelectionAtThirtySeconds'},
 'com.sautilink.nativeapp.feature.stories.NativeStoryUploadDestinationTest': {'cloudflareOneTimeUploadOnlyAcceptsExactHttpsHostAndPost',
                                                                              'currentAndLegacyCloudflareOriginsShareStrictOpaquePathAndNoUrlExtras',
                                                                              'exactImageUploadDestinationRetainsBearerOnlyOnFirstParty'},
 'com.sautilink.nativeapp.feature.stories.NativeStoryUploadProgressTest': {'writingAllBytesCannotClaimProviderAcknowledgementOrReplayTheOneTimePost'},
 'com.sautilink.nativeapp.feature.stories.NativeStoryUploadRecoveryTest': {'aProvisionedOrUncertainUploadNeverCountsAsReceivedBytes',
                                                                           'acceptedOrReadyVideoIsNotUploadedAgainAndExpiredMediaCannotResume',
                                                                           'onlyFreshServerConfirmationMayRetryAnUnreceivedDirectTransfer'},
 'com.sautilink.nativeapp.feature.verification.VerificationApplicantPolicyTest': {'accountTypesUseOnlyTheServerApprovedWireValues',
                                                                                  'allEntityTypesRequireAnArticleEvenWhenSocialProfilesExist',
                                                                                  'individualsKeepSocialOrArticleEvidenceWithoutAnArticleMandate',
                                                                                  'malformedOrCredentialBearingLinksCannotCountAsRequiredEvidence',
                                                                                  'maximumFiveArticlesIsValidatedInsteadOfSilentlyTruncatingTheSubmission',
                                                                                  'socialLinksRequireHttpsWhileIndependentArticlesMayUseHttp'},
 'com.sautilink.nativeapp.feature.videos.NativeShortVideoDownloadPolicyTest': {'accountChangeDuringReadStopsBeforeWritingThatChunk',
                                                                               'cancelBetweenChunksDoesNotReadOrWriteAgain',
                                                                               'cleanupMatchesOnlyOurExactOldPendingDownload',
                                                                               'copyIsExactAndEachNetworkReadIsAtMost64KiB',
                                                                               'destinationIsOnlyAnExactFirstPartyMediaRoute',
                                                                               'lateAccountChangeAtEofPreventsCompletionAndFlush',
                                                                               'responseMustBeCompleteMp4WithBoundedSizeAndStrongVersion',
                                                                               'truncatedExtraAndNonMp4BodiesCannotComplete'},
 'com.sautilink.nativeapp.feature.videos.ShortsAuthorPoliciesTest': {'duplicateCandidateListsDoNotConsumeRanksAndBlockedMutedAuthorsAreExcluded',
                                                                     'followingAppearsOnlyAfterTheConfirmedMutationNotDuringTheRequest',
                                                                     'newSessionOrRefreshHidesAlreadyFollowedAuthorsAndNeverOffersUnfollow',
                                                                     'onlyAnActualTopTwentyPostRankCanBeDisplayed',
                                                                     'onlyTwentyValidServerCandidatesCanReceiveRankMetadata',
                                                                     'optionalRanksWaitForForegroundMotionAndHealthyBufferedRunway',
                                                                     'ownerAndRefreshGenerationBoundEveryAsyncRead',
                                                                     'rankingUsesExistingHomeWeightsAndPostIdentityRatherThanAuthorIdentity',
                                                                     'readFailureIsRetryableButAnUnconfirmedWriteNeverClaimsFollowing',
                                                                     'staleReadsAndActionResponsesCannotUndoAConfirmedNewerAction'},
 'com.sautilink.nativeapp.ui.components.NativePlaybackBootstrapTest': {'badOptionalInitDropsOnlyTheInitExtension_whileMasterAndChildRemainUsable',
                                                                       'countAndActualUtf8BytesAreBounded_andNeverAcceptSegmentPayloads',
                                                                       'exactCapabilityAndLiveGrantAreRequired_evenForInMemoryBytes',
                                                                       'exactRewrittenMasterAndChildAreConsumedOnce_withoutLosingAdaptiveMaster',
                                                                       'isoBoxValidationRejectsMediaFragmentsOverflowAndTrailingBytes',
                                                                       'malformedOptionalBundleIsIgnored_withoutTurningPlaybackIntoAnError',
                                                                       'onlyMapReferencedCodecInitializationCanBeConsumedOnce_withTheSameGrantGuards',
                                                                       'realGatewayRootRelativeUrisResolveOnlyWithinTheExactFirstPartyContent'},
 'com.sautilink.nativeapp.ui.components.NativePlaybackResumeReuseTest': {'actualManualRecoveryRetainsItsRetryTriggers',
                                                                         'authRenewalDeadlineCanRequireAnEarlierDescriptorThanCapabilityExpiry',
                                                                         'changedAccountRetryOrSourceDuringTheWaitCannotLaunchAStaleRefresh',
                                                                         'deniedFailedMp4AndNearExpirySourcesNeverDelayARecoveryRequest',
                                                                         'disablingTheMountedPlayerCancelsItsScheduledDescriptorRequest',
                                                                         'explicitRetryBypassesReuseEvenThoughTheOldSourceIsStillUsable',
                                                                         'healthyHlsAndMp4ManualResumeDoNotRetryOrChangeTheSource',
                                                                         'missingChangedOrBlankCurrentCredentialCannotReuseEvenWithTheSameOwner',
                                                                         'mountedReturnKeepsTheSameSourceUntilItsOriginalRefreshDeadline',
                                                                         'newMountedReadCannotReuseAnotherPlayersGrant',
                                                                         'repeatedViewportReturnsNeverExtendTheOriginalAuthorization',
                                                                         'wrongAccountContentOriginAndEndpointCannotReuseAnExistingSource'},
 'com.sautilink.nativeapp.ui.components.NativeShortsPreloadingTest': {'backgroundAndOfflineNeverSpeculate',
                                                                      'bufferingVisibleVideoOwnsNetwork',
                                                                      'currentHandoffRetainsItsPeriodEvenWhenNextSpeculationIsDisabled',
                                                                      'dataSaverOverridesFastConnection',
                                                                      'explicitCancellationAndCloseReleaseUnclaimedCurrentSamples',
                                                                      'explicitPauseAndAutoplayOffNeverSpeculate',
                                                                      'healthyUnmeteredPlaybackMayPrepareOneAdjacentSource',
                                                                      'invalidMeasurementsCannotEnableMeteredSpeculation',
                                                                      'manualQualityDoesNotDownloadAnUnmatchedAutoTrack',
                                                                      'memoryHeatAndBatteryPressureDisablePreparation',
                                                                      'meteredNeedsRecentMeasuredCapacity',
                                                                      'onlyAdjacentNextMayLoadAndOlderSourcesAreNotRetained'},
 'com.sautilink.nativeapp.ui.components.NativeStartupServerTimingTest': {'onlyFourFixedNumericServerMetricsAreExposedToTheOperator'},
 'com.sautilink.nativeapp.ui.components.NativeStoryPlaybackPrefetchTest': {'advancingHandsOffTheSameRead_butOlderThanCurrentAndNextIsEvicted',
                                                                           'denialNearExpiryAndMissingCredentialCannotBeWarmedIntoAPlayer',
                                                                           'freshSameOwnerStoryGrantSkipsOnlyTheRedundantMetadataRoundTrip'},
 'com.sautilink.nativeapp.ui.components.NativeStreamPlaybackPolicyTest': {'existingMediaFallbackCannotPointToAnotherVideoOrOrigin',
                                                                          'expiredAndUnexpectedlyLongGrantsAreRejected',
                                                                          'foreignCdnRedirectAndUnrelatedContentNeverReceiveAuthorization',
                                                                          'grantAllowsOnlyItsContentUntilExpiryAndClearRevokesIt',
                                                                          'longPlaybackRefreshesBeforeBothCapabilityAndAuthExpiry_withoutTreatingClaimsAsAuthorization',
                                                                          'malformedCapabilityEncodedPathAndExtraQueryAreRejected',
                                                                          'metadataRouteCannotBeAnAccountOrArbitraryWebUrl',
                                                                          'onlyVideoSegmentsEnterCacheAndManifestsAlwaysReauthorize',
                                                                          'readyHlsIsExplicitSameOriginAndHasBoundedExpiry',
                                                                          'registryRetainsOnlyFourLiveContentGrants',
                                                                          'storySourceIsBoundToStoryGatewayAndCannotUsePublishedMp4Fallback'},
 'com.sautilink.nativeapp.ui.components.NativeVideoReplayPolicyTest': {'accountAuthObjectAndExactCredentialAllSeparateReplayNamespaces',
                                                                       'onlyGenerationBoundPublishedOpaqueHlsIdentitiesEnterReplayPool'},
 'com.sautilink.nativeapp.ui.components.NativeVideoReplayProbeTest': {'disabledProbeDoesNoWorkAndThrowingDiagnosticSinkCannotBreakPlayback',
                                                                      'numericTagsCompareWithinRun_butNeverExposeInputAndChangeWithObserver'},
 'com.sautilink.nativeapp.ui.components.RecentVideoTransferObservationTest': {'aNewVideoCellCanReuseRecentActualTransferOnTheSameNetwork',
                                                                              'clockRollbackDiscardsTheOldMeasurement_andPreRollbackSamplesCannotRepopulateIt',
                                                                              'dataSaverAndMeteringOverrideRecentFastCapacityForTheNextVideo',
                                                                              'delayedTransferThatOverlapsNetworkHandoffIsNotAssignedToTheNewNetwork',
                                                                              'measurementExpiresAtThirtySeconds_andReadsNeverExtendItsLifetime',
                                                                              'networkHandoffForgetsOldCapacity_andReturningToWifiDoesNotResurrectIt',
                                                                              'newSubstantialTransferUpdatesTheCapacity_andTheNextCellUsesIt',
                                                                              'offlineUnvalidatedOrUnknownNetworksCannotRetainOrCreateAMeasurement',
                                                                              'startupAndConnectionSignalsNeverBecomeAnInitialBandwidthGuess',
                                                                              'tinyFastInvalidAndEmptySamplesCannotReplaceOrExtendAnActualMeasurement'},
 'com.sautilink.nativeapp.ui.components.VerificationBadgeCopyTest': {'blueProfileMessagesRemainUnchangedForOwnerAndOtherViewer',
                                                                     'orangeProfileDescribesReviewedAuthenticEntityWithoutStaffMembershipClaim'},
 'com.sautilink.nativeapp.ui.components.VideoPlaybackLabelsTest': {'autoLabelRequiresMeasuredDecodedQuality_manualChoiceRemainsExplicit',
                                                                   'timelineUsesMinutesAndHours_andNeverDisplaysNegativeUnsetTime'},
 'com.sautilink.nativeapp.ui.state.SessionScreenPresentationStoreTest': {'anonymousOwnerNeverRetainsPresentation',
                                                                         'boundsEvictLeastRecentlyReadAndRejectWrongSnapshotType',
                                                                         'destinationKeysSeparateMembersAndKeepEachPrimaryTabIndependent',
                                                                         'expiryAndMemoryTrimDoNotLeaveAnAuthorizationLikeFallback',
                                                                         'explicitInvalidationCannotBeUndoneByDisposedScreen',
                                                                         'nonnullableDefaultsPreserveMissHitAndInvalidationRevision',
                                                                         'optionalHostAccessPreservesNoopAndRevisionGuards',
                                                                         'ownerChangeAndCloseRejectLateWritesAndReads'}}


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
    assert len(re.findall(r'^\s*versionCode = 51\s*$', gradle, re.MULTILINE)) == 1
    assert len(re.findall(r'^\s*versionName = "1\.1\.6"\s*$', gradle, re.MULTILINE)) == 1
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
    # Resuming a still-mounted healthy player must retain its original grant and
    # URI, while account/content/token changes, Retry and original deadlines
    # continue through normal authorization. A new mount has no reusable read.
    for marker in ('internal suspend fun waitForNativePlaybackResume(',
                   'read.sourceAttempt != read.attempt',
                   'currentToken.isBlank() || read.bearer != currentToken',
                   'wait(duration)', 'read.source !== source',
                   'internal fun nativePlaybackNeedsRetry(',
                   'if (waitForNativePlaybackResume(state, account, mediaId, auth.mediaOrigin, metadataPath,',
                   'state.sourceAttempt = requestAttempt'):
        assert marker in resolver
    assert 'nativePlaybackNeedsRetry(playbackRead, System.currentTimeMillis(), player?.playerError != null)' in feed
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
    # Release51 introduces bounded bytes/presentation retention, never a
    # completed ACL/descriptor cache. Behavioral JVM/device checks remain needed.
    replay = (native/'ui/components/NativeVideoReplayPool.kt').read_text(encoding='utf-8')
    resources = (native/'ui/components/NativeVideoPlaybackResources.kt').read_text(encoding='utf-8')
    preload = (native/'ui/components/NativeShortsPreloading.kt').read_text(encoding='utf-8')
    warmup = (native/'feature/home/FeedVideoMetadataWarmup.kt').read_text(encoding='utf-8')
    presentation = (native/'ui/state/SessionScreenPresentationStore.kt').read_text(encoding='utf-8')
    app_host = (native/'NativeAuthenticatedAppHost.kt').read_text(encoding='utf-8')
    main = (native/'MainActivity.kt').read_text(encoding='utf-8')
    shorts_engine = (native/'feature/videos/ShortsPlaybackEngine.kt').read_text(encoding='utf-8')
    # These contracts protect session ownership and the real authorized engine
    # wiring after compiler-only extraction, rather than every helper's spelling.
    assert 'NativeAuthenticatedAppHost(' in main
    assert app_host.index('NativeVideoReplaySession(auth)') < app_host.index('SessionScreenReturnHost(auth') < app_host.index('overlayContent()')
    assert 'createShortsPlaybackEngine(' in shorts and 'engine?.close()' in shorts
    for marker in ('nativeVideoPlaybackResources(', 'authorizationToken = authorizationToken',
                   'auth.account?.id == accountId', 'preloading.close()', 'resources.close()'):
        assert marker in shorts_engine
    for marker in ('authOwner === other.authOwner', 'MessageDigest.isEqual',
                   'maxStores: Int = 3', '64L * 1024 * 1024', '120_000L',
                   'SystemClock::elapsedRealtime', 'it.references == 0',
                   'fun trimIdle(', 'Lifecycle.Event.ON_STOP', 'NativeVideoReplaySession'):
        assert marker in replay
    for marker in ('hlsGrants.cacheIdentity', 'replay.pool.acquire(replay.scope, identity)',
                   'cacheAllowed?.invoke() == false', 'cacheLease?.release?.invoke()',
                   'try { delegate?.close() } finally'):
        assert marker in resources
    for marker in ('DefaultPreloadManager.Builder', 'bufferedMs >= 6_000L',
                   'specifiedRangeLoaded(2_000L)', 'index == current + 1',
                   'PRELOAD_STATUS_TRACKS_SELECTED', 'ShortsPreloadTarget.RETAIN_CURRENT',
                   'items.size > 3', 'player.release()', 'manager.release()'):
        assert marker in preload
    for marker in ('feedVideoMetadataEligible', 'manualPaused', 'visibleFraction.isFinite()',
                   'read.loading', 'read.denied', 'nativePlaybackReusableDelay'):
        assert marker in warmup
    for marker in ('isCurrentOwner()', 'expectedRevision != revision',
                   'maxEntries: Int = 12', 'maxAgeMillis: Long = 5 * 60_000L',
                   'fun close()', 'accountId != null'):
        assert marker in presentation
    experience = verify_native_experience_source(native)
    return {**experience, 'mediaInfrastructure': 'authenticated-first-party-HLS-gateway-with-existing-MP4-fallback',
            'nativeHlsRuntimeIncluded': True, 'nativeStoriesRuntimeIncluded': True,
            'media3Version': '1.11.1', 'nativePlaybackUsesFirstPartyGateway': True,
            'nativeStoryVideoLimitSeconds': 30, 'nativeStoryDailyVideoLimit': 2,
            'nativeStoryDailyImageLimit': 4, 'nativeThinAccessibleVideoTimelineIncluded': True,
            'nativeOneUsePlaybackBootstrapIncluded': True, 'nativeBoundedNextStoryHandoffIncluded': True,
            'nativeBoundedCodecInitializationIncluded': True,
            'nativeSameMountedPlaybackResumeReuseIncluded': True,
            'nativeBoundedSessionHlsByteReplayIncluded': True,
            'nativeBoundedNextShortPreloadIncluded': True,
            'nativeMetadataOnlyVisibleWarmupIncluded': True,
            'nativeSessionPresentationReturnStateIncluded': True,
            'nativeProfileStoryRingOutsideSurfaceBorder': True,
            'cloudflareStreamActivationVerifiedByCi': False, 'backendDeploymentPerformed': False}


def kotlin_integer_constant(text, name):
    """Evaluate only a literal Kotlin integer/multiplication declaration.
    Never eval code, resolve mutable fields or accept an unreviewed alias.
    """
    import ast
    matches = re.findall(r'\bconst\s+val\s+'+re.escape(name)+r'\s*=\s*([^\n;]+)', text)
    assert len(matches) == 1, 'EXACT_NATIVE_CONSTANT_REQUIRED'
    expression = re.sub(r'(?<=\d)[lL]\b', '', matches[0].split('//', 1)[0].strip())
    def evaluate(node):
        if isinstance(node, ast.Constant):
            assert type(node.value) is int and 0 <= node.value <= 2**63-1
            return node.value
        assert isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult), 'LITERAL_CONSTANT_EXPRESSION_REQUIRED'
        result = evaluate(node.left) * evaluate(node.right)
        assert result <= 2**63-1
        return result
    return evaluate(ast.parse(expression, mode='eval').body)


def verify_post_download_manifest(root):
    app = root.find('application')
    assert app is not None
    expected = {'com.sautilink.nativeapp.feature.videos.NativeShortVideoDownloadService',
                '.feature.videos.NativeShortVideoDownloadService'}
    services = [node for node in app.findall('service') if node.get(ANDROID+'name') in expected]
    assert len(services) == 1, 'PRIVATE_DOWNLOAD_SERVICE_REQUIRED'
    service = services[0]
    assert service.get(ANDROID+'exported') == 'false', 'DOWNLOAD_SERVICE_MUST_NOT_BE_EXPORTED'
    assert service.get(ANDROID+'foregroundServiceType') == 'dataSync', 'DOWNLOAD_DATA_SYNC_FOREGROUND_REQUIRED'
    assert not service.findall('intent-filter'), 'DOWNLOAD_SERVICE_INTENT_FILTER_FORBIDDEN'
    permissions = {node.get(ANDROID+'name'): node for node in root.findall('uses-permission')}
    assert 'android.permission.FOREGROUND_SERVICE' in permissions
    assert 'android.permission.FOREGROUND_SERVICE_DATA_SYNC' in permissions
    assert 'android.permission.MANAGE_EXTERNAL_STORAGE' not in permissions
    assert 'android.permission.WRITE_EXTERNAL_STORAGE' in permissions
    assert permissions['android.permission.WRITE_EXTERNAL_STORAGE'].get(ANDROID+'maxSdkVersion') == '28'


def verify_native_experience_source(native):
    """Independent numeric boundaries and private service wiring, in addition to
    exact JVM behavior, immutable trees, actual DEX and hardware evidence.
    This source contract is not a live upload/download or device attestation.
    """
    def source(relative): return (native/relative).read_text(encoding='utf-8')
    limits = source('feature/posts/NativePostMediaPolicy.kt')
    expected = {'MAX_ATTACHMENTS': 10, 'MAX_IMAGE_BYTES': 5*1024*1024,
                'MAX_VIDEO_BYTES': 250*1024*1024, 'MAX_VIDEO_MS': 180_000}
    assert {name: kotlin_integer_constant(limits, name) for name in expected} == expected, 'POST_MEDIA_BOUNDARY_DRIFT'
    upload = source('feature/posts/NativePostUploadPolicy.kt')
    for alias, field in (('IMAGE_MAX_BYTES','MAX_IMAGE_BYTES'),('VIDEO_MAX_BYTES','MAX_VIDEO_BYTES'),
                         ('VIDEO_MAX_DURATION_MS','MAX_VIDEO_MS')):
        assert re.search(r'const\s+val\s+'+alias+r'\s*=\s*NativePostMediaPolicy\.'+field+r'\b', upload)
    assert kotlin_integer_constant(upload, 'PART_BYTES') == 8*1024*1024
    assert kotlin_integer_constant(upload, 'IO_BUFFER_BYTES') == 64*1024
    for marker in ('RandomAccessFile(file, "r")', 'input.seek(offset)', 'while (sent < length)',
                   'checkRequestOwner()', 'ByteArray(NativePostUploadPolicy.IO_BUFFER_BYTES)',
                   'part in 1..partCount', 'chunk.optString("part_url") == "$upload?part={part}"',
                   'chunk.optString("complete_url") == "$upload?complete=1"'):
        assert marker in upload
    media = source('feature/posts/NativeMediaClient.kt')
    for marker in ('followRedirects(false)', 'followSslRedirects(false)', 'retryOnConnectionFailure(false)',
                   'continuation.invokeOnCancellation { call.cancel() }', 'NativePostUploadPolicy.plan(',
                   'for (part in 1..plan.partCount)', 'val token = freshToken()', 'checkActiveOwner()',
                   'NativePostFileRangeBody(', 'NativePostUploadPolicy.videoDurationAllowed(duration)',
                   'NativePostUploadPolicy.imageSizeAllowed(image.length())'):
        assert marker in media
    composer = source('feature/posts/NativePostsScreens.kt')
    assert 'PickMultipleVisualMedia(NativePostMediaPolicy.MAX_ATTACHMENTS)' in composer
    editor = source('feature/posts/NativeMediaEditor.kt')
    edit_policy = source('feature/posts/NativeMediaEditPolicy.kt')
    assert 'NativePostMediaPolicy.MAX_VIDEO_MS' in edit_policy
    assert 'maximumVideoMs' in editor and 'NativeMediaEditPolicy.MAX_VIDEO_MS' in editor
    story = source('feature/stories/NativeStoryPolicy.kt')
    story_limits = {'MAX_VIDEO_MS':30_000,'PHOTO_DISPLAY_MS':7_000,
                    'MAX_IMAGES_PER_DAY':4,'MAX_VIDEOS_PER_DAY':2,'MAX_CAPTION':500}
    assert {name:kotlin_integer_constant(story,name) for name in story_limits} == story_limits, 'STORY_BOUNDARY_DRIFT'
    assert 'maximumVideoMs = NativeStoryPolicy.MAX_VIDEO_MS' in source('feature/stories/NativeStoryComposer.kt')

    download = source('feature/videos/NativeShortVideoDownloadPolicy.kt')
    assert kotlin_integer_constant(download, 'SHORT_VIDEO_DOWNLOAD_MAX_BYTES') == expected['MAX_VIDEO_BYTES']
    for marker in ('setOf("https://sautilink.com", "https://test.sautilink.com")',
                   'downloadUuid.matches(mediaId)', 'rawQuery == null', 'fragment == null',
                   'userInfo == null', 'port == -1', 'size in 1..SHORT_VIDEO_DOWNLOAD_MAX_BYTES',
                   'nativeShortVideoDownloadMetadata', 'total + count > expectedBytes',
                   'total != expectedBytes', 'downloadedMp4Header(header, headerLength)'):
        # Size parsing uses a takeIf expression; exact numeric evaluation above
        # remains independent of that source spelling.
        if marker == 'size in 1..SHORT_VIDEO_DOWNLOAD_MAX_BYTES':
            assert 'it in 1..SHORT_VIDEO_DOWNLOAD_MAX_BYTES' in download
        else: assert marker in download
    buffers = re.findall(r'ByteArray\(([^\n]+?)\)', download)
    assert len(buffers) == 2 and all(kotlin_integer_constant('const val BUFFER = '+value,'BUFFER') == 64*1024 for value in buffers), 'BOUNDED_DOWNLOAD_IO_REQUIRED'
    assert download.count('if (!active())') >= 3, 'DOWNLOAD_OWNER_CHECKS_REQUIRED'
    ui = source('feature/videos/NativeShortVideoDownload.kt')
    service = source('feature/videos/NativeShortVideoDownloadService.kt')
    for marker in ('auth.account?.id == owner', 'StagingSessionState.SIGNED_IN',
                   'nativeShortVideoDownloadIdentityValid(mediaId, postId)', 'current != null',
                   'permissionOwner', 'auth.account?.id != expectedOwner', 'startForegroundService'):
        assert marker in ui
    extras = re.findall(r'\.putExtra\(([^\n]+?)\)', ui+'\n'+service)
    assert len(extras) == 1 and re.sub(r'\s+','',extras[0]) == 'NativeShortVideoDownloadService.EXTRA_TICKET,ticket.id', 'AUTH_INTENT_EXTRA_FORBIDDEN'
    assert not re.search(r'\.(?:putExtras|replaceExtras)\s*\(', ui+'\n'+service), 'AUTH_INTENT_BUNDLE_FORBIDDEN'
    assert not re.search(r'\.setData(?:AndType)?\s*\(|\.data\s*=', ui), 'DOWNLOAD_LAUNCH_INTENT_DATA_FORBIDDEN'
    assert re.findall(r'getStringExtra\(([^)]+)\)', service) == ['EXTRA_TICKET']
    assert 'val id: String = UUID.randomUUID().toString()' in ui
    for marker in ('START_NOT_STICKY', 'ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC',
                   'override fun onBind(intent: Intent?): IBinder? = null', 'ensureCurrent(selected)',
                   'accessTokenForStagingRead()', 'copyNativeShortVideoDownload(', 'selected::active',
                   'followRedirects(false)', 'followSslRedirects(false)', '.cache(null)',
                   'VISIBILITY_PRIVATE', 'FLAG_IMMUTABLE', 'MediaStore.Video.Media.IS_PENDING, 1',
                   'MediaStore.Video.Media.IS_PENDING, 0', 'if (!complete) runCatching { target?.abort() }',
                   'if (actual != metadata)', 'builder.header("If-Match", etag)'):
        assert marker in service
    for forbidden in ('.readBytes(', '.bytes()', 'ByteArray(expectedBytes', 'ByteArray(metadata.bytes',
                      'START_STICKY', 'Log.', 'println('):
        assert forbidden not in service+'\n'+download
    verify_post_download_manifest(ET.fromstring((native.parents[3]/'AndroidManifest.xml').read_text(encoding='utf-8')))

    shorts = source('feature/videos/ProductionShortVideosScreen.kt')
    for marker in ('ShortsAuthorIdentityRow(', 'rememberShortsAuthorMetadata(',
                   'rememberShortVideoDownloadAction(auth, item.mediaId, item.post.id)', 'onLongPress = downloadVideo'):
        assert marker in shorts
    identity = source('feature/videos/ShortsAuthorIdentityRow.kt')
    for marker in ('post.authorHandle', 'shortsRankForPost(post.id, rank)', 'SautiColors.Yellow',
                   'ShortsFollowPresentation.FOLLOWING', '"Following"'):
        assert marker in identity
    return {'nativePostAttachmentLimit':10,'nativeNewPostImageMaxBytes':5*1024*1024,
            'nativePostVideoMaxBytes':250*1024*1024,'nativePostVideoMaxMilliseconds':180_000,
            'nativePrivateForegroundVideoDownloadIncluded':True,'nativeBoundedDownloadIoBytes':64*1024,
            'nativeOpaqueDownloadTicketOnly':True,'nativeShortsAuthorIdentityIncluded':True,
            'uploadDownloadOrDeviceExecutionAttestedBySourceContract':False}


def reviewed_jvm_suites():
    gate('REVIEWED_JVM_TEST_MANIFEST')
    assert re.fullmatch(r'[a-f0-9]{64}', JVM_MANIFEST_SHA256)
    payload = (HERE/'release51-jvm-tests.json').read_bytes()
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


REQUIRED_RUNTIME_DESCRIPTORS = ('Landroidx/media3/exoplayer/hls/HlsMediaSource;',
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
 'Lcom/sautilink/nativeapp/ui/components/NativeVideoReplayPool;',
 'Lcom/sautilink/nativeapp/ui/components/NativeVideoReplayOwner;',
 'Lcom/sautilink/nativeapp/ui/components/NativeShortsPreloading;',
 'Landroidx/media3/exoplayer/source/preload/DefaultPreloadManager;',
 'Lcom/sautilink/nativeapp/feature/home/FeedVideoMetadataWarmupKt;',
 'Lcom/sautilink/nativeapp/ui/state/SessionScreenPresentationStore;',
 'Lcom/sautilink/nativeapp/feature/videos/ShortsPlaybackEngine;',
 'Lcom/sautilink/nativeapp/NativeAuthenticatedAppHostKt;',
 'Lcom/sautilink/nativeapp/feature/posts/NativeMediaClient;',
 'Lcom/sautilink/nativeapp/feature/posts/NativePostMediaPolicy;',
 'Lcom/sautilink/nativeapp/feature/posts/NativePostUploadPolicy;',
 'Lcom/sautilink/nativeapp/feature/posts/NativePostUploadPolicyKt;',
 'Lcom/sautilink/nativeapp/feature/posts/NativePostFileRangeBody;',
 'Lcom/sautilink/nativeapp/feature/videos/NativeShortVideoDownloadKt;',
 'Lcom/sautilink/nativeapp/feature/videos/NativeShortVideoDownloadTicket;',
 'Lcom/sautilink/nativeapp/feature/videos/NativeShortVideoDownloads;',
 'Lcom/sautilink/nativeapp/feature/videos/NativeShortVideoDownloadService;',
 'Lcom/sautilink/nativeapp/feature/videos/NativeShortVideoDownloadPolicyKt;',
 'Lcom/sautilink/nativeapp/feature/videos/ShortsAuthorIdentityRowKt;',
 'Lcom/sautilink/nativeapp/feature/videos/ShortsAuthorMetadata;',
 'Lcom/sautilink/nativeapp/feature/videos/ShortsAuthorPoliciesKt;',
 'Lcom/sautilink/nativeapp/feature/videos/ShortsTrendingRanksClient;',
 'Lcom/sautilink/nativeapp/feature/verification/VerificationApplicantType;',
 'Lcom/sautilink/nativeapp/feature/verification/VerificationApplicantPolicyKt;',
 'Lcom/sautilink/nativeapp/feature/dashboard/NativeDashboardCardsKt;')


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
    assert root.get(ANDROID+'versionCode') == '51'
    assert root.get(ANDROID+'versionName') == '1.1.6'
    sdk, app = root.find('uses-sdk'), root.find('application')
    assert sdk is not None and app is not None
    assert sdk.get(ANDROID+'minSdkVersion') == '26' and sdk.get(ANDROID+'targetSdkVersion') == '36'
    assert app.get(ANDROID+'debuggable', 'false') == 'false'
    verify_post_download_manifest(root)


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
    rootProject.tasks.register("resolveRelease51TextCompiler") {
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
             ':resolveRelease51TextCompiler', '--no-daemon', '--no-configuration-cache',
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
    rootProject.tasks.register("resolveRelease51VideoApis") {
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
             ':resolveRelease51VideoApis', '--no-daemon', '--no-configuration-cache',
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
    gate('NATIVE_RELEASE51_EXACT_REVIEWED_JVM_TEST_SUITES')
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
               'package': 'com.sautilink.app', 'versionCode': 51, 'versionName': '1.1.6',
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
    assert bundle['versionCode'] == 51 and bundle['versionName'] == '1.1.6'
    public = {'sourceSha': SOURCE, 'appSourceTree': SOURCE_TREE, 'repositoryTree': REPOSITORY_TREE, 'appMainSourceTree': MAIN_SOURCE_TREE,
              'package': 'com.sautilink.app', 'versionCode': 51, 'versionName': '1.1.6',
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
    assert bundle['sourceSha'] == SOURCE and bundle['versionCode'] == 51 and bundle['versionName'] == '1.1.6'
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
