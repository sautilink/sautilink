package com.sautilink.nativeapp.ui.components

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import java.io.EOFException
import java.net.ProtocolException

/**
 * The published video endpoint may return only 1 MiB of an open-ended Range.
 * Expose the complete resource to Media3, and join consecutive responses here
 * instead of making the extractor recover through EOFException for each chunk.
 * A cold quality URL can initially serve the original; keep that choice stable
 * across chunks and seeks so offsets never cross into a newly warmed rendition.
 * No media bytes, credentials or decisions are persisted on disk.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal class NativeVideoDataSourceFactory(
    private val http: HttpDataSource.Factory,
    private val retainRepresentation: (String) -> Boolean = { false },
) : DataSource.Factory {
    private data class Representation(val uri: Uri, val total: Long, val etag: String, val variant: String)
    private val representations = LinkedHashMap<String, Representation>(32, .75f, true)

    /** The byte cache may retain partial original-fallback spans after many clips.
     * Its admitted identities keep their representation until that cache closes;
     * only identities without cached bytes participate in the 32-entry LRU.
     * The callback is a nonblocking memory lookup, never a Cache/SQLite operation.
     */
    private fun trimUncachedRepresentations() {
        var uncached = representations.keys.count { !retainRepresentation(it) }
        if (uncached <= 32) return
        val iterator = representations.entries.iterator()
        while (uncached > 32 && iterator.hasNext()) {
            if (!retainRepresentation(iterator.next().key)) { iterator.remove(); uncached-- }
        }
    }

    override fun createDataSource(): DataSource = VideoSource(http.createDataSource())

    private inner class VideoSource(private val upstream: HttpDataSource) : DataSource {
        private var spec: DataSpec? = null
        private var sourceKey: String? = null
        private var representation: Representation? = null
        private var uri: Uri? = null
        private var position = 0L
        private var remaining = C.LENGTH_UNSET.toLong()
        private var chunkRemaining = C.LENGTH_UNSET.toLong()
        private var upstreamOpen = false

        override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)
        override fun getUri(): Uri? = if (upstreamOpen) upstream.uri else uri
        override fun getResponseHeaders(): Map<String, List<String>> = if (upstreamOpen) upstream.responseHeaders else emptyMap()

        override fun open(dataSpec: DataSpec): Long {
            check(spec == null)
            spec = dataSpec
            position = dataSpec.position
            remaining = dataSpec.length
            sourceKey = publishedVideoKey(dataSpec)
            representation = sourceKey?.let { synchronized(representations) { representations[it] } }
            uri = representation?.uri ?: dataSpec.uri
            representation?.let { pinned ->
                if (position > pinned.total) throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
                remaining = remainingLength(dataSpec.length, pinned.total - position)
                if (remaining == 0L) return 0L
            }
            openChunk()
            return remaining
        }

        private fun openChunk() {
            val initial = checkNotNull(spec)
            val request = initial.buildUpon().setUri(checkNotNull(uri)).setPosition(position)
                .setLength(remaining).build()
            // close() must also run after a partially successful/failed open.
            upstreamOpen = true
            val available = upstream.open(request)
            if (sourceKey == null) {
                remaining = available
                chunkRemaining = available
                return
            }
            val headers = upstream.responseHeaders
            val range = header(headers, "Content-Range")?.let(::videoByteRange)
            val fullLength = header(headers, "Content-Length")?.toLongOrNull()?.takeIf { it >= position }
            val total = range?.total ?: if (upstream.responseCode == 200) fullLength
                ?: available.takeIf { it >= 0L && initial.length == C.LENGTH_UNSET.toLong() && it <= Long.MAX_VALUE - position }
                    ?.let { position + it } else null
            if (upstream.responseCode == 206 && (range == null || range.start != position)) {
                throw ProtocolException("Invalid video byte range")
            }
            val etag = header(headers, "ETag")
            val variant = header(headers, "X-Sauti-Media-Variant")
            val pinned = representation
            if (pinned != null && (total != pinned.total || etag != pinned.etag || variant != pinned.variant)) {
                throw ProtocolException("Video representation changed during playback")
            }
            if (pinned == null && total != null && !etag.isNullOrBlank() &&
                (variant in setOf("original", "original-index-v1") || variant?.matches(Regex("video-v2;q=(240|360|480|720|1080)")) == true)) {
                val stableUri = if (variant in setOf("original", "original-index-v1")) checkNotNull(uri).buildUpon().clearQuery().build() else checkNotNull(uri)
                val selected = Representation(stableUri, total, etag, checkNotNull(variant))
                val remembered = synchronized(representations) {
                    representations[sourceKey]?.also {
                        if (it != selected) throw ProtocolException("Concurrent video representation changed")
                    } ?: selected.also {
                        representations[checkNotNull(sourceKey)] = it
                        trimUncachedRepresentations()
                    }
                }
                representation = remembered
                uri = remembered.uri
            }
            if (range != null && range.end < range.total - 1L && representation == null) {
                throw ProtocolException("Partial video response has no stable representation")
            }
            remaining = if (total != null) remainingLength(remaining, total - position) else available
            chunkRemaining = range?.let { it.end - it.start + 1L } ?: available
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            check(spec != null)
            if (length == 0) return 0
            if (remaining == 0L) return C.RESULT_END_OF_INPUT
            if (chunkRemaining == 0L) {
                // Advance before asking Media3 to read again; a chunk boundary is not file EOF.
                closeUpstream()
                openChunk()
            }
            val wanted = minOf(length.toLong(), remaining.takeIf { it >= 0L } ?: Long.MAX_VALUE,
                chunkRemaining.takeIf { it >= 0L } ?: Long.MAX_VALUE).toInt()
            val count = upstream.read(buffer, offset, wanted)
            if (count == C.RESULT_END_OF_INPUT) {
                if (remaining > 0L || chunkRemaining > 0L) throw EOFException("Video response ended before its declared range")
                return count
            }
            position += count
            if (remaining >= 0L) remaining -= count
            if (chunkRemaining >= 0L) chunkRemaining -= count
            return count
        }

        private fun closeUpstream() {
            if (upstreamOpen) {
                upstreamOpen = false
                upstream.close()
            }
        }

        override fun close() {
            try { closeUpstream() } finally {
                spec = null
                sourceKey = null
                representation = null
                uri = null
                remaining = C.LENGTH_UNSET.toLong()
                chunkRemaining = C.LENGTH_UNSET.toLong()
            }
        }
    }
}

