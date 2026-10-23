package com.sautilink.nativeapp.feature.posts

import okhttp3.MediaType.Companion.toMediaType
import okio.Buffer
import okio.ForwardingSink
import okio.buffer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.concurrent.CancellationException

class NativePostUploadPolicyTest {
    private val id = "00000000-0000-4000-8000-000000000001"
    private val upload = "/api/sauti-media/upload/$id"
    private fun begin(size: Long): JSONObject = JSONObject().put("upload_url", upload).apply {
        if (size > NativePostUploadPolicy.PART_BYTES) put("chunk_upload", JSONObject()
            .put("part_size_bytes", NativePostUploadPolicy.PART_BYTES)
            .put("part_count", (size + NativePostUploadPolicy.PART_BYTES - 1) / NativePostUploadPolicy.PART_BYTES)
            .put("part_url", "$upload?part={part}").put("complete_url", "$upload?complete=1"))
    }
    private fun plan(size: Long, json: JSONObject = begin(size)): NativePostUploadPlan =
        NativePostUploadPolicy.plan(id, size, "video", "video/mp4", json)

    @Test fun exactImageVideoAndDurationBoundariesAreEnforced() {
        assertTrue(NativePostUploadPolicy.imageSizeAllowed(5_242_880))
        assertFalse(NativePostUploadPolicy.imageSizeAllowed(5_242_881))
        assertTrue(NativePostUploadPolicy.videoSizeAllowed(262_144_000))
        assertFalse(NativePostUploadPolicy.videoSizeAllowed(262_144_001))
        assertTrue(NativePostUploadPolicy.videoDurationAllowed(180_000))
        assertFalse(NativePostUploadPolicy.videoDurationAllowed(180_001))
        assertFalse(NativePostUploadPolicy.videoDurationAllowed(0))
        assertFalse(NativePostUploadPolicy.videoSizeAllowed(0))
        assertFalse(NativePostUploadPolicy.imageSizeAllowed(-1))
    }

    @Test fun uploadResponsesAreBoundedBeforeJsonParsing() {
        assertTrue(readBoundedPostUploadJson("""{"ok":true}""".byteInputStream()).getBoolean("ok"))
        assertThrows(IOException::class.java) { readBoundedPostUploadJson("x".repeat(16_385).byteInputStream()) }
    }

    @Test fun maximumVideoHas32OrderedBoundedPartsAnd2MiBFinalPart() {
        val plan = plan(262_144_000)
        assertTrue(plan.chunked)
        assertEquals(32, plan.partCount)
        assertEquals(0L, plan.offset(1))
        assertEquals(8_388_608L, plan.length(1))
        assertEquals(260_046_848L, plan.offset(32))
        assertEquals(2_097_152L, plan.length(32))
        assertEquals((1..32).map { plan.length(it) }.sum(), plan.totalBytes)
        assertEquals("$upload?part=32", plan.path(32))
        assertEquals("$upload?complete=1", plan.completePath)
        assertThrows(IllegalArgumentException::class.java) { plan.path(0) }
        assertThrows(IllegalArgumentException::class.java) { plan.length(33) }
    }

    @Test fun smallVideosAndImagesKeepTheirSinglePutPath() {
        val small = plan(8_388_608)
        assertFalse(small.chunked); assertEquals(1, small.partCount)
        assertEquals(upload, small.path(1)); assertEquals(8_388_608L, small.length(1))
        val image = NativePostUploadPolicy.plan(id, 5_242_880, "image", "image/png", JSONObject().put("upload_url", upload))
        assertFalse(image.chunked)
        assertThrows(IllegalArgumentException::class.java) { plan(8_388_609, JSONObject().put("upload_url", upload)) }
    }

    @Test fun pathOrIdChangesAndMalformedCountsCannotAcquireUploadAuthority() {
        val size = 9_000_000L
        val invalid = listOf(
            "https://evil.example$upload?part={part}", "//$upload?part={part}", "$upload?part={part}&extra=1",
            "$upload?part={part}#token", "$upload?part=1", "$upload/extra?part={part}",
            upload.replace(id, "00000000-0000-4000-8000-000000000002") + "?part={part}"
        )
        invalid.forEach { path ->
            val json = begin(size); json.getJSONObject("chunk_upload").put("part_url", path)
            assertThrows(path, IllegalArgumentException::class.java) { plan(size, json) }
        }
        for (field in listOf("part_size_bytes", "part_count", "complete_url")) {
            val json = begin(size); json.getJSONObject("chunk_upload").put(field, if (field == "complete_url") "$upload?complete=1&extra=1" else 2.5)
            assertThrows(field, IllegalArgumentException::class.java) { plan(size, json) }
        }
        assertThrows(IllegalArgumentException::class.java) { plan(size, begin(size).put("upload_url", "https://sautilink.com$upload")) }
        assertThrows(IllegalArgumentException::class.java) { plan(262_144_001) }
        assertThrows(IllegalArgumentException::class.java) { NativePostUploadPolicy.plan("-".repeat(36),size,"video","video/mp4",begin(size)) }
        assertThrows(IllegalArgumentException::class.java) { NativePostUploadPolicy.plan(id,5_242_881,"image","image/jpeg",begin(5_242_881)) }
    }

    @Test fun rangeBodyWritesOnlyRequestedBytesAndKeepsTransportProgressMonotonic() {
        val file = File.createTempFile("sauti-range", ".mp4")
        try {
            val source = ByteArray(240_000) { (it % 251).toByte() }; file.writeBytes(source)
            val target = Buffer(); var largestWrite = 0L; var checks = 0; val progress = mutableListOf<Int>()
            val sink = object : ForwardingSink(target) {
                override fun write(source: Buffer, byteCount: Long) { largestWrite = maxOf(largestWrite,byteCount); super.write(source,byteCount) }
            }.buffer()
            val body = NativePostFileRangeBody(file,"video/mp4".toMediaType(),80_000,140_000,{checks++},{progress.add(it)})
            assertEquals(140_000L,body.contentLength())
            body.writeTo(sink);sink.flush()
            assertArrayEquals(source.copyOfRange(80_000,220_000),target.readByteArray())
            assertTrue(largestWrite <= NativePostUploadPolicy.IO_BUFFER_BYTES)
            assertTrue(checks >= 5)
            assertTrue(progress.zipWithNext().all { (a,b) -> b >= a })
            assertEquals(91,progress.last())
        } finally { assertTrue(file.delete()) }
    }

    @Test fun cancellationOrOwnerChangeStopsBeforeNextWriteAndClosesFile() {
        val file = File.createTempFile("sauti-cancel", ".mp4")
        file.writeBytes(ByteArray(200_000))
        try {
            val target=Buffer();var checks=0
            val body=NativePostFileRangeBody(file,"video/mp4".toMediaType(),0,file.length(),{
                if(++checks==4) throw CancellationException("owner changed or cancelled")
            },{})
            val failure = assertThrows(IOException::class.java) { body.writeTo(target) }
            assertTrue(failure.cause is CancellationException)
            assertEquals(65_536L,target.size)
        } finally { assertTrue(file.delete()) }
    }
}
