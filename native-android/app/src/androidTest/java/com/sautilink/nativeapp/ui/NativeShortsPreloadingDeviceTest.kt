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
        val manifestDelayMs = java.util.concurrent.atomic.AtomicLong()
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
                val number = (1..7).firstOrNull { id(it) == mediaId } ?: throw IOException("Unknown synthetic media ID")
                val path = paths.firstOrNull { opaque(it) == spec.uri.lastPathSegment }
                    ?: throw IOException("Unknown synthetic resource")
                val bytes = when (path) {
                    "master.m3u8" -> "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=640x360,FRAME-RATE=30.0\n${url(number, "360.m3u8")}\n".toByteArray()
                    "360.m3u8" -> assets.open("native-hls/360.m3u8").bufferedReader().use { it.readLines() }
                        .joinToString("\n", postfix = "\n") { line -> if (line.isBlank() || line.startsWith('#')) line else url(number, line) }
                        .toByteArray()
                    else -> assets.open("native-hls/$path").use { it.readBytes() }
                }
                if (path.endsWith(".m3u8") && manifestDelayMs.get()>0L) try {
                    Thread.sleep(manifestDelayMs.get())
                } catch (interrupted: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw IOException("Synthetic manifest preparation cancelled",interrupted)
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
        val sources = (1..7).associateWith(::source)
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
            // Isolate the initial handoff period. Repeat-one may legitimately
            // preload later loop periods (even from disk) before this assertion;
            // those loads do not mean the initial sample queues were discarded.
            // Production and the separate real looping regressions retain ONE.
            compose.runOnIdle { h.preload.player.repeatMode = Player.REPEAT_MODE_OFF }
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

    @Test fun fiveFutureSourcesLoadSequentiallyWithoutOffscreenFrames_andRollWithinTheWindow() {
        val h=Harness()
        try {
            h.mount()
            var before=0L
            compose.runOnIdle {
                before=h.preload.player.currentPosition
                h.preload.updateWindow(0,(2..6).map { it-1 to h.sources.getValue(it) },true)
            }
            await { (2..6).all { (h.completedPreloads[id(it)]?.get() ?: 0)>0 && h.factory.segmentBytes(it)>0 } &&
                h.preload.player.isPlaying && (h.preload.player.currentPosition>before+250L || h.frameCount(1)>1) }
            val retainedManifestReads=(3..6).associateWith { h.factory.opens(it,"master.m3u8")+h.factory.opens(it,"360.m3u8") }
            compose.runOnIdle {
                assertNull(h.preload.player.playerError)
                for(number in 2..6) assertEquals("Preparing future samples must not render an offscreen video",0,h.frameCount(number))
                assertEquals("The sixth future video must remain untouched",0,h.factory.opens(7))
                assertTrue(h.preload.attach(h.sources.getValue(2),1,0L,true))
                h.preload.updateWindow(1,(3..7).map { it-1 to h.sources.getValue(it) },true)
            }
            await { h.frameCount(2)>0 && h.preload.player.currentPosition>250L &&
                (h.completedPreloads[id(7)]?.get() ?: 0)>0 && h.factory.segmentBytes(7)>0 }
            compose.runOnIdle {
                assertNull(h.preload.player.playerError)
                assertEquals("Only the selected current clip renders",0,h.frameCount(7))
                for(number in 3..6) assertEquals("Rolling preserves already prepared future manifests",
                    retainedManifestReads.getValue(number),h.factory.opens(number,"master.m3u8")+h.factory.opens(number,"360.m3u8"))
            }
        } finally { h.close() }
    }

    @Test fun previousParsedSourceReturnsWithoutNewManifestOrSampleOpens_andHistoryNeverWarmsTracks() {
        val h=Harness()
        try {
            h.mount()
            val onlyPlayer=h.preload.player
            h.factory.manifestDelayMs.set(75L)
            compose.runOnIdle { h.preload.update(0,h.sources.getValue(2),true) }
            await { (h.completedPreloads[id(2)]?.get() ?: 0)>0 && h.factory.readers(2)==0 }
            compose.runOnIdle {
                assertTrue(h.preload.attach(h.sources.getValue(2),1,0L,true))
                h.preload.updateWindow(1,emptyList(),false)
            }
            await { h.frameCount(2)>0 && h.preload.player.currentPosition>250L &&
                h.preload.player.totalBufferedDuration>=6_000L && h.factory.readers(1)==0 }
            val oldFrames=h.frameCount(1)
            val oldSampleOpens=paths.filter { it.endsWith(".ts") }.sumOf { h.factory.opens(1,it) }
            val oldSampleBytes=h.factory.segmentBytes(1)
            compose.runOnIdle {
                assertFalse("An unhealthy-current gate must not start cold history metadata",h.preload.hasPreparedHistorySource(id(1)))
                // No upcoming source is required to retain the previous one.
                h.preload.updateWindow(1,emptyList(),true)
            }
            await { h.preload.hasPreparedHistorySource(id(1)) && h.factory.readers(1)==0 }
            val masterReads=h.factory.opens(1,"master.m3u8")
            val variantReads=h.factory.opens(1,"360.m3u8")
            compose.runOnIdle {
                assertEquals("SOURCE_PREPARED must not create/load a past media period",oldSampleOpens,
                    paths.filter { it.endsWith(".ts") }.sumOf { h.factory.opens(1,it) })
                assertEquals(oldSampleBytes,h.factory.segmentBytes(1))
                assertEquals("History preparation cannot render offscreen frames",oldFrames,h.frameCount(1))
                h.preload.updateWindow(0,listOf(1 to h.sources.getValue(2)),false)
                assertTrue(h.preload.attach(h.sources.getValue(1),0,0L,true))
            }
            await { h.frameCount(1)>oldFrames && h.preload.player.currentPosition>250L }
            compose.runOnIdle {
                assertSame("History shares the single existing visible decoder",onlyPlayer,h.preload.player)
                assertNull(h.preload.player.playerError)
                assertEquals("Returning must reuse the parsed master",masterReads,h.factory.opens(1,"master.m3u8"))
                assertEquals("Returning must reuse the parsed rendition",variantReads,h.factory.opens(1,"360.m3u8"))
                assertEquals("Returning reads cached samples without any new upstream sample request",oldSampleOpens,
                    paths.filter { it.endsWith(".ts") }.sumOf { h.factory.opens(1,it) })
                assertEquals(oldSampleBytes,h.factory.segmentBytes(1))
                for(number in 3..7) { assertEquals(0,h.factory.opens(number));assertEquals(0,h.frameCount(number)) }
            }
        } finally { h.close() }
    }

    @Test fun historyOptOutAndGenerationReplacementReleaseParsedState_withoutChangingTheCurrentDecoder() {
        val h=Harness()
        try {
            h.mount()
            val onlyPlayer=h.preload.player
            compose.runOnIdle { h.preload.update(0,h.sources.getValue(2),true) }
            await { (h.completedPreloads[id(2)]?.get() ?: 0)>0 && h.factory.readers(2)==0 }
            compose.runOnIdle { assertTrue(h.preload.attach(h.sources.getValue(2),1,0L,true)) }
            await { h.frameCount(2)>0 && h.preload.player.currentPosition>250L && h.preload.player.totalBufferedDuration>=6_000L }
            compose.runOnIdle { h.preload.updateWindow(1,emptyList(),true) }
            await { h.preload.hasPreparedHistorySource(id(1)) && h.factory.readers(1)==0 }
            val firstPrepared=compose.runOnIdle { requireNotNull(h.preload.sourceFor(h.sources.getValue(1),0)) }
            val masterReads=h.factory.opens(1,"master.m3u8")
            val sampleOpens=paths.filter { it.endsWith(".ts") }.sumOf { h.factory.opens(1,it) }
            compose.runOnIdle { h.preload.updateWindow(1,emptyList(),false,retainIncoming=false) }
            val cleared=compose.runOnIdle {
                assertFalse(h.preload.hasPreparedHistorySource(id(1)))
                requireNotNull(h.preload.sourceFor(h.sources.getValue(1),0))
            }
            assertNotSame("Opt-out must release the parsed past holder, not merely clear its period",firstPrepared,cleared)
            compose.runOnIdle { h.preload.updateWindow(1,emptyList(),true) }
            await { h.preload.hasPreparedHistorySource(id(1)) && h.factory.readers(1)==0 }
            assertTrue("Re-enabling cold history must use a freshly prepared source",h.factory.opens(1,"master.m3u8")>masterReads)
            val changed=h.sources.getValue(1).copy(cacheKey="22222222-2222-4222-8222-222222222222")
            compose.runOnIdle {
                h.resources.hlsGrants.authorize(changed)
                val replacement=requireNotNull(h.preload.sourceFor(changed,0))
                assertNotSame("A new generation cannot reuse parsed state from the same URI",cleared,replacement)
                assertNotEquals("Late old-generation completion must not equal the replacement item",cleared.mediaItem,replacement.mediaItem)
                assertFalse(h.preload.hasPreparedHistorySource(id(1)))
                assertNull(h.preload.sourceFor(changed.copy(expiresAtMillis=System.currentTimeMillis()+1_000L),0))
                assertSame(onlyPlayer,h.preload.player)
                assertEquals(id(2),h.preload.player.currentMediaItem?.mediaId)
                assertNull(h.preload.player.playerError)
                assertEquals("History never requests sample data across opt-out/generation changes",sampleOpens,
                    paths.filter { it.endsWith(".ts") }.sumOf { h.factory.opens(1,it) })
            }
        } finally { h.close() }
    }

    @Test fun jumpsBeyondTheRetainedWindowAdvanceTheAnchor_andTheRollingQueueCanContinue() {
        val h=Harness()
        try {
            h.mount()
            compose.runOnIdle {
                h.preload.updateWindow(6,emptyList(),false)
                assertTrue("A new current outside the old next-five window must survive source trimming",
                    h.preload.attach(h.sources.getValue(7),6,0L,true))
            }
            await { h.frameCount(7)>0 && h.preload.player.currentPosition>250L }
            val initialFrames=h.frameCount(1)
            compose.runOnIdle {
                h.preload.updateWindow(0,listOf(1 to h.sources.getValue(2)),false)
                assertTrue("A return beyond the two retained previous items must advance the anchor too",
                    h.preload.attach(h.sources.getValue(1),0,0L,true))
            }
            await { h.frameCount(1)>initialFrames && h.preload.player.currentPosition>250L }
            compose.runOnIdle { h.preload.updateWindow(0,listOf(1 to h.sources.getValue(2)),true) }
            await { (h.completedPreloads[id(2)]?.get() ?: 0)>0 && h.factory.segmentBytes(2)>0 }
            compose.runOnIdle {
                assertNull(h.preload.player.playerError)
                assertEquals("Only the selected source may render while warming restarts",0,h.frameCount(2))
            }
        } finally { h.close() }
    }

    @Test fun incomingVisiblePageCancelsTheOldFutureLoaderBeforeAttach_withoutDiscardingItsPreparedSamples() {
        val h=Harness()
        try {
            h.mount()
            compose.runOnIdle { h.preload.player.repeatMode=Player.REPEAT_MODE_OFF }
            h.factory.blockedMedia.set(id(3))
            compose.runOnIdle {
                h.preload.updateWindow(0,(2..6).map { it-1 to h.sources.getValue(it) },true)
            }
            await { (h.completedPreloads[id(2)]?.get() ?: 0)>0 &&
                h.factory.blockedReadEntered.count==0L && h.factory.readers(3)>0 }
            val incomingMasterReads=h.factory.opens(2,"master.m3u8")
            val incomingRenditionReads=h.factory.opens(2,"360.m3u8")
            val incomingFirstLoads=h.incomingFirstSegmentLoads.get()
            compose.runOnIdle {
                // Pager intent precedes player attach. The old page's next-five
                // work must yield now, without clearing incoming clip 2.
                h.preload.updateWindow(1,(3..7).map { it-1 to h.sources.getValue(it) },false)
            }
            await(2_000L) { h.factory.readers(3)==0 }
            val cancelledOpens=h.factory.opens(3)
            observeFor(350L) {
                assertEquals(cancelledOpens,h.factory.opens(3))
                for(number in 4..7) assertEquals("Waiting for visible attach must not start speculative sources",0,h.factory.opens(number))
            }
            compose.runOnIdle { assertTrue(h.preload.attach(h.sources.getValue(2),1,0L,true)) }
            await { h.frameCount(2)>0 && h.preload.player.currentPosition>250L }
            compose.runOnIdle {
                assertNull(h.preload.player.playerError)
                assertEquals(incomingMasterReads,h.factory.opens(2,"master.m3u8"))
                assertEquals(incomingRenditionReads,h.factory.opens(2,"360.m3u8"))
                assertEquals("Yielding old speculation must preserve the incoming initial samples",incomingFirstLoads,h.incomingFirstSegmentLoads.get())
                assertEquals("A cancelled unrelated future loader must not leak bytes",0L,h.factory.segmentBytes(3))
                for(number in 4..7) assertEquals(0,h.factory.opens(number))
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