private fun header(headers: Map<String, List<String>>, name: String): String? =
    headers.entries.singleOrNull { it.key.equals(name, ignoreCase = true) }?.value?.singleOrNull()

private fun remainingLength(requested: Long, available: Long): Long =
    if (requested == C.LENGTH_UNSET.toLong()) available else minOf(requested, available)

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private fun publishedVideoKey(spec: DataSpec): String? {
    val uri = spec.uri
    return uri.toString().takeIf {
        spec.httpMethod == DataSpec.HTTP_METHOD_GET && uri.scheme == "https" && uri.host == "sautilink.com" &&
            uri.port == -1 && uri.userInfo == null && uri.fragment == null &&
            uri.path?.matches(Regex("/api/sauti-media/[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")) == true &&
            (uri.encodedQuery == null || uri.encodedQuery?.matches(Regex("quality=(240|360|480|720|1080)")) == true)
    }
}

internal data class VideoByteRange(val start: Long, val end: Long, val total: Long)

internal fun videoByteRange(value: String): VideoByteRange? {
    val match = Regex("bytes ([0-9]+)-([0-9]+)/([0-9]+)").matchEntire(value.trim()) ?: return null
    val start = match.groupValues[1].toLongOrNull() ?: return null
    val end = match.groupValues[2].toLongOrNull() ?: return null
    val total = match.groupValues[3].toLongOrNull() ?: return null
    return VideoByteRange(start, end, total).takeIf { start >= 0L && end >= start && end < total }
}
