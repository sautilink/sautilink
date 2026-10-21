package com.sautilink.nativeapp.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.ui.components.VideoPlaybackControls
import com.sautilink.nativeapp.ui.components.VideoPlaybackSettingsSheet
import com.sautilink.nativeapp.ui.components.VideoSettingsButton
import com.sautilink.nativeapp.ui.components.ShortVideoProgressControls
import com.sautilink.nativeapp.ui.components.videoTimeLabel
import com.sautilink.nativeapp.ui.components.rememberVideoPlaybackQuality
import com.sautilink.nativeapp.ui.theme.SautiTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Offline controls use a bundled decoder fixture: no account, upload, or network request. */
@RunWith(AndroidJUnit4::class)
class NativeVideoPlaybackControlsTest {
    @get:Rule val compose = createComposeRule()

    private fun screenshot(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val supplied = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        val directory = File(supplied ?: (instrumentation.context.externalCacheDir ?: instrumentation.context.cacheDir).absolutePath,
            "sautilink-video-controls").apply { mkdirs() }
        File(directory, "$name.png").outputStream().use {
            assertTrue(compose.onNodeWithTag("short-timeline-capture", useUnmergedTree = true)
                .captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
    }

    private fun awaitPlayer(timeoutMillis: Long, condition: () -> Boolean) {
        compose.waitUntil(timeoutMillis) {
            var ready = false
            compose.runOnIdle { ready = condition() }
            ready
        }
    }

    @Test fun settings_preservesAutoplay_andExposesOnlyAvailableQualitiesAndSpeed() {
        var chosenQuality = "auto"
        var chosenSpeed = 1f
        var autoplay = false
        compose.setContent {
            var quality by remember { mutableStateOf("auto") }
            var speed by remember { mutableFloatStateOf(1f) }
            SautiTheme(darkTheme = false) {
                VideoPlaybackSettingsSheet(quality, "360", listOf(240, 360, 720), speed,
                    onQuality = { chosenQuality = it; quality = it },
                    onSpeed = { chosenSpeed = it; speed = it }, onDismiss = {},
                    autoplay = autoplay, onAutoplay = { autoplay = it })
            }
        }
        compose.onNodeWithText("Auto · 360p").assertIsDisplayed()
        compose.onNodeWithText("Quality").performClick()
        compose.onNodeWithText("1080p").assertDoesNotExist()
        compose.onNodeWithText("480p").assertDoesNotExist()
        compose.onNodeWithText("720p").performClick()
        compose.onNodeWithText("Playback speed").performClick()
        compose.onNodeWithText("1.5×").performClick()
        compose.runOnIdle {
            assertEquals("720", chosenQuality)
            assertEquals(1.5f, chosenSpeed)
            assertFalse("Changing quality/speed must not enable autoplay", autoplay)
        }
    }

    @Test fun unknownDecodedQuality_doesNotClaimRequestedResolution_andProtectedMediaHidesQuality() {
        compose.setContent { SautiTheme(darkTheme = true) {
            VideoPlaybackSettingsSheet("auto", null, emptyList(), 1f,
                onQuality = {}, onSpeed = {}, onDismiss = {}, qualityEnabled = false)
        } }
        compose.onNodeWithText("Quality").assertDoesNotExist()
        compose.onNodeWithText("Playback speed").assertIsDisplayed()
        compose.onNodeWithText("360p", substring = true).assertDoesNotExist()
    }

    @Test fun settingsGear_remainsStillWhileIdle_andRespondsToTouch() {
        compose.mainClock.autoAdvance = false
        var opened = 0
        compose.setContent { SautiTheme(darkTheme = true) {
            Box(Modifier.background(Color.Black)) { VideoSettingsButton(onClick = { opened++ }) }
        } }
        compose.waitForIdle()
        val gear = compose.onNodeWithContentDescription("Playback settings").assertIsDisplayed()
        val before = gear.captureToImage()
        compose.mainClock.advanceTimeBy(180)
        val after = gear.captureToImage()
        val beforePixels = IntArray(before.width * before.height)
        val afterPixels = IntArray(after.width * after.height)
        before.readPixels(beforePixels)
        after.readPixels(afterPixels)
        assertArrayEquals("The playback gear must not animate on entry or by itself", beforePixels, afterPixels)
        gear.performClick()
        compose.mainClock.advanceTimeBy(420)
        compose.runOnIdle { assertEquals(1, opened) }
    }

    @Test fun progressScrub_keepsPausedIntent_andDecoderLoopsWithoutRecreatingMedia() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val fixture = File(instrumentation.targetContext.cacheDir, "native-video-controls-fixture.mp4")
        instrumentation.context.assets.open("media-editor-62s.mp4").use { input ->
            fixture.outputStream().use { output -> input.copyTo(output) }
        }
        var decoder: ExoPlayer? = null
        var decodedQuality: String? = null
        var loops = 0
        compose.setContent {
            val context = LocalContext.current
            val player = remember {
                ExoPlayer.Builder(context).build().apply {
                    volume = 0f
                    repeatMode = Player.REPEAT_MODE_ONE
                    setMediaItem(MediaItem.Builder().setMediaId("offline-loop-fixture")
                        .setUri(Uri.fromFile(fixture)).build())
                    prepare()
                }.also { decoder = it }
            }
            DisposableEffect(player) {
                val listener = object : Player.Listener {
                    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                        if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) loops++
                    }
                }
                player.addListener(listener)
                onDispose { player.removeListener(listener); player.release() }
            }
            decodedQuality = rememberVideoPlaybackQuality(player)
            SautiTheme(darkTheme = true) {
                Box(Modifier.width(320.dp).height(240.dp)) {
                    AndroidView(factory = { ctx -> PlayerView(ctx).apply {
                        useController = false
                        this.player = player
                    } }, onRelease = { it.player = null }, modifier = Modifier.fillMaxSize())
                    VideoPlaybackControls(player, playing = false, muted = true,
                        onTogglePlayback = { if (player.playWhenReady) player.pause() else player.play() },
                        onToggleSound = {}, onOpenSettings = {}, modifier = Modifier.align(Alignment.BottomCenter))
                }
            }
        }
        awaitPlayer(10_000) { decoder?.duration?.let { it > 0 } == true }
        compose.waitUntil(5_000) {
            compose.onAllNodes(hasContentDescription("Video progress") and isEnabled()).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithContentDescription("Video progress").assertIsEnabled()
            .performSemanticsAction(SemanticsActions.SetProgress) { set -> set(10_000f) }
        awaitPlayer(5_000) { decoder?.currentPosition?.let { it in 9_000..11_000 } == true }
        awaitPlayer(5_000) { decodedQuality != null }
        compose.runOnIdle {
            assertFalse("Scrubbing must preserve an explicit pause", decoder!!.playWhenReady)
            assertEquals(Player.REPEAT_MODE_ONE, decoder!!.repeatMode)
            val savedPosition = decoder!!.currentPosition
            val savedItem = decoder!!.currentMediaItem
            decoder!!.stop()
            assertEquals("A fully offscreen cell stops decoding/loading", Player.STATE_IDLE, decoder!!.playbackState)
            assertEquals("Stopping offscreen must retain the media item", savedItem, decoder!!.currentMediaItem)
            assertFalse("Offscreen cancellation must not enable autoplay", decoder!!.playWhenReady)
            decoder!!.seekTo(savedPosition)
            decoder!!.prepare()
            decoder!!.setPlaybackSpeed(1.5f)
        }
        // stop/prepare temporarily clears duration. Seek only after the decoder
        // has a real timeline, then observe an actual repeat transition.
        awaitPlayer(10_000) { decoder?.playbackState == Player.STATE_READY && decoder!!.duration > 60_000L }
        compose.runOnIdle {
            decoder!!.seekTo(decoder!!.duration - 1_000L)
            decoder!!.play()
        }
        awaitPlayer(8_000) { loops > 0 && decoder?.currentPosition?.let { it < 5_000L } == true && decoder?.isPlaying == true }
        compose.runOnIdle {
            assertEquals("offline-loop-fixture", decoder!!.currentMediaItem!!.mediaId)
            assertEquals("Loop must retain playback speed", 1.5f, decoder!!.playbackParameters.speed)
            assertEquals("Repeat keeps the actual 128px decoded quality", "128", decodedQuality)
            decoder!!.pause()
        }
    }

