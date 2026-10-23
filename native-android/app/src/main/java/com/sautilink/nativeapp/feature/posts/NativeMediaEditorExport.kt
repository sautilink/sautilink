package com.sautilink.nativeapp.feature.posts

import android.content.Context
import android.graphics.*
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.transformer.*
import kotlinx.coroutines.*
import java.io.File
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal data class NativeEditedMedia(val uri: Uri, val ownedFile: File? = null)

internal suspend fun loadEditableBitmap(context: Context, uri: Uri, maximum: Int = 2048): Bitmap = withContext(Dispatchers.IO) {
    if (Build.VERSION.SDK_INT >= 28) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            val scale = minOf(1.0, maximum.toDouble() / maxOf(info.size.width, info.size.height))
            decoder.setTargetSize(maxOf(1, (info.size.width * scale).toInt()), maxOf(1, (info.size.height * scale).toInt()))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Could not read this image." }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maximum) sample *= 2
        val decoded = context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: error("Could not open this image.")
        val orientation = runCatching {
            context.contentResolver.openFileDescriptor(uri, "r")?.use {
                ExifInterface(it.fileDescriptor).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            }
        }.getOrNull()
        val matrix = Matrix().apply {
            when (orientation) {
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
                ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
                ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(270f); postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(270f)
            }
        }
        if (matrix.isIdentity) decoded else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also { decoded.recycle() }
    }
}

internal fun renderEditedBitmap(source: Bitmap, edits: NativeImageEdits): Bitmap {
    val rotation = Matrix().apply { postRotate(edits.rotation.toFloat()) }
    val rotated = if (edits.rotation % 360 == 0) source else Bitmap.createBitmap(source, 0, 0, source.width, source.height, rotation, true)
    try {
        val crop = NativeMediaEditPolicy.crop(rotated.width, rotated.height, edits.aspect, edits.zoom, edits.panX, edits.panY)
        val result = Bitmap.createBitmap(crop.width, crop.height, Bitmap.Config.ARGB_8888)
        result.setHasAlpha(source.hasAlpha())
        val contrast = edits.contrast.coerceIn(.7f, 1.3f)
        val offset = 128f * (1f - contrast) + edits.brightness.coerceIn(-.3f, .3f) * 255f
        val saturation = ColorMatrix().apply { setSaturation(edits.saturation.coerceIn(0f, 1.5f)) }
        val warmth = edits.warmth.coerceIn(-.2f, .2f)
        val adjustment = ColorMatrix(floatArrayOf(contrast * (1f + warmth),0f,0f,0f,offset,
            0f,contrast,0f,0f,offset, 0f,0f,contrast * (1f - warmth),0f,offset, 0f,0f,0f,1f,0f))
        adjustment.postConcat(saturation)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            colorFilter = ColorMatrixColorFilter(adjustment)
        }
        Canvas(result).drawBitmap(rotated, Rect(crop.left, crop.top, crop.left + crop.width, crop.top + crop.height), Rect(0, 0, crop.width, crop.height), paint)
        return result
    } finally { if (rotated !== source) rotated.recycle() }
}

internal suspend fun exportEditedImage(context: Context, bitmap: Bitmap, edits: NativeImageEdits, maximumBytes: Long = NativePostMediaPolicy.MAX_IMAGE_BYTES): NativeEditedMedia {
    val output = File(context.cacheDir, "sauti-edit-${UUID.randomUUID()}.${if (bitmap.hasAlpha()) "png" else "jpg"}")
    try {
        return withContext(Dispatchers.IO) {
            val result = renderEditedBitmap(bitmap, edits)
            try {
                ensureActive()
                output.outputStream().use { check(result.compress(if (result.hasAlpha()) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 90, it)) { "Could not save the edited image." } }
                check(output.length() in 1..maximumBytes) { "The edited image is above ${maximumBytes / (1024 * 1024)} MB. Crop it further or choose another image." }
                ensureActive()
                NativeEditedMedia(Uri.fromFile(output), output)
            } finally { result.recycle() }
        }
    } catch (error: Throwable) { output.delete(); throw error }
}

internal suspend fun localVideoDuration(context: Context, uri: Uri): Long = withContext(Dispatchers.IO) {
    val reader = MediaMetadataRetriever()
    try {
        reader.setDataSource(context, uri)
        reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.takeIf { it > 0 }
            ?: error("Could not read this video's duration.")
    } finally { reader.release() }
}

