package com.sautilink.nativeapp.ui.components

import android.content.Context
import android.util.Pair
import androidx.media3.common.C
import androidx.media3.common.TrackGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.RendererCapabilities
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import androidx.media3.exoplayer.trackselection.MappingTrackSelector.MappedTrackInfo

/** The same short-edge rule as visible HLS playback, including portrait media.
 * An upcoming manual-quality source must never preload an unrelated Auto track. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal class NativePreloadTrackSelector(context: Context, private val preference: () -> String) : DefaultTrackSelector(context) {
    private data class Candidate(val renderer: Int, val group: TrackGroup, val index: Int, val shortEdge: Int)
    override fun selectVideoTrack(mappedTrackInfo: MappedTrackInfo,
        rendererFormatSupports: Array<Array<IntArray>>, mixedMimeTypeSupports: IntArray,
        params: Parameters, selectedAudioLanguage: String?): Pair<ExoTrackSelection.Definition, Int>? {
        val quality = NativeVideoQualityPolicy.normalizePreference(preference())
        if (quality == "auto") return super.selectVideoTrack(mappedTrackInfo, rendererFormatSupports,
            mixedMimeTypeSupports, params, selectedAudioLanguage)
        val candidates = buildList {
            for (renderer in 0 until mappedTrackInfo.rendererCount) {
                if (mappedTrackInfo.getRendererType(renderer) != C.TRACK_TYPE_VIDEO) continue
                val groups = mappedTrackInfo.getTrackGroups(renderer)
                for (groupIndex in 0 until groups.length) {
                    val group = groups[groupIndex]
                    for (track in 0 until group.length) {
                        if (RendererCapabilities.getFormatSupport(rendererFormatSupports[renderer][groupIndex][track]) != C.FORMAT_HANDLED) continue
                        val format = group.getFormat(track)
                        val edge = minOf(format.width, format.height)
                        if (edge > 0) add(Candidate(renderer, group, track, edge))
                    }
                }
            }
        }
        val requested = if (quality == "data-saver") 360 else quality.toIntOrNull()
        val chosen = if (requested == null) candidates.maxByOrNull { it.shortEdge }
            else candidates.filter { it.shortEdge <= requested }.maxByOrNull { it.shortEdge }
                ?: candidates.minByOrNull { it.shortEdge }
        return chosen?.let { Pair(ExoTrackSelection.Definition(it.group, it.index), it.renderer) }
            ?: super.selectVideoTrack(mappedTrackInfo, rendererFormatSupports, mixedMimeTypeSupports, params, selectedAudioLanguage)
    }
}