    @Test fun shortTimeline_isThinWhilePlaying_expandsOnTouchAndPause_andScrubKeepsIntent() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val fixture = File(instrumentation.targetContext.cacheDir, "native-short-progress-fixture.mp4")
        instrumentation.context.assets.open("media-editor-62s.mp4").use { input ->
            fixture.outputStream().use { output -> input.copyTo(output) }
        }
        var decoder: ExoPlayer? = null
        var paused by mutableStateOf(false)
        var expanded = false
        compose.setContent {
            val context = LocalContext.current
            val player = remember {
                ExoPlayer.Builder(context).build().apply {
                    volume = 0f
                    setMediaItem(MediaItem.fromUri(Uri.fromFile(fixture)))
                    prepare(); playWhenReady = true
                }.also { decoder = it }
            }
            DisposableEffect(player) { onDispose { player.release() } }
            SautiTheme(darkTheme = true) {
                Box(Modifier.width(320.dp).height(240.dp).testTag("short-timeline-capture")) {
                    AndroidView(factory = { ctx -> PlayerView(ctx).apply { useController = false; this.player = player } },
                        onRelease = { it.player = null }, modifier = Modifier.fillMaxSize())
                    ShortVideoProgressControls(player, paused, Modifier.align(Alignment.BottomCenter),
                        onExpandedChanged = { expanded = it })
                }
            }
        }
        awaitPlayer(10_000) { decoder?.isPlaying == true && decoder?.duration?.let { it > 0L } == true }
        var totalDuration = 0L
        compose.runOnIdle { totalDuration = decoder!!.duration }
        // The timeline polls separately from the decoder. Do not freeze the
        // test clock until its real duration has reached the visible controls.
        compose.waitUntil(5_000) {
            compose.onNodeWithContentDescription("Video progress").fetchSemanticsNode()
                .config[SemanticsProperties.ProgressBarRangeInfo].range.endInclusive == totalDuration.toFloat()
        }
        compose.runOnIdle { assertFalse("No permanent timestamp row while a Short is playing", expanded) }
        compose.onNodeWithContentDescription("Pause video").assertDoesNotExist()
        compose.onNodeWithContentDescription("Play video").assertDoesNotExist()
        screenshot("short-playing-thin-progress")
        // Freeze Compose's test clock so the deliberate 2.2s touch expansion
        // cannot expire while assertions synchronize with the UI.
        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription("Video progress").performTouchInput { click(center) }
        compose.mainClock.advanceTimeBy(64)
        compose.waitUntil(5_000) { expanded }
        compose.runOnIdle { assertTrue("Touching the timeline does not pause playback", decoder!!.playWhenReady) }
        var totalLabel = ""
        compose.runOnIdle { totalLabel = videoTimeLabel(decoder!!.duration) }
        compose.onNodeWithText(totalLabel).assertIsDisplayed()
        screenshot("short-touch-expanded-progress")
        compose.runOnIdle { paused = true; decoder!!.pause() }
        compose.mainClock.advanceTimeBy(64)
        compose.onNodeWithText(totalLabel).assertIsDisplayed()
        screenshot("short-paused-duration")
        compose.onNodeWithContentDescription("Video progress")
            .performSemanticsAction(SemanticsActions.SetProgress) { set -> set(12_000f) }
        awaitPlayer(5_000) { decoder?.currentPosition?.let { it in 11_000L..13_000L } == true }
        compose.runOnIdle { assertFalse("Seeking a paused Short does not resume it", decoder!!.playWhenReady) }
        compose.mainClock.autoAdvance = true
    }
}
