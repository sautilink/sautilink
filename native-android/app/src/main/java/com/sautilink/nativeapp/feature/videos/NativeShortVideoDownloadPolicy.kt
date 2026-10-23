package com.sautilink.nativeapp.feature.videos

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.URI

internal const val SHORT_VIDEO_DOWNLOAD_MAX_BYTES = 250L * 1024 * 1024
private val downloadUuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
internal fun nativeShortVideoDownloadUrl(origin: String, mediaId: String): String {
    require(origin in setOf("https://sautilink.com", "https://test.sautilink.com") && downloadUuid.matches(mediaId))
    val target = URI("$origin/api/sauti-media/$mediaId/download")
    require(target.rawQuery == null && target.fragment == null && target.userInfo == null && target.port == -1)
    return target.toString()
}
internal fun nativeShortVideoDownloadIdentityValid(mediaId: String, postId: String): Boolean =
    downloadUuid.matches(mediaId) && downloadUuid.matches(postId)

internal data class NativeShortVideoDownloadMetadata(val bytes: Long, val etag: String)
internal fun nativeShortVideoDownloadMetadata(status: Int, contentType: String?, length: String?, etag: String?): NativeShortVideoDownloadMetadata {
    if (status != 200 || contentType?.substringBefore(';')?.trim()?.lowercase() != "video/mp4")
        throw IOException("Video download is unavailable")
    val size = length?.toLongOrNull()?.takeIf { it in 1..SHORT_VIDEO_DOWNLOAD_MAX_BYTES }
        ?: throw IOException("Invalid video download size")
    if (etag == null || !Regex("\"[A-Za-z0-9_-]{1,128}\"").matches(etag)) throw IOException("Invalid video download version")
    return NativeShortVideoDownloadMetadata(size, etag)
}

private fun downloadedMp4Header(bytes: ByteArray, length: Int): Boolean {
    var offset = 0
    while (offset + 8 <= length) {
        val size = (0..3).fold(0L) { total, index -> (total shl 8) or (bytes[offset + index].toLong() and 255) }
        val type = String(bytes, offset + 4, 4, Charsets.US_ASCII)
        if (type == "ftyp") return size >= 16 && offset + 16 <= length
        if (size < 8 || size > length - offset) return false
        offset += size.toInt()
    }
    return false
}

/** Exactly one 64 KiB transfer buffer plus one bounded MP4 header. The service
 * owns pending-output cleanup; no partial data is published by this function.
 */
internal fun copyNativeShortVideoDownload(input: InputStream, output: OutputStream, expectedBytes: Long,
    active: () -> Boolean, progress: (Long) -> Unit = {}): Long {
    if (expectedBytes !in 1..SHORT_VIDEO_DOWNLOAD_MAX_BYTES) throw IOException("Invalid video download size")
    val buffer = ByteArray(64 * 1024)
    val header = ByteArray(64 * 1024)
    var headerLength = 0
    var total = 0L
    while (true) {
        if (!active()) throw IOException("Video download cancelled")
        val count = input.read(buffer)
        if (!active()) throw IOException("Video download cancelled")
        if (count < 0) break
        if (count == 0) continue
        if (total + count > expectedBytes) throw IOException("Video download size changed")
        val headerCount = minOf(count, header.size - headerLength)
        if (headerCount > 0) { buffer.copyInto(header, headerLength, 0, headerCount); headerLength += headerCount }
        if (!active()) throw IOException("Video download cancelled")
        output.write(buffer, 0, count)
        total += count
        progress(total)
    }
    if (total != expectedBytes || !downloadedMp4Header(header, headerLength) || !active())
        throw IOException("Video download could not be verified")
    output.flush()
    return total
}
