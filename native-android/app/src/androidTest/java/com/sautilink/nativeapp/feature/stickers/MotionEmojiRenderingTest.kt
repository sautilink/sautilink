package com.sautilink.nativeapp.feature.stickers

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import com.airbnb.lottie.LottieCompositionFactory
import com.airbnb.lottie.LottieDrawable
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

class MotionEmojiRenderingTest {
    @Test fun allEightMotionEmojiShowTheirDetailsAboveTheAnimatedBackground() {
        val instrument = InstrumentationRegistry.getInstrumentation()
        val names = instrument.context.assets.list("motion-emoji")!!.sorted()
        assertEquals(8, names.size)
        for (name in names) {
            val json = instrument.context.assets.open("motion-emoji/$name").bufferedReader().use { it.readText() }
            val composition = LottieCompositionFactory.fromJsonStringSync(json, null).value!!
            for (progress in listOf(0f, .4f, .8f)) {
                val bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
                try {
                    val drawable = LottieDrawable().apply {
                        setComposition(composition); setBounds(0, 0, 256, 256); this.progress = progress
                    }
                    drawable.draw(Canvas(bitmap))
                    val base = bitmap.getPixel(128, 85)
                    var contrasting = 0
                    for (y in 45..210) for (x in 45..210) {
                        val pixel = bitmap.getPixel(x, y)
                        if (Color.alpha(pixel) > 220 &&
                            kotlin.math.abs(Color.red(pixel)-Color.red(base)) +
                            kotlin.math.abs(Color.green(pixel)-Color.green(base)) +
                            kotlin.math.abs(Color.blue(pixel)-Color.blue(base)) > 90) contrasting++
                    }
                    if (progress == .4f) {
                        val directory = java.io.File(instrument.targetContext.externalCacheDir, "motion-emoji-proof").apply { mkdirs() }
                        java.io.File(directory, name.removeSuffix(".json") + ".png").outputStream().use {
                            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                        }
                    }
                    assertTrue("$name must show facial/symbol details at $progress, not just a flat circle ($contrasting pixels)", contrasting > 100)
                } finally { bitmap.recycle() }
            }
        }
    }
}
