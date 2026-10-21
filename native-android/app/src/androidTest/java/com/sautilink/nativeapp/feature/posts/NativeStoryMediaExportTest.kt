package com.sautilink.nativeapp.feature.posts

import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.media.MediaMetadataRetriever
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.feature.stories.NativeStoryPolicy
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeStoryMediaExportTest {
    @Test fun monochromeAndWarmPhotoFiltersRenderIntoPixelsAndLeaveOriginalUntouched() {
        val original = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.rgb(80, 130, 190)); setHasAlpha(false) }
        val mono = renderEditedBitmap(original, NativePhotoFilter.Mono.applyTo(NativeImageEdits()))
        val warm = renderEditedBitmap(original, NativePhotoFilter.Golden.applyTo(NativeImageEdits()))
        val cool = renderEditedBitmap(original, NativePhotoFilter.Cool.applyTo(NativeImageEdits()))
        try {
            val gray = mono.getPixel(10, 10)
            assertTrue(kotlin.math.abs(Color.red(gray) - Color.green(gray)) <= 1)
            assertTrue(kotlin.math.abs(Color.red(gray) - Color.blue(gray)) <= 1)
            val warmPixel = warm.getPixel(10, 10); val coolPixel = cool.getPixel(10, 10)
            assertTrue("Golden adds warmth to exported pixels", Color.red(warmPixel) > Color.red(coolPixel))
            assertTrue("Cool keeps more blue than Golden", Color.blue(coolPixel) > Color.blue(warmPixel))
            assertEquals(Color.rgb(80, 130, 190), original.getPixel(10, 10))
        } finally { original.recycle(); mono.recycle(); warm.recycle(); cool.recycle() }
    }

    @Test fun storyVideoExportsThirtySecondsAndRejectsLongerSelectionBeforeExport() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val original = File(context.cacheDir, "story-trim-fixture-${UUID.randomUUID()}.mp4")
        instrumentation.context.assets.open("media-editor-62s.mp4").use { input -> original.outputStream().use { input.copyTo(it) } }
        fun digest(file: File) = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).toList()
        val before = digest(original)
        var exported: NativeEditedMedia? = null
        try {
            val uri = Uri.fromFile(original)
            val duration = localVideoDuration(context, uri)
            try {
                exportTrimmedVideo(context, uri, duration, NativeMediaEditPolicy.Trim(0, 30_001), NativeStoryPolicy.MAX_VIDEO_MS) {}
                fail("Story export must reject a selection over 30 seconds")
            } catch (_: IllegalArgumentException) { }
            exported = withTimeout(90_000) { exportTrimmedVideo(context, uri, duration,
                NativeMediaEditPolicy.Trim(1_000, 31_000), NativeStoryPolicy.MAX_VIDEO_MS) {} }
            assertNotNull(exported!!.ownedFile)
            val resultDuration = localVideoDuration(context, exported!!.uri)
            assertTrue("Story export should be about 30 seconds, was $resultDuration", resultDuration in 29_700L..30_000L)
            val metadata = MediaMetadataRetriever()
            try {
                metadata.setDataSource(context, exported!!.uri)
                assertEquals("Story trimming must retain the original audio", "yes", metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO))
            } finally { metadata.release() }
            val thumbnail = localVideoThumbnail(context, exported!!.uri)
            assertNotNull("The bounded story must remain decodable", thumbnail)
            thumbnail?.recycle()
            assertEquals(before, digest(original))
        } finally { exported?.ownedFile?.delete(); original.delete() }
    }

    @Test fun existingSixtySecondPostClipAlsoRespectsItsActualEncodedUploadLimit() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val original = File(context.cacheDir, "post-limit-fixture-${UUID.randomUUID()}.mp4")
        instrumentation.context.assets.open("media-editor-62s.mp4").use { input -> original.outputStream().use { input.copyTo(it) } }
        val before = MessageDigest.getInstance("SHA-256").digest(original.readBytes()).toList()
        var exported: NativeEditedMedia? = null
        try {
            val uri = Uri.fromFile(original)
            val duration = localVideoDuration(context, uri)
            exported = withTimeout(90_000) { exportTrimmedVideo(context, uri, duration,
                NativeMediaEditPolicy.Trim(1_000, 61_000)) {} }
            val resultDuration = localVideoDuration(context, exported!!.uri)
            assertTrue("The existing 60-second upload limit must also be strict, was $resultDuration", resultDuration in 59_700L..60_000L)
            assertEquals(before, MessageDigest.getInstance("SHA-256").digest(original.readBytes()).toList())
        } finally { exported?.ownedFile?.delete(); original.delete() }
    }
}
