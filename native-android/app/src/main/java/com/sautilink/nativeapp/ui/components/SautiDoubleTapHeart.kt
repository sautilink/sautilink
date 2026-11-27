package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlin.math.sin

internal data class DoubleTapHeart(val id: Int, val point: Offset)

/** Separate transient artwork: repeated likes never toggle the persisted reaction off. */
@Stable
internal class DoubleTapHearts {
    val visible = mutableStateListOf<DoubleTapHeart>()
    private var sequence = 0
    fun add(point: Offset) {
        if (visible.size >= 4) visible.removeAt(0)
        visible.add(DoubleTapHeart(++sequence, point))
    }
}

/** Reference proportions: quick oversized arrival, settle, then a gentle upward fade.
 * Pixel offsets only affect a graphics layer; the video and surrounding layout never remeasure.
 */
@Composable
internal fun DoubleTapHeartOverlay(hearts: DoubleTapHearts, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier) {
        val density = LocalDensity.current
        val width = with(density) { maxWidth.toPx() }
        val height = with(density) { maxHeight.toPx() }
        val side = (minOf(maxWidth, maxHeight) * .28f).coerceIn(36.dp, 148.dp)
        val pixels = with(density) { side.toPx() }
        hearts.visible.forEach { heart -> key(heart.id) {
            val progress = remember { Animatable(0f) }
            LaunchedEffect(heart.id) {
                progress.animateTo(1f, tween(1050, easing = LinearEasing))
                hearts.visible.remove(heart)
            }
            val direction = if (heart.id % 2 == 0) -1f else 1f
            val tilt = floatArrayOf(-13f, 10f, -7f, 15f)[(heart.id - 1) % 4]
            val center = if (heart.point == Offset.Unspecified) Offset(width / 2, height / 2) else heart.point
            val x = center.x.coerceIn(pixels * .7f, maxOf(pixels * .7f, width - pixels * .7f))
            val y = center.y.coerceIn(pixels * .7f, maxOf(pixels * .7f, height - pixels * .7f))
            Icon(requireNotNull(SautiHugeVectors.get("heart-filled")), null,
                tint = SautiColors.LogoPink,
                modifier = Modifier.size(side).testTag("double-tap-heart").graphicsLayer {
                    val t = progress.value
                    val scale = when {
                        t < .12f -> .35f + .95f * (1 - (1 - t / .12f) * (1 - t / .12f))
                        t < .25f -> 1.3f - .4f * ((t - .12f) / .13f)
                        else -> .9f + .1f * ((t - .25f) / .75f)
                    }
                    val rise = ((t - .48f) / .52f).coerceIn(0f, 1f)
                    translationX = x - pixels / 2 + direction * pixels * .22f * rise + sin(t * 6.28f) * pixels * .025f
                    translationY = y - pixels / 2 - minOf(height * .16f, pixels * 1.1f) * rise * rise
                    scaleX = scale; scaleY = scale
                    rotationZ = tilt * (1 - t * .65f) + direction * rise * 8f
                    alpha = when { t < .06f -> t / .06f; t > .56f -> (1 - t) / .44f; else -> 1f }
                })
        }}
    }
}