internal suspend fun localVideoThumbnail(context: Context, uri: Uri): Bitmap? = withContext(Dispatchers.IO) {
    val reader = MediaMetadataRetriever()
    try {
        reader.setDataSource(context, uri)
        if (Build.VERSION.SDK_INT >= 27) reader.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 640, 640)
        else reader.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)?.let { frame ->
            val ratio = minOf(1f, 640f / maxOf(frame.width, frame.height))
            Bitmap.createScaledBitmap(frame, maxOf(1, (frame.width * ratio).toInt()), maxOf(1, (frame.height * ratio).toInt()), true).also { if (it !== frame) frame.recycle() }
        }
    } finally { reader.release() }
}

/** Export only the selected interval; the original picker item is never modified. */
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
internal suspend fun exportTrimmedVideo(context: Context, uri: Uri, durationMs: Long, trim: NativeMediaEditPolicy.Trim,
    maximumMs: Long = NativeMediaEditPolicy.MAX_VIDEO_MS,
    onProgress: (Int) -> Unit): NativeEditedMedia {
    var pendingOutput: File? = null
    try {
        return withContext(Dispatchers.Main.immediate) {
            require(NativeMediaEditPolicy.validTrim(durationMs, trim.startMs, trim.endMs, maximumMs)) { "Select a clip of ${maximumMs / 1000} seconds or less." }
            if (trim.startMs == 0L && trim.endMs == durationMs && context.contentResolver.getType(uri) == "video/mp4" &&
                localVideoDuration(context, uri) in 1..maximumMs) return@withContext NativeEditedMedia(uri)
            // AAC packets, edit lists and muxer timestamps can add a few samples
            // beyond a nominal clipping end (Samsung returned 30,080ms for 30s).
            // Leave a small margin only near the upload ceiling, then measure the
            // actual MP4. Never return a clip which the strict server will reject.
            val safetyMs = 150L
            var endMs = trim.startMs + minOf(trim.durationMs, (maximumMs - safetyMs).coerceAtLeast(1L))
            var lastProgress = 0
            repeat(3) {
                ensureActive()
                val output = File(context.cacheDir, "sauti-edit-${UUID.randomUUID()}.mp4")
                pendingOutput = output
                exportVideoInterval(context, uri, trim.startMs, endMs, output) { value ->
                    lastProgress = maxOf(lastProgress, value.coerceIn(0, 95)); onProgress(lastProgress)
                }
                ensureActive()
                val measuredMs = localVideoDuration(context, Uri.fromFile(output))
                if (measuredMs in 1..maximumMs) {
                    onProgress(100)
                    ensureActive()
                    return@withContext NativeEditedMedia(Uri.fromFile(output), output)
                }
                output.delete(); pendingOutput = null
                check(measuredMs > maximumMs) { "The exported video could not be read. Choose another clip." }
                endMs -= (measuredMs - maximumMs) + safetyMs
                check(endMs > trim.startMs) { "Could not prepare this video within the duration limit. Choose a shorter clip." }
            }
            error("Could not prepare this video within the duration limit. Choose a slightly shorter clip.")
        }
    } catch (error: Throwable) { pendingOutput?.delete(); throw error }
}

/** One bounded attempt. Retries always read the unchanged original, not a prior
 * encoded result, so they do not accumulate quality loss or touch source files.
 */
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
private suspend fun exportVideoInterval(context: Context, uri: Uri, startMs: Long, endMs: Long, output: File,
    onProgress: (Int) -> Unit): Unit = withContext(Dispatchers.Main.immediate) {
            suspendCancellableCoroutine { continuation ->
                val handler = Handler(Looper.getMainLooper())
                var poll: Runnable? = null
                val transformer = Transformer.Builder(context)
                    .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .addListener(object : Transformer.Listener {
                        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                            poll?.let(handler::removeCallbacks)
                            if (continuation.isActive) continuation.resume(Unit) else output.delete()
                        }
                        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                            poll?.let(handler::removeCallbacks); output.delete()
                            if (continuation.isActive) continuation.resumeWithException(IllegalStateException("Could not trim this video. Try another clip.", exportException))
                        }
                    }).build()
                poll = object : Runnable {
                    override fun run() {
                        if (!continuation.isActive) return
                        val progress = ProgressHolder()
                        if (transformer.getProgress(progress) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(progress.progress)
                        handler.postDelayed(this, 350)
                    }
                }
                continuation.invokeOnCancellation { handler.post { poll?.let(handler::removeCallbacks); transformer.cancel(); output.delete() } }
                try {
                    val item = MediaItem.Builder().setUri(uri).setClippingConfiguration(MediaItem.ClippingConfiguration.Builder()
                        .setStartPositionMs(startMs).setEndPositionMs(endMs).build()).build()
                    transformer.start(EditedMediaItem.Builder(item).build(), output.absolutePath)
                    handler.post(poll!!)
                } catch (error: Exception) {
                    transformer.cancel(); output.delete()
                    if (continuation.isActive) continuation.resumeWithException(error)
                }
            }
}
