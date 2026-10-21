package com.sautilink.nativeapp.ui

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import androidx.media3.common.Tracks
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
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.atomic.AtomicLong
import java.util.Collections

/** Real H264/AAC fMP4 decode from synthetic fixtures. Only the manifest and codec
 * init come from a short bootstrap; all actual samples use the guarded data source.
 * HTTPS-looking fixture requests terminate in memory, never in a real account.
 */
@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class NativeFmp4BootstrapPlaybackTest {
    @get:Rule val compose = createComposeRule()
    private val origin = "https://sautilink.com"
    private val id = "00000000-0000-4000-8000-000000000001"
    private val generation = "11111111-1111-4111-8111-111111111111"
    private fun url(path: String): String {
        val opaque = (if (path.endsWith(".m3u8")) "m_" else "s_") + Base64.getUrlEncoder().withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(path.toByteArray()))
        return "$origin/api/sauti-media/$id/hls/$opaque?c=payload.${"a".repeat(43)}"
    }

    @Test fun realDecoderUsesBootstrappedMap_withoutFetchingInitializationOrPlaylists() = decode(false)
    @Test fun malformedOptionalMapFallsBackToProtectedHttp_withoutLosingPlaylistBootstrap() = decode(true)

    private fun decode(invalidInit: Boolean) {
        val keyguard = InstrumentationRegistry.getInstrumentation().targetContext
            .getSystemService(android.content.Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
        assertFalse("Unlock the device before verifying a real decoder Surface", keyguard.isKeyguardLocked)
        // Fixture-only diagnostics contain fixed stages, numeric state and known
        // synthetic file labels. Never print real request URLs or error messages.
        val events = Collections.synchronizedList(mutableListOf<String>())
        fun record(value: String) { synchronized(events) { if (events.size < 80) events += value } }
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val names = listOf("master.m3u8", "index.m3u8", "init.mp4") + (0..5).map { "part-${it.toString().padStart(2, '0')}.m4s" }
        val route = names.associateBy { android.net.Uri.parse(url(it)).lastPathSegment }
        val master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=640x360,CODECS=\"avc1.42c01f,mp4a.40.2\"\n${url("index.m3u8").removePrefix(origin)}\n"
        val playlist = assets.open("native-fmp4-bootstrap/index.m3u8").bufferedReader().use { it.readLines() }
            .joinToString("\n", postfix = "\n") { line -> when {
                line.startsWith("#EXT-X-MAP:") -> "#EXT-X-MAP:URI=\"${url("init.mp4").removePrefix(origin)}\""
                line.isBlank() || line.startsWith('#') -> line
                else -> url(line).removePrefix(origin)
            } }
        val init = assets.open("native-fmp4-bootstrap/init.mp4").use { it.readBytes() }
        assertTrue(nativePlaybackInitialization(init))
        val suppliedInit = if (invalidInit) init + byteArrayOf(0, 0, 0, 8, 109, 100, 97, 116) else init
        val bundle = JSONObject().put("playlists", JSONArray().put(JSONObject().put("url", url("master.m3u8")).put("body", master))
            .put(JSONObject().put("url", url("index.m3u8")).put("body", playlist)))
            .put("initializations", JSONArray().put(JSONObject().put("url", url("init.mp4"))
                .put("base64", Base64.getEncoder().encodeToString(suppliedInit))))
        val manifestRequests = AtomicLong(); val initRequests = AtomicLong(); val sampleBytes = AtomicLong()
        val sampleRequests = AtomicLong()
        val upstream = DataSource.Factory {
            var delegate: ByteArrayDataSource? = null
            var sample = false
            val listeners = mutableListOf<TransferListener>()
            object : DataSource {
                override fun addTransferListener(value: TransferListener) { listeners += value }
                override fun open(spec: DataSpec): Long {
                    val name = route[spec.uri.lastPathSegment] ?: throw IOException("Unknown fixture resource")
                    if (name.endsWith(".m3u8")) manifestRequests.incrementAndGet()
                    if (name == "init.mp4") initRequests.incrementAndGet()
                    sample = name.endsWith(".m4s")
                    if (sample) sampleRequests.incrementAndGet()
                    record("open:$name:position=${spec.position}:length=${spec.length}")
                    val bytes = when (name) {
                        "master.m3u8" -> master.toByteArray()
                        "index.m3u8" -> playlist.toByteArray()
                        else -> assets.open("native-fmp4-bootstrap/$name").use { it.readBytes() }
                    }
                    return ByteArrayDataSource(bytes).also { delegate = it; listeners.forEach(it::addTransferListener) }.open(spec)
                        .also { record("opened:$name:bytes=$it") }
                }
                override fun read(bytes: ByteArray, offset: Int, length: Int): Int = checkNotNull(delegate).read(bytes, offset, length).also {
                    if (sample && it > 0) sampleBytes.addAndGet(it.toLong())
                }
                override fun getUri() = delegate?.uri
                override fun getResponseHeaders() = emptyMap<String, List<String>>()
                override fun close() { delegate?.close(); delegate = null }
            }
        }
        var player: ExoPlayer? = null
        var playerView: PlayerView? = null
        var rendered = false
        compose.setContent {
            val context = LocalContext.current
            val source = remember { val now = System.currentTimeMillis()
                NativeVideoSource(id, url("master.m3u8"), true, now + 300_000L, cacheKey = generation,
                    bootstrap = requireNotNull(parseNativePlaybackBootstrap(origin, "/api/sauti-media/$id", url("master.m3u8"), bundle, now))) }
            val grants = remember { NativeHlsGrantRegistry().apply { authorize(source) } }
            val resources = remember { NativeVideoPlaybackResources(context,
                NativeVideoOriginDataSourceFactory(origin, upstream, upstream, grants), { true }, hlsGrants = grants) }
            val decoder = remember { ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(resources.dataSourceFactory))
                .build().apply {
                    volume = 0f
                    addListener(object : Player.Listener {
                        override fun onRenderedFirstFrame() { rendered = true; record("firstFrame") }
                        override fun onPlaybackStateChanged(state: Int) { record("state:$state") }
                        override fun onIsLoadingChanged(isLoading: Boolean) { record("loading:$isLoading") }
                        override fun onPlayerError(error: PlaybackException) { record("error:${error.errorCodeName}") }
                        override fun onTracksChanged(tracks: Tracks) {
                            record("tracks:${tracks.groups.size}:selected=${tracks.groups.count { it.isSelected }}")
                            tracks.groups.forEach { group ->
                                for (index in 0 until group.length) {
                                    val format = group.getTrackFormat(index)
                                    record("track:type=${group.type}:selected=${group.isTrackSelected(index)}:support=${group.getTrackSupport(index)}:mime=${format.sampleMimeType}:width=${format.width}:height=${format.height}")
                                }
                            }
                        }
                    })
                    setMediaItem(MediaItem.Builder().setMediaId(id).setUri(source.url).setMimeType(MimeTypes.APPLICATION_M3U8).build())
                }.also { player = it } }
            DisposableEffect(decoder) { onDispose { decoder.release(); resources.close() } }
            AndroidView(factory = { PlayerView(it).apply { useController = false; this.player = decoder }.also { playerView = it } },
                // The test activity's otherwise-empty wrap-content root does not
                // give fillMaxSize a nonzero intrinsic height. Real decoder proof
                // requires a measured, shown Surface, not audio-only advancement.
                onRelease = { it.player = null }, modifier = Modifier.requiredSize(320.dp, 180.dp))
        }
        val deadline = android.os.SystemClock.uptimeMillis() + 15_000L
        fun remaining() = (deadline - android.os.SystemClock.uptimeMillis()).coerceAtLeast(1L)
        try {
            compose.waitUntil(remaining()) { var result = false; compose.runOnIdle {
                val view = playerView
                result = view?.isShown == true && view.width > 0 && view.height > 0 &&
                    (view.videoSurfaceView as? android.view.SurfaceView)?.holder?.surface?.isValid == true
            }; result }
            compose.runOnIdle {
                record("surfaceReady")
                player!!.prepare(); player!!.playWhenReady = true
            }
            compose.waitUntil(remaining()) { var result = false; compose.runOnIdle {
                result = (rendered && player!!.currentPosition > 250L) || player!!.playerError != null
            }; result }
        } finally {
            compose.runOnIdle {
                val value = checkNotNull(player)
                record("final:state=${value.playbackState}:suppression=${value.playbackSuppressionReason}:loading=${value.isLoading}:play=${value.playWhenReady}:rendered=$rendered:position=${value.currentPosition}:buffered=${value.bufferedPosition}:duration=${value.duration}:tracks=${value.currentTracks.groups.size}:error=${value.playerError?.errorCodeName ?: "none"}")
                record("requests:manifest=${manifestRequests.get()}:init=${initRequests.get()}:samples=${sampleRequests.get()}:sampleBytes=${sampleBytes.get()}")
                record("formats:video=${value.videoFormat?.sampleMimeType}:audio=${value.audioFormat?.sampleMimeType}:videoSize=${value.videoSize.width}x${value.videoSize.height}")
                val view = playerView
                val surface = view?.videoSurfaceView
                record("view:shown=${view?.isShown}:size=${view?.width}x${view?.height}:attached=${view?.isAttachedToWindow}:surfaceType=${if (surface is android.view.SurfaceView) "surface" else if (surface is android.view.TextureView) "texture" else "none"}:surfaceValid=${(surface as? android.view.SurfaceView)?.holder?.surface?.isValid}")
            }
            android.util.Log.i("NativeFmp4Fixture", "invalidOptionalInit=$invalidInit ${synchronized(events) { events.joinToString(" | ") }}")
        }
        compose.runOnIdle {
            assertNull(player!!.playerError)
            assertTrue("The real fMP4 decoder must render and advance", rendered && player!!.currentPosition > 250L)
            assertTrue(sampleBytes.get() > 0L)
            assertEquals(0L, manifestRequests.get())
            assertEquals(if (invalidInit) 1L else 0L, initRequests.get())
            player!!.pause()
        }
    }
}
