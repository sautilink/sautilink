package com.sautilink.nativeapp.feature.posts

import kotlin.math.roundToInt

/** Local editing limits mirror the existing upload validator; they grant no server permissions. */
internal object NativeMediaEditPolicy {
    const val MAX_VIDEO_MS = 60_000L
    data class Crop(val left: Int, val top: Int, val width: Int, val height: Int)
    data class Trim(val startMs: Long, val endMs: Long) {
        val durationMs get() = endMs - startMs
    }
    fun trim(durationMs: Long, startMs: Long = 0L, lengthMs: Long = MAX_VIDEO_MS,
        maximumMs: Long = MAX_VIDEO_MS): Trim {
        require(durationMs > 0L)
        require(maximumMs in 1..MAX_VIDEO_MS)
        val minimum = minOf(1_000L, durationMs)
        val start = startMs.coerceIn(0L, durationMs - minimum)
        val length = lengthMs.coerceIn(minOf(minimum, maximumMs), maximumMs)
        return Trim(start, start + minOf(durationMs - start, length))
    }
    fun validTrim(durationMs: Long, startMs: Long, endMs: Long, maximumMs: Long = MAX_VIDEO_MS): Boolean =
        maximumMs in 1..MAX_VIDEO_MS && durationMs > 0 && startMs >= 0 && endMs <= durationMs && endMs > startMs && endMs - startMs <= maximumMs

    fun crop(width: Int, height: Int, aspect: Float?, zoom: Float, panX: Float, panY: Float): Crop {
        require(width > 0 && height > 0)
        val ratio = aspect?.takeIf { it.isFinite() && it > 0 } ?: (width.toFloat() / height)
        var cropWidth = width.toFloat()
        var cropHeight = cropWidth / ratio
        if (cropHeight > height) { cropHeight = height.toFloat(); cropWidth = cropHeight * ratio }
        val scale = zoom.takeIf(Float::isFinite)?.coerceIn(1f, 3f) ?: 1f
        val w = (cropWidth / scale).roundToInt().coerceIn(1, width)
        val h = (cropHeight / scale).roundToInt().coerceIn(1, height)
        fun position(room: Int, pan: Float) = (room * (((pan.takeIf(Float::isFinite) ?: 0f).coerceIn(-1f, 1f) + 1f) / 2f)).roundToInt().coerceIn(0, room)
        return Crop(position(width - w, panX), position(height - h, panY), w, h)
    }
}

internal data class NativeImageEdits(val rotation: Int = 0, val aspect: Float? = null,
    val zoom: Float = 1f, val panX: Float = 0f, val panY: Float = 0f,
    val brightness: Float = 0f, val contrast: Float = 1f,
    val saturation: Float = 1f, val warmth: Float = 0f)

/** These edits are rendered into the exported photo; filters never affect video. */
internal enum class NativePhotoFilter(val label: String, val brightness: Float = 0f,
    val contrast: Float = 1f, val saturation: Float = 1f, val warmth: Float = 0f) {
    Original("Original"), Vivid("Vivid", .015f, 1.10f, 1.22f),
    Golden("Golden", .025f, 1.02f, 1.08f, .13f),
    Cool("Cool", .01f, 1.06f, .95f, -.11f),
    Soft("Soft", .035f, .88f, .88f, .025f),
    Mono("Mono", .01f, 1.12f, 0f),
    Film("Film", .02f, .92f, .72f, .075f);

    fun applyTo(edits: NativeImageEdits) = edits.copy(brightness = brightness,
        contrast = contrast, saturation = saturation, warmth = warmth)
}
