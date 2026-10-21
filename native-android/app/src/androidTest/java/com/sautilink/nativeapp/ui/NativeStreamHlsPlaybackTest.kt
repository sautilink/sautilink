package com.sautilink.nativeapp.ui

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.ui.components.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.Base64
import java.util.concurrent.atomic.AtomicLong

private fun fixtureOpaqueRoute(path: String): String = (if (path.endsWith(".m3u8")) "m_" else "s_") +
    Base64.getUrlEncoder().withoutPadding().encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(path.toByteArray()))
private val fixtureHlsPaths = listOf("master.m3u8", "360.m3u8", "720.m3u8") +
    listOf("360", "720").flatMap { quality -> (0..5).map { "$quality-${it.toString().padStart(2, '0')}.ts" } }

/** Synthetic H264 HLS fixtures exercise the real HLS module/decoder and private
 * cache. All HTTPS-looking requests terminate in memory; no HTTP/account is used.
 */
@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class NativeStreamHlsPlaybackTest {
    @get:Rule val compose = createComposeRule()
    private val id = "00000000-0000-4000-8000-000000000001"
    private val origin = "https://sautilink.com"
    private val generation = "11111111-1111-4111-8111-111111111111"
    private fun url(path: String) = "$origin/api/sauti-media/$id/hls/${fixtureOpaqueRoute(path)}?c=ZXhhbXBsZQ.${"a".repeat(43)}"
    private fun await(timeout: Long = 15_000L, predicate: () -> Boolean) {
        compose.waitUntil(timeout) { var result = false; compose.runOnIdle { result = predicate() }; result }
    }
    private class FixtureFactory(private val content: (String) -> ByteArray) : DataSource.Factory {
        val reads = AtomicLong()
        val segmentReads = AtomicLong()
        override fun createDataSource(): DataSource {
            var delegate: ByteArrayDataSource? = null
            var segment = false
            val listeners = mutableListOf<TransferListener>()
            return object : DataSource {
                override fun addTransferListener(transferListener: TransferListener) { listeners += transferListener }
                override fun open(dataSpec: DataSpec): Long {
                    val path = fixtureHlsPaths.firstOrNull { fixtureOpaqueRoute(it) == dataSpec.uri.lastPathSegment }
                        ?: throw IOException("Unknown opaque fixture route")
                    segment = path.endsWith(".ts")
                    return ByteArrayDataSource(content(path)).also { source -> delegate = source; listeners.forEach(source::addTransferListener) }.open(dataSpec)
                }
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int = checkNotNull(delegate).read(buffer, offset, length).also {
                    if (it > 0) { reads.addAndGet(it.toLong()); if (segment) segmentReads.addAndGet(it.toLong()) }
                }
                override fun getUri() = delegate?.uri
                override fun getResponseHeaders() = emptyMap<String, List<String>>()
                override fun close() { delegate?.close(); delegate = null }
            }
        }
    }
    private fun fixtures(): FixtureFactory {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        return FixtureFactory { path ->
            when (path) {
                "master.m3u8" -> "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=640x360,FRAME-RATE=30.0\n${url("360.m3u8")}\n#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=1280x720,FRAME-RATE=30.0\n${url("720.m3u8")}\n".toByteArray()
                "360.m3u8", "720.m3u8" -> assets.open("native-hls/$path").bufferedReader().use { it.readLines() }
                    .joinToString("\n", postfix = "\n") { if (it.isBlank() || it.startsWith("#")) it else url(it) }.toByteArray()
                else -> { require(Regex("(?:360|720)-[0-9]{2}\\.ts").matches(path)); assets.open("native-hls/$path").use { it.readBytes() } }
            }
        }
    }

    @Test fun hlsDecodesBothQualities_andManualSelectionKeepsSameItemPauseSpeedAndPosition() {
        val fixture = fixtures()
        var decoder: ExoPlayer? = null
        var quality by mutableStateOf("360")
        var actual: String? = null
        var available = emptyList<Int>()
        var transitions = 0
        var loops = 0
        compose.setContent {
            val context = LocalContext.current
            val grants = remember { NativeHlsGrantRegistry().apply { authorize(NativeVideoSource(id, url("master.m3u8"), true, System.currentTimeMillis() + 300_000L, cacheKey = generation)) } }
            val resources = remember {
                NativeVideoPlaybackResources(context,
                    NativeVideoOriginDataSourceFactory(origin, fixture, fixture, grants), { true }, hlsGrants = grants)
            }
            val player = remember {
                ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(resources.dataSourceFactory)).build().apply {
                    volume = 0f
                    setMediaItem(MediaItem.Builder().setMediaId(id).setUri(url("master.m3u8")).setMimeType(MimeTypes.APPLICATION_M3U8).build())
                    prepare(); playWhenReady = true
                }.also { decoder = it }
            }
            DisposableEffect(player) {
                val listener = object : Player.Listener {
                    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                        transitions++
                        if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) loops++
                    }
                }
                player.addListener(listener)
                onDispose { player.removeListener(listener); player.release(); resources.close() }
            }
            NativeHlsQualitySelection(player, true, quality)
            actual = rememberVideoPlaybackQuality(player)
            available = rememberNativeHlsQualities(player)
            AndroidView(factory = { PlayerView(it).apply { useController = false; this.player = player } }, onRelease = { it.player = null })
        }
        await { actual == "360" && decoder!!.currentPosition > 500L }
        var item: MediaItem? = null
        var position = 0L
        var before = 0
        compose.runOnIdle {
            item = decoder!!.currentMediaItem
            assertEquals(listOf(360, 720), available)
            decoder!!.pause(); decoder!!.setPlaybackSpeed(1.5f)
            position = decoder!!.currentPosition; before = transitions
            quality = "720"
        }
        await { decoder!!.trackSelectionParameters.overrides.values.any { it.trackIndices.size == 1 && it.mediaTrackGroup.getFormat(it.trackIndices.first()).height == 720 } }
        compose.runOnIdle {
            assertEquals(item, decoder!!.currentMediaItem)
            assertFalse(decoder!!.playWhenReady)
            assertEquals(position.toDouble(), decoder!!.currentPosition.toDouble(), 300.0)
            assertEquals(1.5f, decoder!!.playbackParameters.speed)
            assertEquals(before, transitions)
            decoder!!.play()
        }
        await { actual == "720" }
        compose.runOnIdle { quality = "auto" }
        await { decoder!!.trackSelectionParameters.overrides.isEmpty() }
        compose.runOnIdle {
            assertEquals(item, decoder!!.currentMediaItem)
            assertEquals(before, transitions)
            assertEquals(1.5f, decoder!!.playbackParameters.speed)
            assertNull(decoder!!.playerError)
            decoder!!.pause()
        }
        // A real repeat-one playback must reuse the same decoded source and its
        // private segment bytes. Manifest authorization requests are not counted.
        compose.runOnIdle {
            quality = "360"; decoder!!.repeatMode = Player.REPEAT_MODE_ONE
            decoder!!.seekTo(0L); decoder!!.play()
        }
        await { actual == "360" && decoder!!.bufferedPercentage == 100 && decoder!!.currentPosition > 500L }
        var transferred = 0L
        var beforeLoop = 0
        compose.runOnIdle { transferred = fixture.segmentReads.get(); beforeLoop = loops }
        await { loops > beforeLoop && decoder!!.currentPosition > 500L }
        compose.runOnIdle {
            assertEquals(item, decoder!!.currentMediaItem)
            assertEquals(transferred, fixture.segmentReads.get())
            assertEquals(1.5f, decoder!!.playbackParameters.speed)
            assertNull(decoder!!.playerError); decoder!!.pause()
        }
    }

    @Test fun segmentReplayUsesPrivateCache_butExpiryAndAccountRevocationBlockEvenCachedBytes() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val fixture = fixtures()
        var now = 1_000L
        var accountActive = true
        val grants = NativeHlsGrantRegistry { now }
        grants.authorize(NativeVideoSource(id, url("master.m3u8"), true, 2_000L, cacheKey = generation))
        val resources = NativeVideoPlaybackResources(context, fixture, { accountActive }, hlsGrants = grants)
        fun read(): ByteArray {
            val data = resources.dataSourceFactory.createDataSource()
            try {
                data.open(DataSpec.Builder().setUri(url("360-00.ts")).build())
                val output = ByteArrayOutputStream(); val bytes = ByteArray(4096)
                while (true) { val count = data.read(bytes, 0, bytes.size); if (count == C.RESULT_END_OF_INPUT) break; output.write(bytes, 0, count) }
                return output.toByteArray()
            } finally { data.close() }
        }
        try {
            val first = read(); val transferred = fixture.reads.get()
            assertArrayEquals(first, read()); assertEquals(transferred, fixture.reads.get())
            now = 2_000L
            assertThrows(IOException::class.java) { read() }
            now = 1_000L; accountActive = false
            assertThrows(IOException::class.java) { read() }
            assertEquals(transferred, fixture.reads.get())
        } finally { resources.close() }
    }
}
