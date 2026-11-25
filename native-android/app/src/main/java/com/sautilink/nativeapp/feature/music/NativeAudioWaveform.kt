package com.sautilink.nativeapp.feature.music

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlin.math.abs
import kotlin.math.roundToLong

@Composable
internal fun NativeAudioWaveform(bounds: NativeAudioTrimBounds, range: NativeAudioTrimRange,
    peaks: List<Float>, recordingDurationMs: Long, playbackMs: Long, modifier: Modifier = Modifier,
    onChange: (NativeAudioTrimRange) -> Unit, onScrub: () -> Unit, onScrubEnd: () -> Unit,
    enabled: Boolean = true) {
    val current by rememberUpdatedState(range)
    val change by rememberUpdatedState(onChange)
    val begin by rememberUpdatedState(onScrub)
    val end by rememberUpdatedState(onScrubEnd)
    var width by remember { mutableIntStateOf(1) }
    val density = LocalDensity.current
    val selectedWidth = with(density) { (width.toDp() * .34f).coerceAtLeast(112.dp).coerceAtMost(170.dp).toPx() }
    var initial = remember { range }
    var drag = remember { 0f }
    Canvas(modifier.fillMaxWidth().height(64.dp).testTag("audio-waveform")
        .onSizeChanged { width = it.width }
        .semantics {
            contentDescription = "Audio waveform. Drag to choose the section"
            progressBarRangeInfo = ProgressBarRangeInfo(range.startMs.toFloat(), bounds.firstMs.toFloat()..(bounds.lastMs - range.durationMs).toFloat())
            stateDescription = "${audioTrimTime(range.startMs)} to ${audioTrimTime(range.endMs)}"
            if (!enabled) disabled()
            setProgress { value -> if (enabled) { begin(); change(bounds.clip(value.toLong(), current.durationMs)); end() }; enabled }
        }.pointerInput(bounds, selectedWidth, enabled) {
            if (!enabled) return@pointerInput
            detectHorizontalDragGestures(onDragStart = { initial = current; drag = 0f; begin() },
                onHorizontalDrag = { event, amount ->
                    event.consume(); drag += amount
                    change(bounds.move(initial, (-drag / selectedWidth * initial.durationMs).roundToLong()))
                }, onDragEnd = { end() }, onDragCancel = { end() })
        }) {
        val left = (size.width - selectedWidth) / 2f
        val top = 10.dp.toPx()
        val frameHeight = size.height - top * 2
        drawRoundRect(Color(0xFFD5D5D5), Offset(left - 4.dp.toPx(), top - 4.dp.toPx()),
            Size(selectedWidth + 8.dp.toPx(), frameHeight + 8.dp.toPx()), CornerRadius(7.dp.toPx()))
        drawRoundRect(Color.White, Offset(left, top), Size(selectedWidth, frameHeight), CornerRadius(4.dp.toPx()))
        val step = 9.dp.toPx()
        val barWidth = 4.dp.toPx()
        val pixelsPerMs = selectedWidth / range.durationMs
        // Time-based positions keep the waveform attached to the recording while the window stays centered.
        val spacingMs = step / pixelsPerMs
        val firstIndex = kotlin.math.floor((range.startMs - left / pixelsPerMs) / spacingMs).toInt() - 1
        val count = (size.width / step).toInt() + 3
        repeat(count) { offset ->
            val time = (firstIndex + offset) * spacingMs
            if (time < bounds.firstMs || time > bounds.lastMs) return@repeat
            val x = left + (time - range.startMs) * pixelsPerMs
            val inWindow = x >= left + 4.dp.toPx() && x <= left + selectedWidth - 4.dp.toPx()
            val level = if (peaks.isEmpty()) .3f else peaks[((time / recordingDurationMs.coerceAtLeast(1) * peaks.size).toInt()).coerceIn(0, peaks.lastIndex)]
            val height = (8f + level.coerceIn(0f, 1f) * 23f).dp.toPx()
            drawRoundRect(if (inWindow) Color(0xFFD9D9D9) else Color.White.copy(alpha = .30f),
                Offset(x - barWidth / 2, size.height / 2 - height / 2), Size(barWidth, height), CornerRadius(barWidth / 2))
        }
        val cursor = left + (playbackMs.toFloat() / range.durationMs).coerceIn(0f, 1f) * selectedWidth
        val cursorHeight = 29.dp.toPx()
        drawRoundRect(Brush.verticalGradient(listOf(SautiColors.LogoPink, SautiColors.LogoOrange, Color(0xFFFFC521)),
            startY = size.height / 2 - cursorHeight / 2, endY = size.height / 2 + cursorHeight / 2),
            Offset(cursor.coerceIn(left + 9.dp.toPx(), left + selectedWidth - 9.dp.toPx()) - 2.dp.toPx(), size.height / 2 - cursorHeight / 2),
            Size(4.dp.toPx(), cursorHeight), CornerRadius(2.dp.toPx()))
    }
}

