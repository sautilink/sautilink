package com.sautilink.nativeapp.feature.home

import android.graphics.Bitmap
import android.net.Uri
import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** Window screenshots include the real decoder Surface, unlike a Compose-only
 * capture. Magenta outside a red zoomed video exposes any overflowing layer. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class NativeFeedSurfaceClipTest {
    @get:Rule val compose = createComposeRule()

    private fun checkFrame(width: Int, height: Int) {
        val instrument = InstrumentationRegistry.getInstrumentation()
        val context = instrument.targetContext
        val fixture = File(context.cacheDir, "feed-surface-clip-$width-$height.mp4")
        instrument.context.assets.open("media-editor-62s.mp4").use { input ->
            fixture.outputStream().use { input.copyTo(it) }
        }
        var decoderPlayer: ExoPlayer? = null
        var view: PlayerView? = null
        val rendered = AtomicBoolean()
        try {
            compose.setContent {
                Box(Modifier.fillMaxSize().background(Color.Magenta), contentAlignment = Alignment.Center) {
                    AndroidView(factory = { ctx ->
                        createNativeFeedPlayerView(ctx).apply {
                            view = this
                            useController = false
                            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                            this.player = ExoPlayer.Builder(ctx).build().also { decoder ->
                                decoderPlayer = decoder
                                decoder.volume = 0f
                                decoder.addListener(object : Player.Listener {
                                    override fun onRenderedFirstFrame() { rendered.set(true) }
                                })
                                decoder.setMediaItem(MediaItem.fromUri(Uri.fromFile(fixture)))
                                decoder.prepare(); decoder.play()
                            }
                        }
                    }, onRelease = { it.player = null }, modifier = Modifier.size(width.dp, height.dp))
                }
            }
            compose.waitUntil(15_000) { rendered.get() }
            compose.waitForIdle()
            SystemClock.sleep(300)
            val location = IntArray(2)
            var frameWidth = 0; var frameHeight = 0
            compose.runOnIdle {
                val stage = requireNotNull(view)
                assertTrue(stage.clipToOutline)
                stage.getLocationOnScreen(location)
                frameWidth = stage.width; frameHeight = stage.height
            }
            val screenshot = requireNotNull(instrument.uiAutomation.takeScreenshot())
            File(context.filesDir, "feed-surface-clip-$width-$height.png").outputStream().use {
                screenshot.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            val centerX = location[0] + frameWidth / 2
            val centerY = location[1] + frameHeight / 2
            val inside = screenshot.getPixel(centerX, centerY)
            assertTrue("A real red video frame must be visible", android.graphics.Color.red(inside) > 200 &&
                android.graphics.Color.green(inside) < 60 && android.graphics.Color.blue(inside) < 60)
            val gap = (12 * context.resources.displayMetrics.density).toInt()
            for ((x, y) in listOf(centerX to location[1] - gap,
                centerX to location[1] + frameHeight + gap,
                location[0] - gap to centerY, location[0] + frameWidth + gap to centerY)) {
                val outside = screenshot.getPixel(x, y)
                assertTrue("Video must not paint outside its frame at $x,$y",
                    android.graphics.Color.red(outside) > 230 && android.graphics.Color.blue(outside) > 230 &&
                        android.graphics.Color.green(outside) < 30)
            }
            screenshot.recycle()
        } finally {
            instrument.runOnMainSync { view?.player = null; decoderPlayer?.release() }
            fixture.delete()
        }
    }

    @Test fun zoomedSurfaceCannotPaintAboveOrBelowItsFeedRow() = checkFrame(240, 160)
    @Test fun zoomedSurfaceCannotPaintBesideItsFeedRow() = checkFrame(160, 240)
}
