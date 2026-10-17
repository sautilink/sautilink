package com.sautilink.nativeapp.ui.components

internal enum class VideoDoubleTapAction { BACKWARD, LIKE, FORWARD }

internal fun videoDoubleTapAction(x: Float, width: Int): VideoDoubleTapAction = when {
    width <= 0 -> VideoDoubleTapAction.LIKE
    x < width * .42f -> VideoDoubleTapAction.BACKWARD
    x > width * .58f -> VideoDoubleTapAction.FORWARD
    else -> VideoDoubleTapAction.LIKE
}

internal fun videoSeekTarget(positionMs: Long, deltaMs: Long, durationMs: Long): Long {
    val target = (positionMs.coerceAtLeast(0L) + deltaMs).coerceAtLeast(0L)
    return if (durationMs > 0L) target.coerceAtMost(durationMs) else target
}
