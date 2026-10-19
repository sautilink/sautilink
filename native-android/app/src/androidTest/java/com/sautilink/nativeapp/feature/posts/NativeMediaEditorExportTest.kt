package com.sautilink.nativeapp.feature.posts

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeMediaEditorExportTest {
    @Test fun imageCropFramingRotationAndAdjustmentsChangePixelsWithoutChangingSource() {
        val source = Bitmap.createBitmap(16, 8, Bitmap.Config.ARGB_8888).apply {
            setHasAlpha(false)
            for (y in 0 until 8) for (x in 0 until 16) setPixel(x, y, if (x < 8) Color.RED else Color.BLUE)
        }
        val left = renderEditedBitmap(source, NativeImageEdits(aspect = 1f, panX = -1f))
        val right = renderEditedBitmap(source, NativeImageEdits(aspect = 1f, panX = 1f))
        val rotated = renderEditedBitmap(source, NativeImageEdits(rotation = 90))
        try {
            assertEquals(8, left.width); assertEquals(8, left.height)
            assertEquals(Color.RED, left.getPixel(3, 3)); assertEquals(Color.BLUE, right.getPixel(3, 3))
            assertEquals(8, rotated.width); assertEquals(16, rotated.height)
            assertEquals(16, source.width); assertEquals(Color.RED, source.getPixel(0, 0))
            assertEquals(Color.BLUE, source.getPixel(15, 0))
        } finally { left.recycle(); right.recycle(); rotated.recycle(); source.recycle() }
        val gray = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.rgb(50, 50, 50)) }
        val brighter = renderEditedBitmap(gray, NativeImageEdits(brightness = .2f))
        try { assertTrue(Color.red(brighter.getPixel(1, 1)) in 99..103); assertEquals(50, Color.red(gray.getPixel(1, 1))) }
        finally { gray.recycle(); brighter.recycle() }
    }

    @Test fun imageEditsExportARealBoundedLocalFile() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val original = Bitmap.createBitmap(80, 40, Bitmap.Config.ARGB_8888).apply { setHasAlpha(false); eraseColor(Color.GREEN) }
        val exported = exportEditedImage(context, original, NativeImageEdits(aspect = 1f, rotation = 90))
        try {
            assertNotNull(exported.ownedFile)
            val file = exported.ownedFile!!
            assertEquals(context.cacheDir.canonicalFile, file.canonicalFile.parentFile)
            assertTrue(file.name.startsWith("sauti-edit-")); assertTrue(file.length() in 1..(8L * 1024 * 1024))
            val bitmap = BitmapFactory.decodeFile(file.path)
            assertNotNull(bitmap); assertEquals(40, bitmap.width); assertEquals(40, bitmap.height)
            assertEquals(80, original.width); assertFalse(original.isRecycled)
            bitmap.recycle()
        } finally { exported.ownedFile?.delete(); original.recycle() }
    }

    @Test fun longVideoExportsOnlySelectedLaterIntervalAndRetainsItsAudio() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val original = File(context.cacheDir, "media-editor-fixture-${UUID.randomUUID()}.mp4")
        instrumentation.context.assets.open("media-editor-62s.mp4").use { input -> original.outputStream().use { output -> input.copyTo(output) } }
        fun digest(file: File) = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).toList()
        val before = digest(original)
        var exported: NativeEditedMedia? = null
        try {
            val sourceUri = Uri.fromFile(original)
            val duration = localVideoDuration(context, sourceUri)
            assertTrue("Fixture must exercise the existing over-60-second restriction", duration > 60_000L)
            val firstFrame = localVideoThumbnail(context, sourceUri)!!
            try { assertTrue(Color.red(firstFrame.getPixel(20, 20)) > Color.blue(firstFrame.getPixel(20, 20)) + 80) }
            finally { firstFrame.recycle() }
            exported = withTimeout(60_000L) {
                exportTrimmedVideo(context, sourceUri, duration, NativeMediaEditPolicy.Trim(60_200, 61_700)) { }
            }
            val result = exported!!
            assertNotNull(result.ownedFile)
            assertTrue(result.ownedFile!!.length() in 1..100_000_000L)
            val clippedDuration = localVideoDuration(context, result.uri)
            assertTrue("Selected clip must be approximately 1.5 seconds, got $clippedDuration", clippedDuration in 1_200L..1_800L)
            val thumbnail = localVideoThumbnail(context, result.uri)
            assertNotNull("Exported MP4 must decode for the composer preview", thumbnail)
            try {
                val pixel = thumbnail!!.getPixel(20, 20)
                assertTrue("Later blue interval must be exported, excluding earlier red frames", Color.blue(pixel) > Color.red(pixel) + 80)
            } finally { thumbnail?.recycle() }
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(context, result.uri)
                assertEquals("yes", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO))
            } finally { retriever.release() }
            assertEquals("The selected source must never be overwritten", before, digest(original))
        } finally { exported?.ownedFile?.delete(); original.delete() }
    }
}
