package com.sautilink.nativeapp.ui.components

import androidx.compose.runtime.*
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks

/** HLS Auto lets Media3 choose aligned segments using its measured bandwidth and buffer.
 * Quality changes update track selection; they never replace/reprepare the media item.
 */
@Composable
internal fun NativeHlsQualitySelection(player: Player?, hls: Boolean, preference: String) {
    DisposableEffect(player, hls, preference) {
        if (player == null) return@DisposableEffect onDispose { }
        fun apply() {
            val next = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                .setMaxVideoSize(Int.MAX_VALUE, Int.MAX_VALUE)
                .setForceLowestBitrate(false).setForceHighestSupportedBitrate(false)
            if (hls && preference != "auto") {
                val requested = if (preference == "data-saver") 360 else preference.toIntOrNull()
                val tracks = player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_VIDEO }
                    .flatMap { group -> (0 until group.length).filter { group.isTrackSupported(it) }.map { index ->
                        val format = group.getTrackFormat(index)
                        Triple(group, index, minOf(format.width, format.height).coerceAtLeast(0))
                    } }.filter { it.third > 0 }
                val chosen = if (requested == null) tracks.maxByOrNull { it.third }
                    else tracks.filter { it.third <= requested }.maxByOrNull { it.third } ?: tracks.minByOrNull { it.third }
                chosen?.let { next.addOverride(TrackSelectionOverride(it.first.mediaTrackGroup, it.second)) }
            }
            val parameters = next.build()
            if (parameters != player.trackSelectionParameters) player.trackSelectionParameters = parameters
        }
        val listener = object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) { apply() }
        }
        player.addListener(listener)
        apply()
        onDispose { player.removeListener(listener) }
    }
}

@Composable
internal fun rememberNativeHlsQualities(player: Player?): List<Int> {
    var result by remember(player) { mutableStateOf(emptyList<Int>()) }
    DisposableEffect(player) {
        if (player == null) return@DisposableEffect onDispose { }
        fun update(tracks: Tracks) {
            result = tracks.groups.filter { it.type == C.TRACK_TYPE_VIDEO }.flatMap { group ->
                (0 until group.length).filter { group.isTrackSupported(it) }.map { index ->
                    val format = group.getTrackFormat(index)
                    minOf(format.width, format.height)
                }
            }.filter { it > 0 }.distinct().sorted()
        }
        val listener = object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) { update(tracks) }
        }
        update(player.currentTracks)
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    return result
}
