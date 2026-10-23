package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.ui.components.NativePlaybackRead
import com.sautilink.nativeapp.ui.components.nativePlaybackReusableDelay

/** Only metadata may start before the existing 58% playback intent. Token-driven
 * player/resources and all media-byte reads remain gated by actual playback.
 */
internal fun feedVideoMetadataEligible(publishedAdaptive: Boolean, sessionReady: Boolean,
    foreground: Boolean, currentMedia: Boolean, visibleFraction: Float,
    autoplay: Boolean, started: Boolean, userInitiated: Boolean, manualPaused: Boolean): Boolean =
    publishedAdaptive && sessionReady && foreground && currentMedia && !manualPaused &&
        visibleFraction.isFinite() && visibleFraction > 0f && visibleFraction <= 1f &&
        (autoplay || started || userInitiated)

/** One instance belongs to one mounted auth/account/media/path scope. Snapshot
 * failures synchronously at the FIRST actual intent, not in a later coroutine:
 * an in-flight warm-up must finish normally, even if it subsequently fails.
 * There is no cache, request, credential copy, or additional async job here.
 */
internal class FeedVideoWarmupHandoff {
    private var consumed = false

    fun onAutoplayIntent(read: NativePlaybackRead, owner: String?, mediaId: String,
        origin: String, metadataPath: String, now: Long, allowed: Boolean): Boolean {
        if (consumed) return false
        consumed = true
        if (!allowed || owner == null || read.loading || !read.failure || read.denied ||
            read.ownerId?.let { it != owner } == true || read.source?.mediaId?.let { it != mediaId } == true)
            return false
        // A transient refresh failure can coexist with a healthy original grant.
        // Keep it and the resolver's existing refresh schedule.
        if (nativePlaybackReusableDelay(read, owner, mediaId, origin, metadataPath, now) != null) return false
        // Initial metadata failure can install an MP4 fallback. It has never
        // played; do not start it while this one recovery requests its descriptor.
        // Successful MP4 descriptors have failure=false and are left untouched.
        if (read.source?.hls != true) read.source = null
        read.retry()
        return true
    }

    /** The normal explicit Play/Retry path already owns its recovery behavior. */
    fun consumeManualIntent() { consumed = true }
}
