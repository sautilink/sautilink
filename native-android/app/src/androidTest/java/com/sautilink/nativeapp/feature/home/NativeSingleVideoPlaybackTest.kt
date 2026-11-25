package com.sautilink.nativeapp.feature.home

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class NativeSingleVideoPlaybackTest {
    @Test fun fullyVisibleShortVideosNeverPlayTogetherAndManualTapHandsOver() {
        val instrument = InstrumentationRegistry.getInstrumentation()
        val context = instrument.targetContext
        val file = File(context.cacheDir, "single-video-test.mp4")
        instrument.context.assets.open("media-editor-62s.mp4").use { input -> file.outputStream().use { input.copyTo(it) } }
        var first: ExoPlayer? = null; var second: ExoPlayer? = null
        val control = NativeFeedPlaybackCoordinator()
        fun main(action: () -> Unit) = instrument.runOnMainSync(action)
        fun await(condition: () -> Boolean) {
            val deadline = System.currentTimeMillis() + 10_000
            while (System.currentTimeMillis() < deadline) {
                var done = false; main { done = condition() }; if (done) return
                Thread.sleep(80)
            }
            fail("Timed out waiting for real video playback")
        }
        try {
            main {
                first = ExoPlayer.Builder(context).build().apply { volume = 0f; setMediaItem(MediaItem.fromUri(Uri.fromFile(file))); prepare() }
                second = ExoPlayer.Builder(context).build().apply { volume = 0f; setMediaItem(MediaItem.fromUri(Uri.fromFile(file))); prepare() }
                control.update("top", NativeFeedPlaybackCoordinator.Candidate("top-post", 1f, 50f))
                control.update("bottom", NativeFeedPlaybackCoordinator.Candidate("bottom-post", 1f, 150f))
            }
            await { first!!.playbackState == Player.STATE_READY && second!!.playbackState == Player.STATE_READY }
            main {
                control.play("first", "top-post", first!!::pause) { first!!.play() }
                assertFalse(control.play("second", "bottom-post", second!!::pause) { second!!.play() })
            }
            await { first!!.isPlaying }
            main {
                assertFalse(second!!.isPlaying)
                control.selectManually("bottom")
                assertFalse("The previous video must pause before the next is started", first!!.playWhenReady)
                control.play("second", "bottom-post", second!!::pause) { second!!.play() }
            }
            await { second!!.isPlaying }
            main {
                assertFalse(first!!.isPlaying)
                control.remove("bottom"); control.remove("top")
                assertFalse(first!!.playWhenReady); assertFalse(second!!.playWhenReady)
            }
        } finally { main { first?.release(); second?.release() }; file.delete() }
    }
}
