package com.sautilink.nativeapp.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** A genuinely thin timeline inside a 44dp touch target. Its visual track and
 * round thumb never inherit Material Slider's tall track/vertical handle.
 * Horizontal drag waits for touch slop; vertical movement remains a feed swipe.
 */
@Composable
internal fun ThinVideoSeekBar(positionMs: Long, durationMs: Long, enabled: Boolean,
    modifier: Modifier = Modifier, trackTop: Dp = 11.dp, thickness: Dp = 3.dp,
    thumbDiameter: Dp = 8.dp, showThumb: Boolean = true,
    trackTag: String = "video-seek-track", onInteraction: () -> Unit = {},
    onScrubbingChanged: (Boolean) -> Unit = {}, onPreview: (Long?) -> Unit = {},
    onSeek: (Long) -> Unit) {
    val canSeek = enabled && durationMs > 0
    val value = positionMs.coerceIn(0, durationMs.coerceAtLeast(0))
    val freshValue by rememberUpdatedState(value)
    val interaction by rememberUpdatedState(onInteraction)
    val preview by rememberUpdatedState(onPreview)
    val scrubbing by rememberUpdatedState(onScrubbingChanged)
    val seek by rememberUpdatedState(onSeek)
    var dragTarget by remember { mutableStateOf<Long?>(null) }
    fun bounded(target: Long) = target.coerceIn(0, (durationMs - 1).coerceAtLeast(0))
    Box(modifier.fillMaxWidth().height(44.dp)
        .semantics {
            contentDescription = "Video progress"
            stateDescription = "${videoTimeLabel(value)} of ${videoTimeLabel(durationMs)}"
            progressBarRangeInfo = ProgressBarRangeInfo(value.toFloat(), 0f..durationMs.coerceAtLeast(1).toFloat())
            if (!canSeek) disabled()
            setProgress { target ->
                if (canSeek && target.isFinite()) { interaction(); seek(bounded(target.toLong())); true } else false
            }
        }
        .onKeyEvent { event ->
            if (!canSeek || event.type != KeyEventType.KeyDown) false
            else when (event.key) {
                Key.DirectionLeft -> { interaction(); seek(bounded(freshValue - 5_000)); true }
                Key.DirectionRight -> { interaction(); seek(bounded(freshValue + 5_000)); true }
                else -> false
            }
        }.focusable(canSeek)
        .pointerInput(canSeek, durationMs) {
            val edge = 5.dp.toPx()
            fun target(x: Float): Long = (((x - edge) / (size.width - edge * 2).coerceAtLeast(1f))
                .coerceIn(0f, 1f) * durationMs).toLong()
            detectTapGestures(onPress = { interaction(); tryAwaitRelease() }, onTap = { point ->
                if (canSeek) seek(bounded(target(point.x)))
            })
        }
        .pointerInput(canSeek, durationMs) {
            val edge = 5.dp.toPx()
            fun target(x: Float): Long = (((x - edge) / (size.width - edge * 2).coerceAtLeast(1f))
                .coerceIn(0f, 1f) * durationMs).toLong()
            detectHorizontalDragGestures(onDragStart = { point ->
                if (canSeek) { interaction(); scrubbing(true); dragTarget = target(point.x); preview(dragTarget) }
            }, onDragEnd = {
                if (canSeek) dragTarget?.let { seek(bounded(it)) }
                dragTarget = null; preview(null); scrubbing(false)
            }, onDragCancel = { dragTarget = null; preview(null); scrubbing(false) }) { change, _ ->
                if (canSeek) { change.consume(); dragTarget = target(change.position.x); preview(dragTarget) }
            }
        }) {
        Canvas(Modifier.fillMaxWidth().offset(y = trackTop).height(thickness).testTag(trackTag)) {
            val edge = 5.dp.toPx()
            val width = (size.width - edge * 2).coerceAtLeast(0f)
            val y = size.height / 2f
            val fraction = if (durationMs > 0) value.toFloat() / durationMs else 0f
            val end = Offset(edge + width * fraction, y)
            drawLine(Color.White.copy(alpha = if (canSeek) .35f else .2f), Offset(edge, y), Offset(edge + width, y), size.height, StrokeCap.Round)
            drawLine(Color.White, Offset(edge, y), end, size.height, StrokeCap.Round)
            if (showThumb) drawCircle(Color.White, thumbDiameter.toPx() / 2f, end)
        }
    }
}
