package com.sautilink.nativeapp.feature.music

import android.os.SystemClock
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.PlaybackParameters
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

class NativeSoundtrackSyncTest {
    @get:Rule val compose = createComposeRule()
    private fun wav(): File {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val bytes = ByteArray(8000 * 2 * 12)
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray()).putInt(bytes.size+36).put("WAVEfmt ".toByteArray())
            .putInt(16).putShort(1).putShort(1).putInt(8000).putInt(16000).putShort(2).putShort(16)
            .put("data".toByteArray()).putInt(bytes.size)
        return File(context.cacheDir, "soundtrack-sync-fixture.wav").apply { writeBytes(header.array()+bytes) }
    }

    @Test fun musicWaitsForVideoFrame_thenFollowsPauseSeekAndSpeed() {
        val file = wav()
        lateinit var video: ExoPlayer
        lateinit var music: ExoPlayer
        var videoPlaying by mutableStateOf(false)
        var musicPlaying by mutableStateOf(false)
        var musicSpeed by mutableFloatStateOf(1f)
        var frameReady by mutableStateOf(false)
        compose.runOnIdle {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            video = ExoPlayer.Builder(context).build().apply {
                volume = 0f
                addListener(object : Player.Listener { override fun onIsPlayingChanged(value: Boolean) { videoPlaying = value } })
                setMediaItem(MediaItem.Builder().setUri(file.toURI().toString()).setMediaId("video-fixture").build())
                prepare(); play()
            }
            music = ExoPlayer.Builder(context).build().apply {
                volume = 0f
                addListener(object : Player.Listener {
                    override fun onIsPlayingChanged(value: Boolean) { musicPlaying = value }
                    override fun onPlaybackParametersChanged(value: PlaybackParameters) { musicSpeed = value.speed }
                })
            }
        }
        try {
            compose.setContent {
                NativeSyncedPostSoundtrack(music, "post", true,
                    NativePostVideoClock("post", "video-fixture", video, true, frameReady, videoPlaying), 3000L,
                    prepare = { preparePostSoundtrack(music, "post", file.toURI().toString()); true })
            }
            compose.waitUntil(10000) { videoPlaying }
            SystemClock.sleep(300)
            compose.runOnIdle { assertFalse("Music must stay silent until a video frame is visible", music.isPlaying); frameReady = true }
            compose.waitUntil(5000) { musicPlaying }
            compose.runOnIdle { video.pause() }
            compose.waitUntil(5000) { !musicPlaying }
            compose.runOnIdle { video.seekTo(5000L); video.play() }
            compose.waitUntil(5000) { musicPlaying }
            SystemClock.sleep(350)
            compose.runOnIdle {
                val target = soundtrackVideoPosition(video.currentPosition, 3000L)
                assertTrue("Music must follow a video seek", soundtrackCircularDrift(music.currentPosition, target, 3000L) < 250L)
                video.setPlaybackSpeed(1.5f)
            }
            compose.waitUntil(5000) { musicSpeed == 1.5f }
            compose.runOnIdle { frameReady = false }
            compose.waitUntil(5000) { !musicPlaying }
        } finally { compose.runOnIdle { video.release(); music.release() }; file.delete() }
    }

    @Test fun photosAndTextPlayNormally_andCurrentVideoPlaceholdersBlockMusic() {
        val file = wav()
        lateinit var music: ExoPlayer
        var musicPlaying by mutableStateOf(false)
        var video by mutableStateOf(false)
        compose.runOnIdle {
            music = ExoPlayer.Builder(InstrumentationRegistry.getInstrumentation().targetContext).build().apply {
                volume = 0f
                addListener(object : Player.Listener { override fun onIsPlayingChanged(value: Boolean) { musicPlaying = value } })
            }
        }
        try {
            compose.setContent {
                NativeSyncedPostSoundtrack(music, "photo", true,
                    if (video) NativePostVideoClock("post", "loading-video", null, true, false, false) else null,
                    3000L, prepare = { preparePostSoundtrack(music, "photo", file.toURI().toString()); true })
            }
            compose.waitUntil(5000) { musicPlaying }
            compose.runOnIdle { video = true }
            compose.waitUntil(5000) { !musicPlaying }
            compose.runOnIdle { video = false }
            compose.waitUntil(5000) { musicPlaying }
        } finally { compose.runOnIdle { music.release() }; file.delete() }
    }

    @Test fun aVideoRegistersBeforeItsPlayerExists_andPhotoCarouselSelectionDoesNotWaitForIt() {
        val session = NativeMusicComposer {}
        var current by mutableStateOf(true)
        compose.setContent {
            CompositionLocalProvider(LocalNativeMusicComposer provides session) {
                BindNativePostVideoClock(null, "post", "video", current, false, false)
                Text(if (session.currentVideo("post") == null) "Photo soundtrack" else "Waiting for video")
            }
        }
        compose.onNodeWithText("Waiting for video").assertExists()
        compose.runOnIdle { current = false }
        compose.onNodeWithText("Photo soundtrack").assertExists()
    }
}
