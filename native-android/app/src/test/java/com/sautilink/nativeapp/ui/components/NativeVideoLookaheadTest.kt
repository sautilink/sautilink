package com.sautilink.nativeapp.ui.components

import com.sautilink.nativeapp.feature.home.FeedVideoHealth
import com.sautilink.nativeapp.feature.home.feedByteWarmupEligible
import com.sautilink.nativeapp.feature.home.feedLookaheadAnchor
import com.sautilink.nativeapp.feature.home.feedVideoHealthAt
import org.junit.Assert.*
import org.junit.Test

class NativeVideoLookaheadTest {
    @Test fun openingAndRollingWindowPrepareFiveWithinTheLoadedInventory() {
        assertEquals(listOf(0,1,2,3,4),videoLookaheadIndices(-1,12))
        assertEquals(listOf(1,2,3,4,5),videoLookaheadIndices(0,12))
        assertEquals(listOf(5,6,7,8,9),videoLookaheadIndices(4,12))
        assertEquals(listOf(10,11),videoLookaheadIndices(9,12))
        assertTrue(videoLookaheadIndices(11,12).isEmpty())
    }
    @Test fun EmptyInvalidAndExtremeInventoryCannotCreateUnboundedOrOverflowingWork() {
        assertTrue(videoLookaheadIndices(-2,12).isEmpty())
        assertTrue(videoLookaheadIndices(0,0).isEmpty())
        assertTrue(videoLookaheadIndices(15,12).isEmpty())
        assertEquals(listOf(Int.MAX_VALUE-1),videoLookaheadIndices(Int.MAX_VALUE-2,Int.MAX_VALUE))
    }
    @Test fun allFiveFutureTargetsLoadButUnknownPastSixthAndClosedTargetsDoNot() {
        val future=(11..15).toSet()
        for(index in future) assertEquals(ShortsPreloadTarget.LOAD_NEXT,
            videoPreloadTarget(index,10,future,true,true,false))
        for(index in listOf(8,9,16,100)) assertEquals(ShortsPreloadTarget.NONE,
            videoPreloadTarget(index,10,future+index,true,true,false))
        assertEquals(ShortsPreloadTarget.NONE,videoPreloadTarget(11,10,future,false,true,false))
        assertEquals(ShortsPreloadTarget.NONE,videoPreloadTarget(11,10,future,true,true,true))
    }
    @Test fun currentPreparedSampleHandoffSurvivesSpeculationPause() {
        assertEquals(ShortsPreloadTarget.RETAIN_CURRENT,videoPreloadTarget(10,10,emptySet(),false,true,false))
        assertEquals(ShortsPreloadTarget.NONE,videoPreloadTarget(10,10,(11..15).toSet(),true,false,false))
    }
    @Test fun continuingQueueAvoidsThresholdChurnButYieldsBeforeRunwayIsExhausted() {
        assertEquals(5_999L,videoPreloadRunway(5_999L,false))
        assertEquals(6_000L,videoPreloadRunway(5_999L,true))
        assertEquals(6_000L,videoPreloadRunway(3_000L,true))
        assertEquals(2_999L,videoPreloadRunway(2_999L,true))
        assertEquals(9_000L,videoPreloadRunway(9_000L,true))
    }
    @Test fun completedFutureQueuesSurviveCurrentStartupWithoutStartingUnpreparedSources() {
        val future=(11..15).toSet()
        assertEquals(ShortsPreloadTarget.RETAIN_CURRENT,videoPreloadTarget(12,10,future,false,true,false,setOf(12)))
        assertEquals(ShortsPreloadTarget.NONE,videoPreloadTarget(13,10,future,false,true,false,setOf(12)))
        assertEquals(ShortsPreloadTarget.NONE,videoPreloadTarget(12,10,future,false,true,true,setOf(12)))
        assertEquals(ShortsPreloadTarget.NONE,videoPreloadTarget(16,10,future+16,false,true,false,setOf(16)))
    }
    @Test fun pendingVisibleHandoffRetainsOnlyItsPartialQueuesAndStopsTheOldFutureWork() {
        val future=(11..15).toSet()
        assertEquals(ShortsPreloadTarget.RETAIN_CURRENT,
            videoPreloadTarget(11,10,future,false,true,false,setOf(12),incomingIndex=11))
        assertEquals(ShortsPreloadTarget.RETAIN_CURRENT,
            videoPreloadTarget(12,10,future,false,true,false,setOf(12),incomingIndex=11))
        for(index in 13..15) assertEquals(ShortsPreloadTarget.NONE,
            videoPreloadTarget(index,10,future,false,true,false,setOf(12),incomingIndex=11))
        assertEquals(ShortsPreloadTarget.NONE,
            videoPreloadTarget(11,10,future,false,false,true,setOf(12),incomingIndex=11))
        assertEquals(ShortsPreloadTarget.NONE,
            videoPreloadTarget(11,10,future,false,false,false))
    }
    @Test fun historyRetainsOnlyTwoParsedSources_withoutSelectingTracksOrLoadingPastSamples() {
        for(index in 8..9) assertEquals(ShortsPreloadTarget.RETAIN_SOURCE,
            videoPreloadTarget(index,10,emptySet(),false,true,false,sourceOnlyPrevious=setOf(7,8,9)))
        assertEquals(ShortsPreloadTarget.NONE,
            videoPreloadTarget(7,10,emptySet(),false,true,false,sourceOnlyPrevious=setOf(7)))
        assertEquals(ShortsPreloadTarget.NONE,
            videoPreloadTarget(9,10,emptySet(),false,true,true,sourceOnlyPrevious=setOf(9)))
    }
    @Test fun coldHistoryWaitsForHealthyCurrent_butPreparedMetadataSurvivesBufferingUntilExpiryOrOptOut() {
        assertFalse(videoHistorySourceEligible(9,10,true,false,false,100,200))
        assertTrue(videoHistorySourceEligible(9,10,true,true,false,100,200))
        assertTrue(videoHistorySourceEligible(9,10,true,false,true,100,200))
        assertFalse(videoHistorySourceEligible(9,10,false,true,true,100,200))
        assertFalse(videoHistorySourceEligible(9,10,true,true,true,200,200))
        assertFalse(videoHistorySourceEligible(7,10,true,true,true,100,200))
        assertFalse(videoHistorySourceEligible(10,10,true,true,true,100,200))
    }
    @Test fun historyDeadlineNeverExtendsTheOriginalGrant_andCapsMemoryRetentionAtTwoMinutes() {
        assertEquals(120_500L,videoHistoryDeadline(301_000L,1_000L,500L))
        assertEquals(55_500L,videoHistoryDeadline(61_000L,1_000L,500L))
        assertEquals(500L,videoHistoryDeadline(5_000L,1_000L,500L))
    }
    @Test fun textAndImageRowsDoNotConsumeTheFiveVideoWindow() {
        val positions=listOf(2,6,9,12,15,20,23)
        assertEquals(-1,feedLookaheadAnchor(positions,0))
        assertEquals(0,feedLookaheadAnchor(positions,2))
        assertEquals(1,feedLookaheadAnchor(positions,8))
        assertEquals(listOf(2,3,4,5,6),videoLookaheadIndices(feedLookaheadAnchor(positions,8),positions.size))
    }
    @Test fun metadataCanStartBeforeMotionButNotDuringPrivacyOrResourceOptOut() {
        assertTrue(videoMetadataWarmupEligible(true,true,true,false,false,false))
        assertFalse(videoMetadataWarmupEligible(false,true,true,false,false,false))
        assertFalse(videoMetadataWarmupEligible(true,false,true,false,false,false))
        assertFalse(videoMetadataWarmupEligible(true,true,false,false,false,false))
        assertFalse(videoMetadataWarmupEligible(true,true,true,true,false,false))
        assertFalse(videoMetadataWarmupEligible(true,true,true,false,true,false))
        assertFalse(videoMetadataWarmupEligible(true,true,true,false,false,true))
    }
    private fun bytes(health: FeedVideoHealth?=null,idle: Boolean=true,metered: Boolean=false,
        mbps: Double?=null,saver: Boolean=false) = feedByteWarmupEligible(true,true,true,saver,metered,mbps,false,health,idle)
    @Test fun idleTextReadingMayWarmButVisibleBufferingAlwaysOwnsTheNetwork() {
        assertTrue(bytes())
        assertFalse(bytes(idle=false))
        assertFalse(bytes(FeedVideoHealth("video",false,0,true,0)))
        assertFalse(bytes(FeedVideoHealth("video",true,5_999,true,0)))
        assertTrue(bytes(FeedVideoHealth("video",true,6_000,true,0)))
        assertFalse(bytes(FeedVideoHealth("video",true,10_000,false,0)))
    }
    @Test fun bufferingSampleNewerThanThePreviousCoordinatorTickCannotEnableIdleSpeculation() {
        val previousTick=1_000L
        val buffering=FeedVideoHealth("visible",false,0,true,previousTick+100L)
        val fresh=feedVideoHealthAt(buffering,previousTick+100L)
        assertSame(buffering,fresh)
        assertFalse("A fresh buffering sample must suppress otherwise eligible idle lookahead",bytes(fresh))
        assertSame(buffering,feedVideoHealthAt(buffering,2_350L))
        assertNull(feedVideoHealthAt(buffering,2_351L))
        assertNull("Future clock samples must still fail closed",feedVideoHealthAt(buffering,1_099L))
    }
    @Test fun networkSaverAndUnmeasuredMeteredConnectionNeverWarmSampleBytes() {
        assertFalse(bytes(saver=true))
        assertFalse(bytes(metered=true))
        assertFalse(bytes(metered=true,mbps=Double.NaN))
        assertFalse(bytes(metered=true,mbps=2.99))
        assertTrue(bytes(metered=true,mbps=3.0))
    }
}
