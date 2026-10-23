package com.sautilink.nativeapp.feature.posts

import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONObject
import java.io.EOFException
import java.io.File
import java.io.RandomAccessFile
import java.io.InputStream
import java.io.IOException

internal fun readBoundedPostUploadJson(input: InputStream): JSONObject {
    val buffer = ByteArray(16_385)
    var read = 0
    while (read < buffer.size) {
        val count = input.read(buffer, read, buffer.size - read)
        if (count < 0) break
        read += count
    }
    if (read > 16_384) throw IOException("Media response was too large.")
    return JSONObject(String(buffer, 0, read, Charsets.UTF_8))
}

internal object NativePostUploadPolicy {
    const val IMAGE_MAX_BYTES = NativePostMediaPolicy.MAX_IMAGE_BYTES
    const val VIDEO_MAX_BYTES = NativePostMediaPolicy.MAX_VIDEO_BYTES
    const val VIDEO_MAX_DURATION_MS = NativePostMediaPolicy.MAX_VIDEO_MS
    const val PART_BYTES = 8L * 1024 * 1024
    const val IO_BUFFER_BYTES = 64 * 1024
    private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

    fun imageSizeAllowed(bytes: Long): Boolean = bytes in 1..IMAGE_MAX_BYTES
    fun videoSizeAllowed(bytes: Long): Boolean = bytes in 1..VIDEO_MAX_BYTES
    fun videoDurationAllowed(milliseconds: Long): Boolean = milliseconds in 1..VIDEO_MAX_DURATION_MS

    fun plan(id: String, bytes: Long, kind: String, type: String, begin: JSONObject): NativePostUploadPlan {
        require(uuid.matches(id)) { "Invalid media reference." }
        require((kind == "image" && type in setOf("image/jpeg", "image/png", "image/webp") && imageSizeAllowed(bytes))
            || (kind == "video" && type == "video/mp4" && videoSizeAllowed(bytes))) { "Invalid media size or type." }
        val upload = "/api/sauti-media/upload/$id"
        require(begin.optString("upload_url") == upload) { "Invalid upload destination." }
        val chunk = begin.optJSONObject("chunk_upload")
        if (kind != "video" || bytes <= PART_BYTES) {
            require(!begin.has("chunk_upload")) { "Unexpected upload parts." }
            return NativePostUploadPlan(upload, bytes, 1, false, "")
        }
        require(chunk != null) { "Video upload parts are unavailable. Try again." }
        val count = ((bytes + PART_BYTES - 1) / PART_BYTES).toInt()
        // Exact relative paths bind every request to the begin ID. No authority,
        // redirects, fragments, alternate paths or extra query keys are allowed.
        require(chunk.opt("part_size_bytes")?.toString()?.toLongOrNull() == PART_BYTES
            && chunk.opt("part_count")?.toString()?.toIntOrNull() == count
            && count in 2..32
            && chunk.optString("part_url") == "$upload?part={part}"
            && chunk.optString("complete_url") == "$upload?complete=1") { "Invalid video upload session." }
        return NativePostUploadPlan(upload, bytes, count, true, "$upload?complete=1")
    }
}

internal data class NativePostUploadPlan(
    val uploadPath: String,
    val totalBytes: Long,
    val partCount: Int,
    val chunked: Boolean,
    val completePath: String
) {
    fun offset(part: Int): Long {
        require(part in 1..partCount)
        return if (chunked) (part - 1) * NativePostUploadPolicy.PART_BYTES else 0
    }
    fun length(part: Int): Long = minOf(if (chunked) NativePostUploadPolicy.PART_BYTES else totalBytes, totalBytes - offset(part))
    fun path(part: Int): String {
        offset(part) // Validate the part even for the single-PUT path.
        return if (chunked) "$uploadPath?part=$part" else uploadPath
    }
}

/** One bounded range; never copies a complete video or a complete part into RAM. */
internal class NativePostFileRangeBody(
    private val file: File,
    private val type: MediaType,
    private val offset: Long,
    private val length: Long,
    private val checkActiveOwner: () -> Unit,
    private val onProgress: (Int) -> Unit
) : RequestBody() {
    init {
        require(offset >= 0 && length > 0 && offset <= file.length() && length <= file.length() - offset)
    }
    override fun contentType(): MediaType = type
    override fun contentLength(): Long = length
    private fun checkRequestOwner() {
        try { checkActiveOwner() }
        catch (error: Exception) {
            // OkHttp request-body failures must be IOExceptions. Propagating a
            // coroutine/owner exception here can escape its dispatcher thread.
            throw IOException("Media upload was cancelled or the account changed.", error)
        }
    }
    override fun writeTo(sink: BufferedSink) {
        checkRequestOwner()
        val total = file.length().coerceAtLeast(1)
        var sent = 0L
        var last = -1
        RandomAccessFile(file, "r").use { input ->
            input.seek(offset)
            val buffer = ByteArray(NativePostUploadPolicy.IO_BUFFER_BYTES)
            while (sent < length) {
                checkRequestOwner()
                val read = input.read(buffer, 0, minOf(buffer.size.toLong(), length - sent).toInt())
                if (read < 0) throw EOFException("The selected media changed.")
                checkRequestOwner()
                sink.write(buffer, 0, read)
                sent += read
                val progress = (((offset + sent) * 100) / total).toInt().coerceIn(0, 99)
                if (progress >= last + 2 || sent == length) { last = progress; onProgress(progress) }
            }
        }
    }
}
