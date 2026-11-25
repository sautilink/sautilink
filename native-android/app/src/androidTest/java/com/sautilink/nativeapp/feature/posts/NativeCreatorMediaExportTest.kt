package com.sautilink.nativeapp.feature.posts

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class NativeCreatorMediaExportTest {
    private fun hasMagentaText(bitmap: Bitmap): Boolean {
        var pixels = 0
        for (y in 0 until bitmap.height step 2) for (x in 0 until bitmap.width step 2) {
            val color = bitmap.getPixel(x, y)
            if (Color.red(color) > 150 && Color.blue(color) > 150 && Color.green(color) < 100) pixels++
        }
        return pixels > 15
    }

    @Test fun allFifteenFontsRenderIntoTheExportedPhoto() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals(15, NativeCreatorFont.entries.size)
        val source = Bitmap.createBitmap(480, 480, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GREEN) }
        try {
            for (font in NativeCreatorFont.entries) {
                val edit = NativePhotoFilter.Mono.applyTo(NativeImageEdits(overlay = NativeCreatorText("SAUTI", font,
                    bold = true, color = Color.MAGENTA, size = .14f)))
                val exported = exportEditedImage(context, source, edit)
                try {
                    val decoded = BitmapFactory.decodeFile(exported.ownedFile!!.path)
                    try {
                        assertTrue("${font.label} must be baked into the saved image", hasMagentaText(decoded))
                        val background = decoded.getPixel(5, 5)
                        assertTrue(kotlin.math.abs(Color.red(background) - Color.green(background)) < 5)
                    } finally { decoded.recycle() }
                } finally { exported.ownedFile?.delete() }
            }
        } finally { source.recycle() }
    }

    @Test fun videoExportContainsBothFilterAndTextAndPreservesSource() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val original = File(context.cacheDir, "creator-export-fixture.mp4")
        instrumentation.context.assets.open("media-editor-62s.mp4").use { input -> original.outputStream().use { input.copyTo(it) } }
        val bytesBefore = original.length()
        var result: NativeEditedMedia? = null
        try {
            result = withTimeout(90_000) { exportTrimmedVideo(context, Uri.fromFile(original),
                localVideoDuration(context, Uri.fromFile(original)), NativeMediaEditPolicy.Trim(0, 1800),
                edits = NativePhotoFilter.Mono.applyTo(NativeImageEdits(overlay = NativeCreatorText("SAUTI",
                    bold = true, color = Color.MAGENTA, size = .14f)))) { } }
            val frame = localVideoThumbnail(context, result!!.uri)!!
            try {
                assertTrue("The final MP4 must contain the colored text", hasMagentaText(frame))
                val background = frame.getPixel(5, 5)
                assertTrue("The final MP4 must contain the monochrome filter",
                    kotlin.math.abs(Color.red(background) - Color.blue(background)) < 15)
            } finally { frame.recycle() }
            assertEquals(bytesBefore, original.length())
            assertTrue(localVideoDuration(context, result!!.uri) in 1500..2200)
        } finally { result?.ownedFile?.delete(); original.delete() }
    }
}
