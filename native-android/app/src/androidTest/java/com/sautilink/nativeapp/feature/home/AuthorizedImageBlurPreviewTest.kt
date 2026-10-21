package com.sautilink.nativeapp.feature.home

import android.graphics.Bitmap
import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs
import kotlin.math.max

/** Real bitmap operations on synthetic pixels; never downloads user media. */
@RunWith(AndroidJUnit4::class)
class AuthorizedImageBlurPreviewTest {
    @Test fun previewKeepsActualPhotoColours_andNeverRecyclesTheVisibleSource() {
        val source = Bitmap.createBitmap(480, 320, Bitmap.Config.ARGB_8888)
        source.eraseColor(Color.rgb(175, 91, 42))
        val preview = blurredImagePreview(source)
        assertFalse(source.isRecycled)
        assertTrue(max(preview.width, preview.height) <= 108)
        assertEquals(Color.rgb(175, 91, 42), preview.getPixel(preview.width / 2, preview.height / 2))
        assertTrue(abs(preview.width.toFloat() / preview.height - 1.5f) < .08f)
        source.recycle()
        preview.recycle()
    }

    @Test fun extremePortraitAndTinySourcesAlwaysHaveValidBoundedPreviewDimensions() {
        listOf(1 to 2000, 2000 to 1, 1 to 1, 6 to 8).forEach { (width, height) ->
            val source = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            source.eraseColor(Color.BLUE)
            val preview = blurredImagePreview(source)
            assertTrue(preview.width > 0 && preview.height > 0)
            assertTrue(max(preview.width, preview.height) <= 108)
            assertFalse(source.isRecycled)
            source.recycle()
            preview.recycle()
        }
    }
}