@Composable
internal fun NativeAudioTrimOverview(bounds: NativeAudioTrimBounds, range: NativeAudioTrimRange,
    playbackMs: Long, modifier: Modifier = Modifier, onChange: (NativeAudioTrimRange) -> Unit,
    onScrub: () -> Unit, onScrubEnd: () -> Unit, enabled: Boolean = true) {
    val current by rememberUpdatedState(range)
    val change by rememberUpdatedState(onChange)
    val begin by rememberUpdatedState(onScrub)
    val end by rememberUpdatedState(onScrubEnd)
    var width by remember { mutableIntStateOf(1) }
    val pad = with(LocalDensity.current) { 12.dp.toPx() }
    var initial = remember { range }
    var drag = remember { 0f }
    var handle = remember { 0 }
    fun x(time: Long) = pad + ((time - bounds.firstMs).toFloat() / (bounds.lastMs - bounds.firstMs)) * (width - 2 * pad)
    fun applyProgress(value: Float, start: Boolean): Boolean {
        if (!enabled) return false
        begin(); change(if (start) bounds.resizeStart(current, value.toLong()) else bounds.resizeEnd(current, value.toLong())); end(); return true
    }
    Box(modifier.fillMaxWidth().height(48.dp).onSizeChanged { width = it.width }) {
        Canvas(Modifier.fillMaxSize().pointerInput(bounds, width, enabled) {
            if (!enabled) return@pointerInput
            detectHorizontalDragGestures(onDragStart = { point ->
                initial = current; drag = 0f
                handle = if (abs(point.x - x(current.startMs)) <= abs(point.x - x(current.endMs))) 0 else 1
                begin()
            }, onHorizontalDrag = { event, amount ->
                event.consume(); drag += amount
                val delta = (drag / (width - 2 * pad).coerceAtLeast(1f) * (bounds.lastMs - bounds.firstMs)).roundToLong()
                change(if (handle == 0) bounds.resizeStart(initial, initial.startMs + delta) else bounds.resizeEnd(initial, initial.endMs + delta))
            }, onDragEnd = { end() }, onDragCancel = { end() })
        }) {
            val y = 12.dp.toPx()
            drawLine(Color.White.copy(alpha = .60f), Offset(pad, y), Offset(size.width - pad, y), 2.dp.toPx(), androidx.compose.ui.graphics.StrokeCap.Round)
            drawLine(SautiColors.LogoPink, Offset(x(range.startMs), y), Offset(x(range.endMs), y), 2.dp.toPx())
            drawCircle(SautiColors.LogoPink, 3.dp.toPx(), Offset(x(range.startMs), y))
            drawCircle(SautiColors.LogoOrange, 3.dp.toPx(), Offset(x(range.endMs), y))
            drawRoundRect(Color.White, Offset(x(range.startMs + playbackMs.coerceIn(0, range.durationMs)) - 4.dp.toPx(), y - 2.dp.toPx()),
                Size(8.dp.toPx(), 4.dp.toPx()), CornerRadius(2.dp.toPx()))
        }
        // Separate range controls remain reachable with TalkBack even when the dots are close together.
        listOf(true, false).forEach { start ->
            val time = if (start) range.startMs else range.endMs
            Box(Modifier.offset { androidx.compose.ui.unit.IntOffset((x(time) - pad).toInt().coerceIn(0, (width - 24.dp.roundToPx()).coerceAtLeast(0)), 0) }
                .width(24.dp).fillMaxHeight().semantics {
                    contentDescription = if (start) "Clip start" else "Clip end"
                    if (!enabled) disabled()
                    progressBarRangeInfo = ProgressBarRangeInfo(time.toFloat(), if (start)
                        maxOf(bounds.firstMs, range.endMs - bounds.maximumDuration).toFloat()..(range.endMs - bounds.minimumDuration).toFloat()
                        else (range.startMs + bounds.minimumDuration).toFloat()..minOf(bounds.lastMs, range.startMs + bounds.maximumDuration).toFloat())
                    setProgress { applyProgress(it, start) }
                })
        }
    }
}
