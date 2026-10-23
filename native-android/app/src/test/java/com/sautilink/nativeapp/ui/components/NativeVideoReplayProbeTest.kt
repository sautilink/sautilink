package com.sautilink.nativeapp.ui.components

import org.junit.Assert.*
import org.junit.Test

class NativeVideoReplayProbeTest {
    @Test fun numericTagsCompareWithinRun_butNeverExposeInputAndChangeWithObserver() {
        val events = mutableListOf<NativeVideoReplayEvent>()
        val generation = "11111111-1111-4111-8111-111111111111"
        val identity = "synthetic-private-resource-not-for-output"
        try {
            NativeVideoReplayProbe.observer = { events += it }
            repeat(2) { NativeVideoReplayProbe.mark(NativeVideoReplayStage.RESOURCE_IDENTITY,
                generation = generation, identity = identity, mediaId = "https://invalid.test/private") }
            assertNotEquals(0L, events[0].generationTag)
            assertEquals(events[0].generationTag, events[1].generationTag)
            assertEquals(events[0].resourceTag, events[1].resourceTag)
            assertNull(events[0].mediaId)
            assertFalse(events[0].toString().contains(generation))
            assertFalse(events[0].toString().contains(identity))
            assertFalse(events[0].toString().contains("https://"))
            NativeVideoReplayProbe.mark(NativeVideoReplayStage.RESOURCE_IDENTITY,
                generation = generation, identity = "$identity-changed")
            assertEquals(events[0].generationTag, events[2].generationTag)
            assertNotEquals(events[0].resourceTag, events[2].resourceTag)
            NativeVideoReplayProbe.observer = { events += it }
            NativeVideoReplayProbe.mark(NativeVideoReplayStage.RESOURCE_IDENTITY, generation = generation, identity = identity)
            assertNotEquals(events[0].generationTag, events[3].generationTag)
            assertNotEquals(events[0].resourceTag, events[3].resourceTag)
        } finally { NativeVideoReplayProbe.observer = null }
    }

    @Test fun disabledProbeDoesNoWorkAndThrowingDiagnosticSinkCannotBreakPlayback() {
        try {
            NativeVideoReplayProbe.observer = null
            assertFalse(NativeVideoReplayProbe.enabled)
            assertEquals(0L, NativeVideoReplayProbe.nextEpoch())
            NativeVideoReplayProbe.mark(NativeVideoReplayStage.POOL_CLOSE)
            NativeVideoReplayProbe.observer = { error("synthetic sink failure") }
            NativeVideoReplayProbe.mark(NativeVideoReplayStage.POOL_CREATE)
        } finally { NativeVideoReplayProbe.observer = null }
    }
}
