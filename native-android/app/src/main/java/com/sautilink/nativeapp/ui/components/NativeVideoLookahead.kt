package com.sautilink.nativeapp.ui.components

import androidx.compose.runtime.*
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.sync.Semaphore

/** The loaded feed is the only inventory. No speculative feed/profile query or
 * private media discovery is needed to prepare these five upcoming videos. */
internal fun videoLookaheadIndices(current: Int, total: Int): List<Int> =
    if (current < -1 || total <= 0 || current >= total) emptyList()
    else (current + 1 until minOf(total.toLong(), current.toLong() + 1L + NATIVE_VIDEO_LOOKAHEAD).toInt()).toList()

internal fun videoMetadataWarmupEligible(foreground: Boolean, online: Boolean, autoplay: Boolean,
    saveData: Boolean, stressed: Boolean, denied: Boolean): Boolean =
    foreground && online && autoplay && !saveData && !stressed && !denied

/** Start only with six seconds ready; a healthy continuing queue stops below
 * three. Small buffer fluctuations must not repeatedly discard/reload five manifests. */
internal fun videoPreloadRunway(bufferedMs: Long, continuing: Boolean): Long =
    if (continuing && bufferedMs >= 3_000L) maxOf(6_000L,bufferedMs) else bufferedMs

/** Two metadata requests at a time, including later grant refreshes. The visible
 * player's resolver does not wait behind this speculative-only semaphore. */
@Composable
internal fun rememberVideoLookaheadReads(auth: StagingAuthClient, ids: List<String>,
    retained: Map<String, NativePlaybackRead>, enabled: Boolean): List<Pair<String, NativePlaybackRead>> {
    val permit = remember(auth, auth.account?.id) { Semaphore(2) }
    val bounded = ids.distinct().take(NATIVE_VIDEO_LOOKAHEAD)
    val result = mutableListOf<Pair<String, NativePlaybackRead>>()
    var pending = 0
    for (id in bounded) key(id) {
        val read = retained.getValue(id)
        val settled = read.source != null || read.failure || read.denied
        val start = settled || pending < 2
        if (!settled) pending++
        val resolved = rememberNativePlaybackSource(auth, id, "/api/sauti-media/$id/playback",
            enabled = enabled && start, retainedRead = read, metadataPermit = permit)
        result += id to resolved
    }
    return result
}
