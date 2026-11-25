package com.sautilink.nativeapp.feature.music

internal data class NativeAudioTrimRange(val startMs: Long, val durationMs: Long) {
    val endMs: Long get() = startMs + durationMs
}

/** All gestures, accessibility actions and confirmation share the same licensed timeline. */
internal data class NativeAudioTrimBounds(val firstMs: Long, val lastMs: Long, val maximumMs: Long) {
    val maximumDuration get() = minOf(maximumMs, lastMs - firstMs, 180_000L)
    val minimumDuration get() = minOf(1000L, maximumDuration)
    init { require(firstMs >= 0 && lastMs > firstMs && maximumMs > 0) }
    fun clip(start: Long, duration: Long): NativeAudioTrimRange {
        val length = duration.coerceIn(minimumDuration, maximumDuration)
        return NativeAudioTrimRange(start.coerceIn(firstMs, lastMs - length), length)
    }
    fun move(range: NativeAudioTrimRange, deltaMs: Long) = clip(range.startMs + deltaMs, range.durationMs)
    fun resizeStart(range: NativeAudioTrimRange, start: Long): NativeAudioTrimRange {
        val next = start.coerceIn(maxOf(firstMs, range.endMs - maximumDuration), range.endMs - minimumDuration)
        return NativeAudioTrimRange(next, range.endMs - next)
    }
    fun resizeEnd(range: NativeAudioTrimRange, end: Long): NativeAudioTrimRange {
        val next = end.coerceIn(range.startMs + minimumDuration, minOf(lastMs, range.startMs + maximumDuration))
        return NativeAudioTrimRange(range.startMs, next - range.startMs)
    }
}

internal fun audioTrimTime(ms: Long): String = "${ms.coerceAtLeast(0) / 60000}:${(ms.coerceAtLeast(0) / 1000 % 60).toString().padStart(2, '0')}"
