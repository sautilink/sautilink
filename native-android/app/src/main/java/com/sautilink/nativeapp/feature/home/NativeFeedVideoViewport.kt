package com.sautilink.nativeapp.feature.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Rendering needs only the existing visibility thresholds. Exact geometry
 * remains available to the one-player arbiter without invalidating Compose or
 * repeatedly cancelling source, playback and lookahead effects during scroll. */
internal enum class FeedVideoVisibility(val fraction: Float) { HIDDEN(0f), SLIVER(.05f), PARTIAL(.2f), AUTOPLAY(.75f) }
internal class NativeFeedVideoViewport {
    var fraction: Float = 0f
        private set
    var distance: Float = Float.MAX_VALUE
        private set
    var visibility by mutableStateOf(FeedVideoVisibility.HIDDEN)
        private set
    fun update(fraction: Float, distance: Float) {
        this.fraction = fraction.takeIf { it.isFinite() }?.coerceIn(0f, 1f) ?: 0f
        this.distance = distance.takeIf { it.isFinite() && it >= 0f } ?: Float.MAX_VALUE
        visibility = when {
            this.fraction <= 0f -> FeedVideoVisibility.HIDDEN
            this.fraction < .1f -> FeedVideoVisibility.SLIVER
            this.fraction < .58f -> FeedVideoVisibility.PARTIAL
            else -> FeedVideoVisibility.AUTOPLAY
        }
    }
}
