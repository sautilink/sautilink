package com.sautilink.nativeapp.feature.home

import org.junit.Assert.*
import org.junit.Test

class NativeFeedVideoViewportTest {
    @Test fun visibilityPreservesAutoplayAndOffscreenThresholds() {
        val viewport = NativeFeedVideoViewport()
        for (fraction in listOf(0f, .001f, .0999f, .1f, .5799f, .58f, .99f, 1f)) {
            viewport.update(fraction, 10f)
            assertEquals(fraction >= .58f, viewport.visibility.fraction >= .58f)
            assertEquals(fraction < .1f, viewport.visibility.fraction < .1f)
            assertEquals(fraction > 0f, viewport.visibility.fraction > 0f)
            assertEquals(fraction, viewport.fraction, 0f)
        }
    }
    @Test fun exactGeometryRemainsAvailableToChooseTheMostVisibleVideo() {
        val control = NativeFeedPlaybackCoordinator()
        val a = NativeFeedVideoViewport(); val b = NativeFeedVideoViewport()
        a.update(.62f, 20f); b.update(.91f, 100f)
        assertEquals(a.visibility, b.visibility)
        control.update("a", NativeFeedPlaybackCoordinator.Candidate("first", a.fraction, a.distance))
        control.update("b", NativeFeedPlaybackCoordinator.Candidate("second", b.fraction, b.distance))
        assertEquals("second", control.activeGroup)
    }
    @Test fun invalidGeometryCannotAutoplayOrWinByANaNDistance() {
        val viewport = NativeFeedVideoViewport()
        viewport.update(Float.NaN, Float.NaN)
        assertEquals(FeedVideoVisibility.HIDDEN, viewport.visibility)
        assertEquals(Float.MAX_VALUE, viewport.distance, 0f)
    }
}
