package com.sautilink.nativeapp.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.R
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Draw the actual resource; Android's small notification icon must be white alpha. */
@RunWith(AndroidJUnit4::class)
class NativeNotificationBrandIconTest {
    @Test fun smallIconHasWhiteBrandPixelsAndTransparentBackground() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val drawable = requireNotNull(ContextCompat.getDrawable(context, R.drawable.ic_stat_sautilink))
        val image = Bitmap.createBitmap(72, 72, Bitmap.Config.ARGB_8888)
        drawable.setBounds(0, 0, image.width, image.height)
        drawable.draw(Canvas(image))
        var visible = 0
        var clear = 0
        var colored = 0
        var firstColored = ""
        for (y in 0 until image.height) for (x in 0 until image.width) {
            val pixel = image.getPixel(x, y)
            if (Color.alpha(pixel) == 0) clear++ else {
                visible++
                if (Color.red(pixel) != 255 || Color.green(pixel) != 255 || Color.blue(pixel) != 255) {
                    colored++
                    if (firstColored.isEmpty()) firstColored = "$x,$y ARGB=${Integer.toHexString(pixel)}"
                }
            }
        }
        Log.i("SautiNotificationIcon", "visible=$visible transparent=$clear colored=$colored firstColored=$firstColored")
        assertTrue("A small icon uses white alpha rather than the color launcher artwork; colored=$colored first=$firstColored",
            colored == 0)
        assertTrue("The brand must remain visible", visible > 100)
        assertTrue("No square or opaque background may surround the notification mark", clear > image.width * image.height / 2)
        image.recycle()
    }
}
