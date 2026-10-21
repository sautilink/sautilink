package com.sautilink.nativeapp.ui.components

import org.junit.Assert.*
import org.junit.Test

/** Completed transfer records only. No probes, sockets, credentials or Android services. */
class RecentVideoTransferObservationTest {
    private val wifi = 41L
    private val mobile = 52L
    private fun seeded(): RecentVideoTransferObservation = RecentVideoTransferObservation().apply {
        observeConnection(wifi, true, 1_000)
        recordTransfer(wifi, true, 500, 600_000, 8_000_000, 1_500)
    }

    @Test fun startupAndConnectionSignalsNeverBecomeAnInitialBandwidthGuess() {
        val observations = RecentVideoTransferObservation()
        assertNull(observations.observeConnection(wifi, true, 1_000))
        assertNull(observations.observeConnection(wifi, true, 2_000))
        assertNull(observations.recordTransfer(wifi, true, 0, 0, 100_000_000, 2_000))
        assertNull(observations.observeConnection(wifi, true, 2_100))
    }

    @Test fun aNewVideoCellCanReuseRecentActualTransferOnTheSameNetwork() {
        val observations = seeded()
        assertEquals(RecentVideoTransferSample(8.0, 1_500), observations.observeConnection(wifi, true, 2_000))
        val media = NativeVideoMetadata(1080, 1920, 20_000)
        val measured = observations.observeConnection(wifi, true, 2_100)!!
        assertEquals("720", NativeVideoQualityPolicy.selectQuality("auto", media,
            NativeVideoNetwork(measuredMbps = measured.measuredMbps)))
    }

    @Test fun tinyFastInvalidAndEmptySamplesCannotReplaceOrExtendAnActualMeasurement() {
        val observations = seeded()
        listOf(Triple(199, 900_000L, 30_000_000L), Triple(500, 524_287L, 30_000_000L),
            Triple(500, 900_000L, 0L), Triple(-1, 900_000L, 30_000_000L),
            Triple(500, -1L, 30_000_000L)).forEachIndexed { index, (elapsed, bytes, estimate) ->
            assertEquals(RecentVideoTransferSample(8.0, 1_500),
                observations.recordTransfer(wifi, true, elapsed, bytes, estimate, 2_000L + index))
        }
        assertNull(observations.observeConnection(wifi, true, 31_500))
    }

    @Test fun measurementExpiresAtThirtySeconds_andReadsNeverExtendItsLifetime() {
        val observations = seeded()
        assertNotNull(observations.observeConnection(wifi, true, 20_000))
        assertNotNull(observations.observeConnection(wifi, true, 31_499))
        assertNull(observations.observeConnection(wifi, true, 31_500))
        assertNull(observations.observeConnection(wifi, true, 31_501))
    }

    @Test fun networkHandoffForgetsOldCapacity_andReturningToWifiDoesNotResurrectIt() {
        val observations = seeded()
        assertNull(observations.observeConnection(mobile, true, 2_000))
        assertNull(observations.observeConnection(wifi, true, 2_100))
        assertNull(observations.observeConnection(wifi, true, 2_200))
    }

    @Test fun delayedTransferThatOverlapsNetworkHandoffIsNotAssignedToTheNewNetwork() {
        val observations = seeded()
        observations.observeConnection(mobile, true, 2_000)
        assertNull(observations.recordTransfer(mobile, true, 800, 600_000, 20_000_000, 2_300))
        assertEquals(RecentVideoTransferSample(.8, 2_600),
            observations.recordTransfer(mobile, true, 500, 600_000, 800_000, 2_600))
    }

    @Test fun offlineUnvalidatedOrUnknownNetworksCannotRetainOrCreateAMeasurement() {
        val observations = seeded()
        assertNull(observations.observeConnection(wifi, false, 2_000))
        assertNull(observations.recordTransfer(wifi, false, 500, 600_000, 8_000_000, 2_600))
        assertNull(observations.observeConnection(wifi, true, 3_000))
        assertNull(observations.observeConnection(null, true, 3_100))
        assertNull(observations.recordTransfer(null, true, 500, 600_000, 8_000_000, 3_700))
    }

    @Test fun newSubstantialTransferUpdatesTheCapacity_andTheNextCellUsesIt() {
        val observations = seeded()
        assertEquals(RecentVideoTransferSample(.9, 2_000),
            observations.recordTransfer(wifi, true, 500, 524_288, 900_000, 2_000))
        assertEquals(RecentVideoTransferSample(.9, 2_000), observations.observeConnection(wifi, true, 2_100))
        assertEquals(RecentVideoTransferSample(12.0, 3_000),
            observations.recordTransfer(wifi, true, 1_000, 1_000_000, 12_000_000, 3_000))
    }

    @Test fun dataSaverAndMeteringOverrideRecentFastCapacityForTheNextVideo() {
        val observations = seeded()
        val measured = observations.observeConnection(wifi, true, 2_000)!!
        val media = NativeVideoMetadata(1080, 1920, 20_000)
        assertEquals("240", NativeVideoQualityPolicy.selectQuality("auto", media,
            NativeVideoNetwork(measuredMbps = measured.measuredMbps, saveData = true)))
        assertEquals("360", NativeVideoQualityPolicy.selectQuality("auto", media,
            NativeVideoNetwork(measuredMbps = measured.measuredMbps, isMetered = true)))
    }

    @Test fun clockRollbackDiscardsTheOldMeasurement_andPreRollbackSamplesCannotRepopulateIt() {
        val observations = seeded()
        assertNull(observations.observeConnection(wifi, true, 900))
        assertNull(observations.recordTransfer(wifi, true, 500, 600_000, 8_000_000, 1_000))
        assertNull(observations.observeConnection(wifi, true, 1_100))
    }
}
