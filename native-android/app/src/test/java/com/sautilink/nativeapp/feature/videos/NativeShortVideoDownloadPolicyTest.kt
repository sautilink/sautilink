package com.sautilink.nativeapp.feature.videos

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

class NativeShortVideoDownloadPolicyTest {
    private val media = "11111111-1111-4111-8111-111111111111"
    private val post = "22222222-2222-4222-8222-222222222222"
    private val etag = "\"0123456789abcdef-2\""

    @Test fun destinationIsOnlyAnExactFirstPartyMediaRoute() {
        assertEquals("https://sautilink.com/api/sauti-media/$media/download", nativeShortVideoDownloadUrl("https://sautilink.com", media))
        assertEquals("https://test.sautilink.com/api/sauti-media/$media/download", nativeShortVideoDownloadUrl("https://test.sautilink.com", media))
        assertTrue(nativeShortVideoDownloadIdentityValid(media, post))
        for (origin in listOf("http://sautilink.com", "https://sautilink.com.evil.test", "https://sautilink.com/", "https://sautilink.com:443", "https://user@sautilink.com"))
            rejectsArgument { nativeShortVideoDownloadUrl(origin, media) }
        for (identity in listOf("../private", "$media?token=secret", "$media#fragment", "$media/other")) {
            rejectsArgument { nativeShortVideoDownloadUrl("https://sautilink.com", identity) }
            assertFalse(nativeShortVideoDownloadIdentityValid(identity, post))
        }
        assertFalse(nativeShortVideoDownloadIdentityValid(media, "invalid-post"))
    }

    @Test fun responseMustBeCompleteMp4WithBoundedSizeAndStrongVersion() {
        assertEquals(NativeShortVideoDownloadMetadata(SHORT_VIDEO_DOWNLOAD_MAX_BYTES, etag),
            nativeShortVideoDownloadMetadata(200, "video/mp4; charset=binary", SHORT_VIDEO_DOWNLOAD_MAX_BYTES.toString(), etag))
        for (status in listOf(202, 206, 302, 401, 403, 404, 500))
            rejectsIo { nativeShortVideoDownloadMetadata(status, "video/mp4", "1024", etag) }
        for (type in listOf(null, "text/html", "application/json"))
            rejectsIo { nativeShortVideoDownloadMetadata(200, type, "1024", etag) }
        for (size in listOf(null, "0", "-1", "not-a-number", (SHORT_VIDEO_DOWNLOAD_MAX_BYTES + 1).toString()))
            rejectsIo { nativeShortVideoDownloadMetadata(200, "video/mp4", size, etag) }
        for (version in listOf(null, "W/$etag", "unquoted", "\"bad space\""))
            rejectsIo { nativeShortVideoDownloadMetadata(200, "video/mp4", "1024", version) }
    }

    @Test fun copyIsExactAndEachNetworkReadIsAtMost64KiB() {
        val bytes = mp4(200_000)
        var largestRead = 0
        val input = object : ByteArrayInputStream(bytes) {
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                largestRead = maxOf(largestRead, length)
                return super.read(buffer, offset, length)
            }
        }
        val output = ByteArrayOutputStream()
        val progress = mutableListOf<Long>()
        assertEquals(bytes.size.toLong(), copyNativeShortVideoDownload(input, output, bytes.size.toLong(), { true }) { progress += it })
        assertArrayEquals(bytes, output.toByteArray())
        assertTrue(largestRead <= 64 * 1024)
        assertEquals(bytes.size.toLong(), progress.last())
        assertTrue(progress.zipWithNext().all { (before, after) -> after > before })
    }

    @Test fun truncatedExtraAndNonMp4BodiesCannotComplete() {
        val bytes = mp4(100)
        rejectsIo { copyNativeShortVideoDownload(ByteArrayInputStream(bytes), ByteArrayOutputStream(), 101, { true }) }
        rejectsIo { copyNativeShortVideoDownload(ByteArrayInputStream(bytes), ByteArrayOutputStream(), 99, { true }) }
        rejectsIo { copyNativeShortVideoDownload(ByteArrayInputStream(ByteArray(100)), ByteArrayOutputStream(), 100, { true }) }
        rejectsIo { copyNativeShortVideoDownload(ByteArrayInputStream(bytes), ByteArrayOutputStream(), SHORT_VIDEO_DOWNLOAD_MAX_BYTES + 1, { true }) }
    }

    @Test fun accountChangeDuringReadStopsBeforeWritingThatChunk() {
        var active = true
        val input = object : ByteArrayInputStream(mp4(100)) {
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int = super.read(buffer, offset, length).also { active = false }
        }
        val output = ByteArrayOutputStream()
        rejectsIo { copyNativeShortVideoDownload(input, output, 100, { active }) }
        assertEquals(0, output.size())
    }

    @Test fun cancelBetweenChunksDoesNotReadOrWriteAgain() {
        var active = true
        var reads = 0
        val input = object : ByteArrayInputStream(mp4(200_000)) {
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                reads++
                return super.read(buffer, offset, length)
            }
        }
        val output = ByteArrayOutputStream()
        rejectsIo { copyNativeShortVideoDownload(input, output, 200_000, { active }) { active = false } }
        assertEquals(1, reads)
        assertEquals(64 * 1024, output.size())
    }

    @Test fun lateAccountChangeAtEofPreventsCompletionAndFlush() {
        var active = true
        val source = ByteArrayInputStream(mp4(100))
        val input = object : InputStream() {
            override fun read(): Int = source.read()
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int = source.read(buffer, offset, length).also {
                if (it < 0) active = false
            }
        }
        var flushed = false
        val output = object : ByteArrayOutputStream() { override fun flush() { flushed = true } }
        rejectsIo { copyNativeShortVideoDownload(input, output, 100, { active }) }
        assertFalse(flushed)
    }

    private fun mp4(size: Int): ByteArray = ByteArray(size) { (it % 127).toByte() }.also {
        it[0] = 0; it[1] = 0; it[2] = 0; it[3] = 24
        "ftyp".toByteArray(Charsets.US_ASCII).copyInto(it, 4)
        "isom".toByteArray(Charsets.US_ASCII).copyInto(it, 8)
    }
    private fun rejectsIo(block: () -> Unit) {
        try { block(); fail("Expected a rejected download") } catch (_: IOException) { }
    }
    private fun rejectsArgument(block: () -> Unit) {
        try { block(); fail("Expected a rejected destination") } catch (_: IllegalArgumentException) { }
    }
}
