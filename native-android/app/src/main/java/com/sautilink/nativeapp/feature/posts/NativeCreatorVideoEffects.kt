package com.sautilink.nativeapp.feature.posts

import android.content.Context
import android.graphics.ColorMatrix
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.media3.common.Effect
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.RgbMatrix
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal data class NativeVideoSize(val width: Int, val height: Int)

internal suspend fun creatorPausedFrame(context: Context, uri: Uri, timeMs: Long, size: NativeVideoSize): android.graphics.Bitmap? = withContext(Dispatchers.IO) {
    val reader = MediaMetadataRetriever()
    try {
        reader.setDataSource(context, uri)
        val scale = minOf(1f, 640f / maxOf(size.width, size.height))
        val width = (size.width * scale).toInt().coerceAtLeast(1)
        val height = (size.height * scale).toInt().coerceAtLeast(1)
        if (android.os.Build.VERSION.SDK_INT >= 27) reader.getScaledFrameAtTime(timeMs.coerceAtLeast(0) * 1000, MediaMetadataRetriever.OPTION_CLOSEST, width, height)
        else reader.getFrameAtTime(timeMs.coerceAtLeast(0) * 1000, MediaMetadataRetriever.OPTION_CLOSEST)
    } finally { reader.release() }
}

internal suspend fun localVideoSize(context: Context, uri: Uri): NativeVideoSize = withContext(Dispatchers.IO) {
    val reader = MediaMetadataRetriever()
    try {
        reader.setDataSource(context, uri)
        var width = reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
        var height = reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
        require(width > 0 && height > 0) { "Could not read this video's size." }
        if ((reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0) % 180 != 0) {
            val old = width; width = height; height = old
        }
        val scale = minOf(1f, 1920f / maxOf(width, height))
        NativeVideoSize(((width * scale).toInt() / 2 * 2).coerceAtLeast(2), ((height * scale).toInt() / 2 * 2).coerceAtLeast(2))
    } finally { reader.release() }
}

internal fun creatorColorMatrix(edits: NativeImageEdits): ColorMatrix {
    val contrast = edits.contrast.coerceIn(.7f, 1.3f)
    val offset = 128f * (1f - contrast) + edits.brightness.coerceIn(-.3f, .3f) * 255f
    val warmth = edits.warmth.coerceIn(-.2f, .2f)
    return ColorMatrix(floatArrayOf(contrast * (1 + warmth),0f,0f,0f,offset,
        0f,contrast,0f,0f,offset, 0f,0f,contrast * (1 - warmth),0f,offset, 0f,0f,0f,1f,0f)).apply {
        postConcat(ColorMatrix().apply { setSaturation(edits.saturation.coerceIn(0f, 1.5f)) })
    }
}

@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
internal fun creatorVideoEffects(context: Context, edits: NativeImageEdits, size: NativeVideoSize): List<Effect> {
    val effects = mutableListOf<Effect>()
    if (edits.brightness != 0f || edits.contrast != 1f || edits.saturation != 1f || edits.warmth != 0f) {
        val matrix = creatorColorMatrix(edits).array
        val rgb = FloatArray(16)
        for (row in 0..3) for (column in 0..3) rgb[column * 4 + row] =
            if (column == 3 && row < 3) matrix[row * 5 + 4] / 255f else matrix[row * 5 + column]
        effects += object : RgbMatrix { override fun getMatrix(presentationTimeUs: Long, useHdr: Boolean) = rgb }
    }
    if (edits.overlay.text.isNotBlank()) {
        effects += Presentation.createForWidthAndHeight(size.width, size.height, Presentation.LAYOUT_SCALE_TO_FIT)
        effects += OverlayEffect(listOf(BitmapOverlay.createStaticBitmapOverlay(
            creatorTextBitmap(context, size.width, size.height, edits.overlay))))
    }
    return effects
}
