package com.sautilink.nativeapp.ui.components

import org.junit.Assert.*
import org.junit.Test

class HomeNavigationScrollStateTest {
    @Test fun deliberateDownwardScrollHidesAndUpwardScrollShows() {
        val state = HomeNavigationScrollState()
        state.scroll(-8f, 12f); assertFalse(state.hidden)
        state.scroll(-4f, 12f); assertTrue(state.hidden)
        state.scroll(6f, 12f); assertTrue(state.hidden)
        state.scroll(6f, 12f); assertFalse(state.hidden)
    }
    @Test fun tinyDirectionReversalsDoNotFlickerTheNavigation() {
        val state = HomeNavigationScrollState()
        repeat(20) { state.scroll(-3f, 12f); state.scroll(3f, 12f) }
        assertFalse(state.hidden)
        state.scroll(-20f, 12f)
        repeat(20) { state.scroll(3f, 12f); state.scroll(-3f, 12f) }
        assertTrue(state.hidden)
    }
    @Test fun returningToTopOrChangingFeedResetsAccumulatedMovement() {
        val state = HomeNavigationScrollState()
        state.scroll(-40f, 12f); assertTrue(state.hidden)
        state.show(); assertFalse(state.hidden)
        state.scroll(-1f, 12f); assertFalse(state.hidden)
    }
    @Test fun invalidOrZeroMovementCannotChangeVisibility() {
        val state = HomeNavigationScrollState()
        state.scroll(Float.NaN, 12f); state.scroll(Float.NEGATIVE_INFINITY, 12f)
        state.scroll(-20f, 0f); state.scroll(-20f, Float.NaN); state.scroll(0f, 12f)
        assertFalse(state.hidden)
    }
}
