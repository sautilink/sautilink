package com.sautilink.nativeapp.feature.posts

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.nio.ByteOrder
import kotlin.math.abs

/** Decode only the local audio track. No uploads, playback or synthetic waveform data. */
internal suspend fun localVideoWaveform(context: Context, uri: Uri, durationMs: Long): List<Float> = withContext(Dispatchers.IO) {
    require(durationMs > 0)
    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    try {
        extractor.setDataSource(context, uri, null)
        val index = (0 until extractor.trackCount).firstOrNull {
            extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: return@withContext emptyList()
        extractor.selectTrack(index)
        val input = extractor.getTrackFormat(index)
        val codec = MediaCodec.createDecoderByType(requireNotNull(input.getString(MediaFormat.KEY_MIME)))
        decoder = codec
        codec.configure(input, null, null, 0); codec.start()
        val peaks = FloatArray(512)
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var channels = input.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var rate = input.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var encoding = AudioFormat.ENCODING_PCM_16BIT
        val deadline = SystemClock.elapsedRealtime() + 30_000
        while (true) {
            ensureActive()
            check(SystemClock.elapsedRealtime() < deadline) { "Waveform analysis timed out" }
            if (!inputDone) {
                val slot = codec.dequeueInputBuffer(5_000)
                if (slot >= 0) {
                    val buffer = requireNotNull(codec.getInputBuffer(slot))
                    val size = extractor.readSampleData(buffer, 0)
                    if (size < 0) {
                        codec.queueInputBuffer(slot, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true
                    } else {
                        codec.queueInputBuffer(slot, 0, size, extractor.sampleTime, 0); extractor.advance()
                    }
                }
            }
            when (val slot = codec.dequeueOutputBuffer(info, 5_000)) {
                MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> codec.outputFormat.let { format ->
                    channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    encoding = if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) format.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
                }
                else -> if (slot >= 0) {
                    try {
                        codec.getOutputBuffer(slot)?.let { data ->
                            data.order(ByteOrder.nativeOrder())
                            val bytes = if (encoding == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2
                            check(encoding == AudioFormat.ENCODING_PCM_FLOAT || encoding == AudioFormat.ENCODING_PCM_16BIT)
                            val samples = info.size / bytes
                            // Include every sample: periodic subsampling can erase tones at its own frequency.
                            for (sample in 0 until samples) {
                                val timeUs = info.presentationTimeUs + sample.toLong() * 1_000_000 / (channels.coerceAtLeast(1) * rate.coerceAtLeast(1))
                                val bucket = (timeUs * peaks.size / (durationMs * 1000)).toInt().coerceIn(0, peaks.lastIndex)
                                val position = info.offset + sample * bytes
                                val level = if (bytes == 4) abs(data.getFloat(position)) else abs(data.getShort(position).toInt()) / 32768f
                                if (level.isFinite()) peaks[bucket] = maxOf(peaks[bucket], level.coerceIn(0f, 1f))
                            }
                        }
                    } finally { codec.releaseOutputBuffer(slot, false) }
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
        }
        val ceiling = peaks.maxOrNull() ?: 0f
        if (ceiling < .001f) peaks.toList() else peaks.map { it / ceiling }
    } finally {
        decoder?.let { try { it.stop() } finally { it.release() } }
        extractor.release()
    }
}
