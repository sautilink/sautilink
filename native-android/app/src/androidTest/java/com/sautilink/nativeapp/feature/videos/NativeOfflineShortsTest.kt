package com.sautilink.nativeapp.feature.videos

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

/** Private offline storage contract only. No network or real account is used. */
class NativeOfflineShortsTest {
    @Test fun offlineIndexIsAccountScopedAndRejectsMissingOrTruncatedContent() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val account=UUID.randomUUID().toString();val other=UUID.randomUUID().toString()
        val media=UUID.randomUUID().toString();val post=UUID.randomUUID().toString()
        val folder=NativeOfflineShorts.folder(context,account)
        try {
            val file=File(folder,"$media-${UUID.randomUUID()}.mp4").apply { writeBytes(ByteArray(1024)) }
            NativeOfflineShorts.record(context,account,media,post,file) { true }
            assertEquals(media,NativeOfflineShorts.list(context,account).single().mediaId)
            assertTrue(NativeOfflineShorts.list(context,other).isEmpty())
            file.writeBytes(ByteArray(512))
            assertTrue(NativeOfflineShorts.list(context,account).isEmpty())
        } finally { folder.deleteRecursively();NativeOfflineShorts.folder(context,other).deleteRecursively() }
    }
    @Test fun aCancelledOwnerCannotPublishAnOfflineEntry() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val account=UUID.randomUUID().toString();val media=UUID.randomUUID().toString()
        val folder=NativeOfflineShorts.folder(context,account)
        try {
            val file=File(folder,"$media-${UUID.randomUUID()}.mp4").apply { writeBytes(ByteArray(128)) }
            try {
                NativeOfflineShorts.record(context,account,media,UUID.randomUUID().toString(),file) { false }
                fail("Cancelled ownership must not publish")
            } catch (_: java.io.IOException) { }
            assertTrue(NativeOfflineShorts.list(context,account).isEmpty())
        } finally { folder.deleteRecursively() }
    }
}
