package com.sautilink.nativeapp.ui

import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.os.SystemClock
import android.view.SurfaceView
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import androidx.media3.ui.PlayerView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.ui.components.NativeHlsGrantRegistry
import com.sautilink.nativeapp.ui.components.NativeShortsPreloading
import com.sautilink.nativeapp.ui.components.NativeVideoOriginDataSourceFactory
import com.sautilink.nativeapp.ui.components.NativeVideoPlaybackResources
import com.sautilink.nativeapp.ui.components.NativeVideoSource
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Exercise the production PreloadManager and real H264 decoder. All apparent
 * HTTPS requests terminate in existing synthetic native-hls assets in memory.
 * No production account, HTTP, uploads or viewer receipts are involved.
 */
@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class NativeShortsPreloadingDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val origin = "https://sautilink.com"
    private val generation = "11111111-1111-4111-8111-111111111111"
    private fun id(number: Int) = "00000000-0000-4000-8000-${number.toString().padStart(12, '0')}"
    private val paths = listOf("master.m3u8", "360.m3u8") + (0..5).map { "360-${it.toString().padStart(2, '0')}.ts" }
    private fun opaque(path: String) = (if (path.endsWith(".m3u8")) "m_" else "s_") +
        Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(path.toByteArray()))
    private fun url(number: Int, path: String) = "$origin/api/sauti-media/${id(number)}/hls/${opaque(path)}?c=fixture.${"a".repeat(43)}"
    private fun source(number: Int) = NativeVideoSource(id(number), url(number, "master.m3u8"), true,
        System.currentTimeMillis() + 300_000L, cacheKey = generation)

    private class FixtureContext(base: Context) : ContextWrapper(base) {
        val root = File(base.cacheDir, "shorts-preload-fixture-${UUID.randomUUID()}").apply { mkdirs() }
        override fun getApplicationContext(): Context = this
        override fun getCacheDir(): File = root
        override fun getDatabasePath(name: String): File = File(File(root, "databases").apply { mkdirs() }, name)
        override fun openOrCreateDatabase(name: String, mode: Int, factory: SQLiteDatabase.CursorFactory?): SQLiteDatabase =
            SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name), factory)
        override fun openOrCreateDatabase(name: String, mode: Int, factory: SQLiteDatabase.CursorFactory?,
            errorHandler: DatabaseErrorHandler?): SQLiteDatabase =
            SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name).path, factory, errorHandler)
    }

    private inner class FixtureFactory : DataSource.Factory {
        private val assets = instrumentation.context.assets
        private val opens = ConcurrentHashMap<String, AtomicInteger>()
        private val activeByMedia = ConcurrentHashMap<String, AtomicInteger>()
        private val bytesByMedia = ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicLong>()
        val active = AtomicInteger()
        val blockedMedia = AtomicReference<String?>()
        val blockedReadEntered = CountDownLatch(1)
        val releaseBlockedRead = CountDownLatch(1)

        fun opens(number: Int, path: String? = null): Int = if (path != null) opens["${id(number)}:$path"]?.get() ?: 0
            else paths.sumOf { opens["${id(number)}:$it"]?.get() ?: 0 }
        fun segmentBytes(number: Int): Long = bytesByMedia[id(number)]?.get() ?: 0L
        fun readers(number: Int): Int = activeByMedia[id(number)]?.get() ?: 0

        override fun createDataSource(): DataSource = object : DataSource {
            private var delegate: ByteArrayDataSource? = null
            private var media: String? = null
            private var segment = false
            private var counted = false
            private val listeners = mutableListOf<TransferListener>()
            override fun addTransferListener(listener: TransferListener) { listeners += listener }
            override fun open(spec: DataSpec): Long {
                check(delegate == null)
                val mediaId = spec.uri.pathSegments.getOrNull(2) ?: throw IOException("Missing synthetic media ID")
                val number = (1..3).firstOrNull { id(it) == mediaId } ?: throw IOException("Unknown synthetic media ID")
                val path = paths.firstOrNull { opaque(it) == spec.uri.lastPathSegment }
                    ?: throw IOException("Unknown synthetic resource")
                val bytes = when (path) {
                    "master.m3u8" -> "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=640x360,FRAME-RATE=30.0\n${url(number, "360.m3u8")}\n".toByteArray()
                    "360.m3u8" -> assets.open("native-hls/360.m3u8").bufferedReader().use { it.readLines() }
                        .joinToString("\n", postfix = "\n") { line -> if (line.isBlank() || line.startsWith('#')) line else url(number, line) }
                        .toByteArray()
                    else -> assets.open("native-hls/$path").use { it.readBytes() }
                }
                media = mediaId; segment = path.endsWith(".ts")
                val source = ByteArrayDataSource(bytes)
                delegate = source
                listeners.forEach(source::addTransferListener)
                val length = source.open(spec)
                counted = true; active.incrementAndGet()
                activeByMedia.getOrPut(mediaId) { AtomicInteger() }.incrementAndGet()
                opens.getOrPut("$mediaId:$path") { AtomicInteger() }.incrementAndGet()
                return length
            }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                val mediaId = checkNotNull(media)
                if (segment && mediaId == blockedMedia.get()) {
                    blockedReadEntered.countDown()
                    try {
                        if (!releaseBlockedRead.await(5, TimeUnit.SECONDS)) throw IOException("Synthetic read gate timed out")
                    } catch (interrupted: InterruptedException) {
                        Thread.currentThread().interrupt()
                        throw IOException("Synthetic preload was cancelled", interrupted)
                    }
                }
                return checkNotNull(delegate).read(buffer, offset, length).also { count ->
                    if (segment && count > 0) bytesByMedia.getOrPut(mediaId) { java.util.concurrent.atomic.AtomicLong() }.addAndGet(count.toLong())
                }
            }
            override fun getUri() = delegate?.uri
            override fun getResponseHeaders() = emptyMap<String, List<String>>()
            override fun close() {
                try { delegate?.close() } finally {
                    delegate = null
                    if (counted) { counted = false; active.decrementAndGet(); media?.let { activeByMedia[it]?.decrementAndGet() } }
                    media = null
                }
            }
        }
    }

    private inner class Harness {
        val context = FixtureContext(instrumentation.targetContext)
        val factory = FixtureFactory()
        val sources = (1..3).associateWith(::source)
        val closed = AtomicBoolean()
        val frames = ConcurrentHashMap<String, AtomicInteger>()
        val completedPreloads = ConcurrentHashMap<String, AtomicInteger>()
        val incomingFirstSegmentLoads = AtomicInteger()
        lateinit var resources: NativeVideoPlaybackResources
        lateinit var preload: NativeShortsPreloading
        var view: PlayerView? = null
        fun mount() {
            val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
            assertFalse("Unlock the device before checking a real decoder Surface", keyguard.isKeyguardLocked)
            compose.setContent {
                val grants = remember { NativeHlsGrantRegistry().apply { sources.values.forEach(::authorize) } }
                val playback = remember {
                    NativeVideoPlaybackResources(context,
                        NativeVideoOriginDataSourceFactory(origin, factory, factory, grants), { !closed.get() }, hlsGrants = grants)
                        .also { resources = it }
                }
                val manager = remember { NativeShortsPreloading(context, playback) { mediaId ->
                    completedPreloads.getOrPut(mediaId) { AtomicInteger() }.incrementAndGet()
                }.also { preload = it } }
                DisposableEffect(manager) {
                    val listener = object : Player.Listener {
                        override fun onRenderedFirstFrame() {
                            manager.player.currentMediaItem?.mediaId?.let { frames.getOrPut(it) { AtomicInteger() }.incrementAndGet() }
                        }
                    }
                    val loads = object : AnalyticsListener {
                        override fun onLoadStarted(eventTime: AnalyticsListener.EventTime, loadEventInfo: LoadEventInfo,
                            mediaLoadData: MediaLoadData) {
                            if (loadEventInfo.uri.toString() == url(2, "360-00.ts")) incomingFirstSegmentLoads.incrementAndGet()
                        }
                    }
                    manager.player.addListener(listener)
                    manager.player.addAnalyticsListener(loads)
                    manager.player.volume = 0f
                    manager.player.repeatMode = Player.REPEAT_MODE_ONE
                    onDispose {
                        if (!closed.get()) { manager.player.removeListener(listener); manager.player.removeAnalyticsListener(loads) }
                        closeOnMain()
                    }
                }
                AndroidView(factory = { PlayerView(it).apply { useController = false; player = manager.player }.also { view = it } },
                    onRelease = { it.player = null }, modifier = Modifier.requiredSize(320.dp, 180.dp))
            }
            await {
                view?.let { it.isShown && it.width > 0 && it.height > 0 &&
                    (it.videoSurfaceView as? SurfaceView)?.holder?.surface?.isValid == true } == true
            }
            compose.runOnIdle {
                assertTrue(preload.attach(sources.getValue(1), 0, 0L, true))
            }
            await { frameCount(1) > 0 && preload.player.currentPosition > 250L && preload.player.totalBufferedDuration >= 6_000L }
            compose.runOnIdle { assertNull(preload.player.playerError) }
        }
        fun frameCount(number: Int) = frames[id(number)]?.get() ?: 0
        fun closeOnMain() {
            if (closed.compareAndSet(false, true)) {
                if (this::preload.isInitialized) preload.close()
                if (this::resources.isInitialized) resources.close()
            }
        }
        fun close() {
            factory.releaseBlockedRead.countDown()
            compose.runOnIdle { closeOnMain() }
            await { factory.active.get() == 0 }
            assertEquals("All actual data sources must close after manager/player/resource disposal", 0, factory.active.get())
            assertEquals(instrumentation.targetContext.cacheDir.canonicalFile, context.root.canonicalFile.parentFile)
            context.root.deleteRecursively()
        }
    }

    private fun await(timeoutMs: Long = 15_000L, predicate: () -> Boolean) {
        compose.waitUntil(timeoutMs) { var ready = false; compose.runOnIdle { ready = predicate() }; ready }
    }
    private fun observeFor(durationMs: Long, assertion: () -> Unit) {
        val deadline = SystemClock.elapsedRealtime() + durationMs
        while (SystemClock.elapsedRealtime() < deadline) {
            compose.runOnIdle(assertion)
            SystemClock.sleep(25)
        }
    }

    @Test fun onlyNextPreloads_whileCurrentKeepsPlaying_andItsPreparedSourceHandsOffWithoutNewManifestReads() {
        val h = Harness()
        try {
            h.mount()
            assertEquals(0, h.factory.opens(2)); assertEquals(0, h.factory.opens(3))
            var prepared: androidx.media3.exoplayer.source.MediaSource? = null
            var before = 0L
            compose.runOnIdle {
                prepared = h.preload.sourceFor(h.sources.getValue(2), 1)
                assertNotNull(prepared)
                h.preload.update(0, h.sources.getValue(2), true)
                before = h.preload.player.currentPosition
            }
            await { (h.completedPreloads[id(2)]?.get() ?: 0) > 0 && h.factory.segmentBytes(2) > 0 &&
                h.factory.readers(2) == 0 && h.preload.player.currentPosition > before + 300L }
            val masterReads = h.factory.opens(2, "master.m3u8")
            val renditionReads = h.factory.opens(2, "360.m3u8")
            val firstSegmentLoads = h.incomingFirstSegmentLoads.get()
            assertTrue(masterReads > 0); assertTrue(renditionReads > 0)
            assertEquals("No source beyond the adjacent video may be fetched", 0, h.factory.opens(3))
            compose.runOnIdle {
                assertNull(h.preload.player.playerError)
                // Match the production viewer's update-before-current-source order.
                h.preload.update(1, null, false)
                val handingOff = requireNotNull(h.preload.sourceFor(h.sources.getValue(2), 1))
                assertSame("The already prepared MediaSource must be handed to the same decoder", prepared, handingOff)
                assertTrue(h.preload.attach(h.sources.getValue(2), 1, 0L, true))
            }
            await { h.frameCount(2) > 0 && h.preload.player.currentMediaItem?.mediaId == id(2) && h.preload.player.currentPosition > 250L }
            compose.runOnIdle {
                assertNull(h.preload.player.playerError)
                assertEquals("Handoff must not restart the uncached master request", masterReads, h.factory.opens(2, "master.m3u8"))
                assertEquals("Handoff must retain the parsed/prepared rendition", renditionReads, h.factory.opens(2, "360.m3u8"))
                assertEquals("Prepared sample queues must survive handoff; a disk-cache reread still means they were discarded",
                    firstSegmentLoads, h.incomingFirstSegmentLoads.get())
                assertEquals(0, h.factory.opens(3))
            }
        } finally { h.close() }
    }

    @Test fun disablingSpeculationCancelsAnInFlightAdjacentRead_andNeverStartsTheFollowingVideo() {
        val h = Harness()
        try {
            h.mount()
            h.factory.blockedMedia.set(id(2))
            compose.runOnIdle { h.preload.update(0, h.sources.getValue(2), true) }
            await { h.factory.blockedReadEntered.count == 0L && h.factory.readers(2) > 0 }
            compose.runOnIdle {
                h.preload.player.pause()
                // A swipe defers handoff, then background/offline cancellation
                // must stop it even if the new clip never attaches.
                h.preload.update(1, h.sources.getValue(3), false)
                h.preload.update(1, null, false, retainIncoming = false)
            }
            await(2_000L) { h.factory.readers(2) == 0 }
            val opens = h.factory.opens(2)
            compose.runOnIdle { h.preload.update(0, h.sources.getValue(3), false) }
            observeFor(350L) {
                assertEquals("Disabled speculation cannot restart a cancelled request", opens, h.factory.opens(2))
                assertEquals(0, h.factory.opens(3))
                assertFalse(h.preload.player.playWhenReady)
            }
            assertEquals("No bytes may escape the blocked synthetic segment after cancellation", 0L, h.factory.segmentBytes(2))
        } finally { h.close() }
    }

    @Test fun disposalCancelsAnOpenPreload_andClosedOrExpiredSourcesCannotStartMoreWork() {
        val h = Harness()
        try {
            h.mount()
            compose.runOnIdle {
                assertNull(h.preload.sourceFor(h.sources.getValue(3).copy(expiresAtMillis = System.currentTimeMillis() + 1_000L), 2))
                assertNull(h.preload.sourceFor(h.sources.getValue(3).copy(hls = false), 2))
                assertFalse(h.preload.attach(h.sources.getValue(3).copy(expiresAtMillis = System.currentTimeMillis() + 1_000L), 2, 0L, true))
            }
            assertEquals(0, h.factory.opens(3))
            h.factory.blockedMedia.set(id(2))
            compose.runOnIdle { h.preload.update(0, h.sources.getValue(2), true) }
            await { h.factory.blockedReadEntered.count == 0L && h.factory.readers(2) > 0 }
            compose.runOnIdle { h.closeOnMain() }
            await(2_000L) { h.factory.active.get() == 0 }
            val nextOpens = h.factory.opens(2)
            compose.runOnIdle {
                assertNull(h.preload.sourceFor(h.sources.getValue(3), 2))
                assertFalse(h.preload.attach(h.sources.getValue(3), 2, 0L, true))
                h.preload.update(1, h.sources.getValue(3), true)
            }
            observeFor(350L) {
                assertEquals(nextOpens, h.factory.opens(2)); assertEquals(0, h.factory.opens(3))
                assertEquals(0, h.factory.active.get())
            }
        } finally { h.close() }
    }
}
