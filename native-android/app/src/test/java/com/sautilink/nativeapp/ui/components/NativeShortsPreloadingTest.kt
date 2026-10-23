package com.sautilink.nativeapp.ui.components

import org.junit.Assert.*
import org.junit.Test

class NativeShortsPreloadingTest {
    private fun eligible(foreground: Boolean = true, online: Boolean = true, autoplay: Boolean = true,
        playing: Boolean = true, buffer: Long = 6_000, saver: Boolean = false, metered: Boolean = false,
        mbps: Double? = null, stressed: Boolean = false, auto: Boolean = true) =
        shortsPreloadEligible(foreground, online, autoplay, playing, buffer, saver, metered, mbps, stressed, auto)

    @Test fun healthyUnmeteredPlaybackMayPrepareOneAdjacentSource() { assertTrue(eligible()) }
    @Test fun bufferingVisibleVideoOwnsNetwork() { assertFalse(eligible(playing = false)); assertFalse(eligible(buffer = 5_999)) }
    @Test fun backgroundAndOfflineNeverSpeculate() { assertFalse(eligible(foreground = false)); assertFalse(eligible(online = false)) }
    @Test fun explicitPauseAndAutoplayOffNeverSpeculate() { assertFalse(eligible(autoplay = false)); assertFalse(eligible(playing = false)) }
    @Test fun dataSaverOverridesFastConnection() { assertFalse(eligible(saver = true, mbps = 100.0)) }
    @Test fun meteredNeedsRecentMeasuredCapacity() { assertFalse(eligible(metered = true)); assertFalse(eligible(metered = true, mbps = 2.99)); assertTrue(eligible(metered = true, mbps = 3.0)) }
    @Test fun invalidMeasurementsCannotEnableMeteredSpeculation() { for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, -1.0)) assertFalse(eligible(metered = true, mbps = value)) }
    @Test fun memoryHeatAndBatteryPressureDisablePreparation() { assertFalse(eligible(stressed = true)) }
    @Test fun manualQualityDoesNotDownloadAnUnmatchedAutoTrack() { assertFalse(eligible(auto = false)) }
    @Test fun currentHandoffRetainsItsPeriodEvenWhenNextSpeculationIsDisabled() {
        assertEquals(ShortsPreloadTarget.RETAIN_CURRENT, shortsPreloadTarget(1, 1, null, false, true, false))
        assertEquals(ShortsPreloadTarget.RETAIN_CURRENT, shortsPreloadTarget(1, 1, 2, true, true, false))
    }
    @Test fun onlyAdjacentNextMayLoadAndOlderSourcesAreNotRetained() {
        assertEquals(ShortsPreloadTarget.LOAD_NEXT, shortsPreloadTarget(2, 1, 2, true, true, false))
        assertEquals(ShortsPreloadTarget.NONE, shortsPreloadTarget(3, 1, 3, true, true, false))
        assertEquals(ShortsPreloadTarget.NONE, shortsPreloadTarget(0, 1, 2, true, true, false))
        assertEquals(ShortsPreloadTarget.NONE, shortsPreloadTarget(2, 1, 2, false, true, false))
    }
    @Test fun explicitCancellationAndCloseReleaseUnclaimedCurrentSamples() {
        assertEquals(ShortsPreloadTarget.NONE, shortsPreloadTarget(1, 1, null, false, false, false))
        assertEquals(ShortsPreloadTarget.NONE, shortsPreloadTarget(1, 1, 2, true, true, true))
        assertEquals(ShortsPreloadTarget.NONE, shortsPreloadTarget(2, 1, 2, true, true, true))
    }
}
