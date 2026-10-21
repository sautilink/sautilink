package com.sautilink.nativeapp.feature.stories

import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class NativeStoryUploadProgressTest {
    @Test fun writingAllBytesCannotClaimProviderAcknowledgementOrReplayTheOneTimePost() {
        val file = File.createTempFile("story-progress-", ".mp4")
        try {
            val bytes = ByteArray(984_699) { (it % 251).toByte() }
            file.writeBytes(bytes)
            val progress = mutableListOf<Int>()
            val body = StoryUploadBody(file, "video/mp4") { progress.add(it) }
            val sink = Buffer()
            body.writeTo(sink)
            assertArrayEquals(bytes, sink.readByteArray())
            assertEquals(99, progress.last())
            assertTrue(progress.all { it in 0..99 })
            assertEquals(progress.sorted(), progress)
            assertEquals(bytes.size.toLong(), body.contentLength())
            assertTrue(body.isOneShot())
        } finally { file.delete() }
    }
}
