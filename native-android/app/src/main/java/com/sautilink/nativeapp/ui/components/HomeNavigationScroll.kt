package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp

/** Only direction changes across a deliberate drag update Compose state. Pixel
 * deltas stay outside snapshots, so scrolling never recomposes the app chrome. */
internal class HomeNavigationScrollState {
    var hidden by mutableStateOf(false)
        private set
    private var distance = 0f

    fun scroll(consumedY: Float, threshold: Float) {
        if (!consumedY.isFinite() || !threshold.isFinite() || threshold <= 0f || consumedY == 0f) return
        if ((consumedY > 0f && distance < 0f) || (consumedY < 0f && distance > 0f)) distance = 0f
        distance = (distance + consumedY).coerceIn(-threshold, threshold)
        if (distance <= -threshold) hidden = true
        else if (distance >= threshold) hidden = false
    }

    fun show() { distance = 0f; hidden = false }
}

internal val LocalHomeNavigationScroll = staticCompositionLocalOf<HomeNavigationScrollState?> { null }

@Composable
internal fun rememberHomeNavigationScrollConnection(state: HomeNavigationScrollState?): NestedScrollConnection {
    val threshold = with(LocalDensity.current) { 12.dp.toPx() }
    return remember(state, threshold) {
        object : NestedScrollConnection {
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                // Ignore horizontal gestures, overscroll and programmatic list restoration.
                if (source == NestedScrollSource.UserInput) state?.scroll(consumed.y, threshold)
                return Offset.Zero
            }
        }
    }
}

/** Translation/fade keep the Scaffold slot constant: no content remeasurement,
 * decoder resize or FAB jump when Home navigation moves out of the viewport. */
@Composable
internal fun HomeScrollNavigation(hidden: Boolean, enabled: Boolean, content: @Composable () -> Unit) {
    val progress by animateFloatAsState(if (hidden && enabled) 1f else 0f,
        tween(240, easing = FastOutSlowInEasing), label = "Home navigation visibility")
    val shadowClearance = with(LocalDensity.current) { 12.dp.toPx() }
    Box(Modifier.testTag("home-navigation-slot")) {
        Box(Modifier.graphicsLayer {
            val fraction = if (enabled) progress else 0f
            translationY = (size.height + shadowClearance) * fraction
            alpha = 1f - fraction
        }.then(if (hidden && enabled) Modifier.clearAndSetSemantics {} else Modifier)) { content() }
    }
}
