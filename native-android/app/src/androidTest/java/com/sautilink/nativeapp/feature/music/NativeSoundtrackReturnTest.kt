package com.sautilink.nativeapp.feature.music

import android.net.Uri
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

class NativeSoundtrackReturnTest {
    @Test fun returningToTheSamePostRestartsAnIdleDecoderAndChangingPostRestartsItsClip() {
        val instrument = InstrumentationRegistry.getInstrumentation()
        val context = instrument.targetContext
        val file = File(context.cacheDir, "soundtrack-return-test.wav")
        val samples = 8000 * 4
        val bytes = ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN)
        bytes.put("RIFF".toByteArray()).putInt(36 + samples * 2).put("WAVEfmt ".toByteArray())
            .putInt(16).putShort(1).putShort(1).putInt(8000).putInt(16000).putShort(2).putShort(16)
            .put("data".toByteArray()).putInt(samples * 2)
        repeat(samples) { bytes.putShort((kotlin.math.sin(it * 2.0 * Math.PI * 440 / 8000) * 1000).toInt().toShort()) }
        file.writeBytes(bytes.array())
        var player: ExoPlayer? = null
        fun main(block: () -> Unit) = instrument.runOnMainSync(block)
        fun awaitPlayback() {
            val deadline = System.currentTimeMillis() + 10000
            while (System.currentTimeMillis() < deadline) {
                var ready = false; main { ready = player!!.isPlaying }
                if (ready) return
                Thread.sleep(80)
            }
            fail("Selected soundtrack did not resume")
        }
        try {
            val uri = Uri.fromFile(file).toString()
            main {
                player = ExoPlayer.Builder(context).build().apply { volume = 0f }
                preparePostSoundtrack(player!!, "post-one", uri); player!!.play()
            }
            awaitPlayback()
            main {
                player!!.stop()
                assertNotNull(player!!.currentMediaItem)
                assertEquals(Player.STATE_IDLE, player!!.playbackState)
                preparePostSoundtrack(player!!, "post-one", uri); player!!.play()
            }
            awaitPlayback()
            main {
                player!!.seekTo(2500)
                preparePostSoundtrack(player!!, "post-two", uri)
                assertEquals("post-two", player!!.currentMediaItem!!.mediaId)
                assertEquals(0L, player!!.currentPosition)
                player!!.play()
            }
            awaitPlayback()
        } finally { main { player?.release() }; file.delete() }
    }
}
