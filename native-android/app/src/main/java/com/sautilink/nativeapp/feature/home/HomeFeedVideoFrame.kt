package com.sautilink.nativeapp.feature.home

/** Home limits portrait height to 1.5 times its width. Shorter videos stay natural.
 * Missing dimensions retain the previous stable fallback until metadata is available. */
internal data class HomeFeedVideoFrame(val aspectRatio: Float, val crop: Boolean)

internal fun homeFeedVideoFrame(width: Int, height: Int): HomeFeedVideoFrame {
    if (width <= 0 || height <= 0) return HomeFeedVideoFrame(.8f, false)
    val original = width.toFloat() / height
    val minimum = 2f / 3f
    return HomeFeedVideoFrame(original.coerceAtLeast(minimum), original < minimum)
}
