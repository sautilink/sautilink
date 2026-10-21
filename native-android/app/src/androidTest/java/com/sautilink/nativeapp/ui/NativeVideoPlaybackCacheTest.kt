package com.sautilink.nativeapp.ui

import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.ui.components.NativeVideoPlaybackResources
import com.sautilink.nativeapp.ui.components.cacheableVideoUri
import com.sautilink.nativeapp.ui.components.NativeVideoDataSourceFactory
import com.sautilink.nativeapp.ui.components.NativeVideoRepresentationPins
import com.sautilink.nativeapp.ui.components.NativeVideoOriginDataSourceFactory
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.lang.reflect.Proxy

/** Actual CacheDataSource + private files with a synthetic byte-array upstream.
 * No account, bearer credentials, HTTP, uploads or user media are involved.
 */
@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class NativeVideoPlaybackCacheTest {
    private val media = "https://sautilink.com/api/sauti-media/11111111-1111-4111-8111-111111111111"
    private val bytes = ByteArray(128 * 1024) { index -> ((index * 37 + index / 257) % 251).toByte() }

    private class FixtureContext(base: Context) : ContextWrapper(base) {
        val root = File(base.cacheDir, "playback-cache-fixture-${UUID.randomUUID()}").apply { mkdirs() }
        var brokenCacheRoot = false
        override fun getApplicationContext(): Context = this
        override fun getCacheDir(): File = if (brokenCacheRoot)
            File(root, "not-a-directory").apply { if (!exists()) writeText("fixture") } else root
        override fun getDatabasePath(name: String): File = File(File(root, "databases").apply { mkdirs() }, name)
        override fun openOrCreateDatabase(name: String, mode: Int, factory: SQLiteDatabase.CursorFactory?): SQLiteDatabase =
            SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name), factory)
        override fun openOrCreateDatabase(name: String, mode: Int, factory: SQLiteDatabase.CursorFactory?,
            errorHandler: DatabaseErrorHandler?): SQLiteDatabase =
            SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name).path, factory, errorHandler)
    }

    private class CountingUpstream(private val bytes: ByteArray) : DataSource.Factory {
        val reads = AtomicLong(0)
        val opens = mutableListOf<Pair<Long, Long>>()
        override fun createDataSource(): DataSource {
            val source = ByteArrayDataSource(bytes)
            return object : DataSource {
                override fun addTransferListener(transferListener: TransferListener) = source.addTransferListener(transferListener)
                override fun open(dataSpec: DataSpec): Long {
                    opens += dataSpec.position to dataSpec.length
                    return source.open(dataSpec)
                }
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
                    source.read(buffer, offset, length).also { if (it > 0) reads.addAndGet(it.toLong()) }
                override fun getUri(): Uri? = source.uri
                override fun getResponseHeaders(): Map<String, List<String>> = source.responseHeaders
                override fun close() = source.close()
            }
        }
    }

    /** The published endpoint changes a cold quality URL from the original to a
     * differently sized MP4 once its rendition is ready. The real adapter must
     * keep the selected representation across both byte-cache hits and misses.
     */
    private class WarmingHttpServer(val original: ByteArray, val rendition: ByteArray) {
        var ready = false
        var readBytes = 0L
        val requests = mutableListOf<DataSpec>()
        fun factory(): HttpDataSource.Factory = Proxy.newProxyInstance(HttpDataSource.Factory::class.java.classLoader,
            arrayOf(HttpDataSource.Factory::class.java)) { _, method, _ ->
            when (method.name) { "createDataSource" -> http(); else -> error("Unexpected factory operation: ${method.name}") }
        } as HttpDataSource.Factory
        private fun http(): HttpDataSource {
            var spec: DataSpec? = null
            var body = byteArrayOf()
            var offset = 0
            var headers = emptyMap<String, List<String>>()
            return Proxy.newProxyInstance(HttpDataSource::class.java.classLoader, arrayOf(HttpDataSource::class.java)) { _, method, args ->
                when (method.name) {
                    "open" -> {
                        val request = args!![0] as DataSpec
                        spec = request; requests += request
                        val variant = ready && request.uri.encodedQuery != null
                        val bytes = if (variant) rendition else original
                        if (request.position >= bytes.size) throw IOException("Synthetic representation offset is outside file")
                        val remaining = bytes.size.toLong() - request.position
                        val count = minOf(remaining, request.length.takeIf { it >= 0L } ?: remaining, 32L * 1024)
                        body = bytes.copyOfRange(request.position.toInt(), (request.position + count).toInt()); offset = 0
                        headers = mapOf("Content-Length" to listOf(count.toString()),
                            "Content-Range" to listOf("bytes ${request.position}-${request.position + count - 1}/${bytes.size}"),
                            "Content-Type" to listOf("video/mp4"), "ETag" to listOf(if (variant) "rendition-etag" else "original-etag"),
                            "X-Sauti-Media-Variant" to listOf(if (variant) "video-v2;q=360" else "original"))
                        count
                    }
                    "read" -> {
                        val target = args!![0] as ByteArray; val start = args[1] as Int; val requested = args[2] as Int
                        val count = minOf(requested, body.size - offset)
                        if (requested == 0) 0 else if (count <= 0) C.RESULT_END_OF_INPUT else {
                            body.copyInto(target, start, offset, offset + count); offset += count; readBytes += count; count
                        }
                    }
                    "getUri" -> spec?.uri
                    "getResponseHeaders" -> headers
                    "getResponseCode" -> 206
                    "close", "addTransferListener", "setRequestProperty", "clearRequestProperty", "clearAllRequestProperties" -> null
                    else -> error("Unexpected HTTP operation: ${method.name}")
                }
            } as HttpDataSource
        }
    }

    private fun spec(url: String = media, position: Long = 0,
        length: Long = C.LENGTH_UNSET.toLong(), key: String? = null) = DataSpec.Builder()
        .setUri(url).setPosition(position).setLength(length).setKey(key).build()

    private fun read(factory: DataSource.Factory, dataSpec: DataSpec, vararg listeners: TransferListener): ByteArray {
        val source = factory.createDataSource()
        try {
            listeners.forEach(source::addTransferListener)
            source.open(dataSpec)
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(7 * 1024)
            while (true) {
                val count = source.read(buffer, 0, buffer.size)
                if (count == C.RESULT_END_OF_INPUT) break
                assertTrue("A non-empty source request must advance", count > 0)
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        } finally { source.close() }
    }

    private fun activeDirectories(context: FixtureContext) =
        context.root.listFiles().orEmpty().filter { it.name.startsWith("active-video-") }

    private inline fun fixture(block: (FixtureContext) -> Unit) {
        val context = FixtureContext(InstrumentationRegistry.getInstrumentation().targetContext)
        try { block(context) } finally {
            // A generated test-only directory under this app's cache, never user media.
            check(context.root.canonicalFile.parentFile == InstrumentationRegistry.getInstrumentation()
                .targetContext.cacheDir.canonicalFile)
            context.root.deleteRecursively()
        }
    }

    @Test fun loopReplayIsByteIdentical_andDoesNotReadTheNetworkUpstreamAgain() = fixture { context ->
        val upstream = CountingUpstream(bytes)
        val resources = NativeVideoPlaybackResources(context, upstream, { true })
        try {
            assertArrayEquals(bytes, read(resources.dataSourceFactory, spec()))
            assertEquals(bytes.size.toLong(), upstream.reads.get())
            val opens = upstream.opens.size
            assertArrayEquals(bytes, read(resources.dataSourceFactory, spec()))
            assertEquals("Completed replay must reuse every previously read byte", bytes.size.toLong(), upstream.reads.get())
            assertEquals("Replay must not reopen the upstream", opens, upstream.opens.size)
        } finally { resources.close() }
        assertTrue("Closing the player removes its private cache directory", activeDirectories(context).isEmpty())
    }

    @Test fun seekReusesCachedSpans_andFetchesOnlyUncachedBytes() = fixture { context ->
        val upstream = CountingUpstream(bytes)
        val resources = NativeVideoPlaybackResources(context, upstream, { true })
        try {
            assertArrayEquals(bytes.copyOfRange(0, 64 * 1024),
                read(resources.dataSourceFactory, spec(length = 64L * 1024)))
            assertEquals(64L * 1024, upstream.reads.get())
            assertArrayEquals(bytes.copyOfRange(32 * 1024, 96 * 1024),
                read(resources.dataSourceFactory, spec(position = 32L * 1024, length = 64L * 1024)))
            assertEquals("The overlapping cached half must not be fetched twice", 96L * 1024, upstream.reads.get())
            assertArrayEquals(bytes, read(resources.dataSourceFactory, spec()))
            assertEquals(bytes.size.toLong(), upstream.reads.get())
            val reads = upstream.reads.get()
            assertArrayEquals(bytes.copyOfRange(17 * 1024, 35 * 1024),
                read(resources.dataSourceFactory, spec(position = 17L * 1024, length = 18L * 1024)))
            assertEquals(reads, upstream.reads.get())
        } finally { resources.close() }
    }

    @Test fun partialOriginalCacheRetainsItsPinAcrossMoreThan32Clips_whenQualityWarms() = fixture { context ->
        val server = WarmingHttpServer(bytes, ByteArray(96 * 1024) { 77 })
        val pins = NativeVideoRepresentationPins()
        val adapter = NativeVideoDataSourceFactory(server.factory(), pins::retains)
        val resources = NativeVideoPlaybackResources(context, adapter, { true }, representationPins = pins)
        val first = "$media?quality=360"
        try {
            assertArrayEquals(bytes.copyOfRange(0, 16 * 1024),
                read(resources.dataSourceFactory, spec(first, length = 16L * 1024)))
            // The total cached bytes stay far below the 32MiB limit, but the old
            // independent adapter LRU would now forget the first URI's pin.
            repeat(40) { index ->
                val id = (index + 2).toString().padStart(12, '0')
                val uri = "https://sautilink.com/api/sauti-media/11111111-1111-4111-8111-$id?quality=360"
                assertArrayEquals(bytes.copyOfRange(0, 16 * 1024),
                    read(resources.dataSourceFactory, spec(uri, length = 16L * 1024)))
            }
            server.ready = true
            val requestCount = server.requests.size
            assertArrayEquals("Cached original header/frames and later ranges must never mix with a newly warmed MP4",
                bytes, read(resources.dataSourceFactory, spec(first)))
            assertTrue(server.requests.drop(requestCount).all { it.uri.encodedQuery == null })
            val fetched = server.readBytes
            assertArrayEquals(bytes, read(resources.dataSourceFactory, spec(first)))
            assertEquals("The completed replay remains a byte-cache hit", fetched, server.readBytes)
        } finally { resources.close() }
    }

    @Test fun cacheIdentityBudgetBoundsPins_andAdditionalVideosStillPlayWithoutCaching() = fixture { context ->
        val upstream = CountingUpstream(bytes)
        val pins = NativeVideoRepresentationPins(maxCachedKeys = 2)
        val resources = NativeVideoPlaybackResources(context, upstream, { true }, representationPins = pins)
        try {
            listOf("$media?quality=240", "$media?quality=360", "$media?quality=720").forEach { uri ->
                assertArrayEquals(bytes, read(resources.dataSourceFactory, spec(uri)))
            }
            assertEquals(3L * bytes.size, upstream.reads.get())
            assertArrayEquals(bytes, read(resources.dataSourceFactory, spec("$media?quality=240")))
            assertEquals("Admitted bytes still replay from their original bounded cache", 3L * bytes.size, upstream.reads.get())
            assertArrayEquals(bytes, read(resources.dataSourceFactory, spec("$media?quality=720")))
            assertEquals("Beyond the metadata budget, online playback remains available without new cache identities",
                4L * bytes.size, upstream.reads.get())
        } finally { resources.close() }
    }

    @Test fun accountOrSessionRevocationBlocksEvenFullyCachedBytes_andAlreadyOpenReaders() = fixture { context ->
        val upstream = CountingUpstream(bytes)
        val session = AtomicBoolean(true)
        val resources = NativeVideoPlaybackResources(context, upstream, session::get)
        try {
            read(resources.dataSourceFactory, spec())
            val readBefore = upstream.reads.get()
            val source = resources.dataSourceFactory.createDataSource()
            try {
                source.open(spec())
                assertEquals(32, source.read(ByteArray(32), 0, 32))
                session.set(false)
                try {
                    source.read(ByteArray(32), 0, 32)
                    fail("A reader must not expose cached bytes after its owning session ends")
                } catch (_: IOException) { }
            } finally { source.close() }
            try {
                read(resources.dataSourceFactory, spec())
                fail("A revoked session must not open a cached video")
            } catch (_: IOException) { }
            assertEquals(readBefore, upstream.reads.get())
        } finally { resources.close() }
    }

    @Test fun protectedAndNoncanonicalMp4RoutesBypassDiskCacheOnEveryRead() = fixture { context ->
        val protected = "https://sautilink.com/api/rooms/22222222-2222-4222-8222-222222222222/" +
            "post-submissions/33333333-3333-4333-8333-333333333333/media/11111111-1111-4111-8111-111111111111"
        val urls = listOf(protected, "$media?poster=1", "$media?quality=360&extra=1", "$media?quality=360&quality=480",
            "$media#fragment", media.replace("https://", "http://"),
            media.replace("/api/sauti-media/", "/api/%73auti-media/"))
        urls.forEach { url ->
            assertFalse("Only canonical immutable video bytes may enter the cache: $url", cacheableVideoUri(Uri.parse(url)))
            val upstream = CountingUpstream(bytes)
            val resources = NativeVideoPlaybackResources(context, upstream, { true })
            try {
                assertArrayEquals(bytes, read(resources.dataSourceFactory, spec(url)))
                assertArrayEquals(bytes, read(resources.dataSourceFactory, spec(url)))
                assertEquals(bytes.size.toLong() * 2, upstream.reads.get())
            } finally { resources.close() }
        }
    }

    @Test fun protectedRoomVideoRetainsItsAuthenticatedRoute_andNeverReplaysFromDisk() = fixture { context ->
        val protected = "https://sautilink.com/api/rooms/22222222-2222-4222-8222-222222222222/" +
            "post-submissions/33333333-3333-4333-8333-333333333333/media/11111111-1111-4111-8111-111111111111"
        val upstream = CountingUpstream(bytes)
        val session = AtomicBoolean(true)
        val routed = NativeVideoOriginDataSourceFactory("https://sautilink.com", upstream)
        val resources = NativeVideoPlaybackResources(context, routed, session::get)
        try {
            repeat(2) { assertArrayEquals(bytes, read(resources.dataSourceFactory, spec(protected))) }
            assertEquals(2, upstream.opens.size)
            assertEquals(2L * bytes.size, upstream.reads.get())
            assertTrue(context.root.walkTopDown().none { it.isFile && it.extension == "exo" })
            session.set(false)
            assertThrows(IOException::class.java) { read(resources.dataSourceFactory, spec(protected)) }
            assertEquals(2, upstream.opens.size)
        } finally { resources.close() }
    }

    @Test fun malformedOrUngrantedHlsCannotReachUpstreamOrPopulateDiskCache() = fixture { context ->
        val urls = listOf("$media/hls/../private.ts", "$media/hls/%2e%2e/private.ts", "$media/hls//segment.ts",
            "$media/hls/s_${"A".repeat(43)}?c=ZXhhbXBsZQ.${"a".repeat(43)}")
        val upstream = CountingUpstream(bytes)
        val resources = NativeVideoPlaybackResources(context, upstream, { true })
        try {
            urls.forEach { url ->
                assertFalse(cacheableVideoUri(Uri.parse(url)))
                repeat(2) { assertThrows(IOException::class.java) { read(resources.dataSourceFactory, spec(url)) } }
            }
            assertTrue("Rejected HLS requests must not open any upstream", upstream.opens.isEmpty())
            assertEquals(0L, upstream.reads.get())
            assertTrue("Rejected HLS requests must not create cached payloads",
                context.root.walkTopDown().none { it.isFile && it.extension == "exo" })
            // Rejection must not poison the same player's allowed canonical cache.
            assertArrayEquals(bytes, read(resources.dataSourceFactory, spec()))
            assertArrayEquals(bytes, read(resources.dataSourceFactory, spec()))
            assertEquals(bytes.size.toLong(), upstream.reads.get())
        } finally { resources.close() }
    }

    @Test fun distinctRenditionsCannotAliasThroughACustomMedia3CacheKey() = fixture { context ->
        val upstream = CountingUpstream(bytes)
        val resources = NativeVideoPlaybackResources(context, upstream, { true })
        try {
            read(resources.dataSourceFactory, spec("$media?quality=360", key = "same-custom-key"))
            val afterFirst = upstream.reads.get()
            read(resources.dataSourceFactory, spec("$media?quality=720", key = "same-custom-key"))
            assertEquals("Separate representation URLs must populate separate spans", afterFirst + bytes.size, upstream.reads.get())
            read(resources.dataSourceFactory, spec("$media?quality=360", key = "some-other-key"))
            assertEquals("The canonical same URL reuses its original bytes", afterFirst + bytes.size, upstream.reads.get())
        } finally { resources.close() }
    }

    @Test fun disposalIsIdempotent_forbidsReuse_andNewPlayerReauthorizesUpstream() = fixture { context ->
        val upstream = CountingUpstream(bytes)
        val resources = NativeVideoPlaybackResources(context, upstream, { true })
        read(resources.dataSourceFactory, spec())
        assertEquals(1, activeDirectories(context).size)
        resources.close()
        resources.close()
        assertTrue(activeDirectories(context).isEmpty())
        try {
            read(resources.dataSourceFactory, spec())
            fail("A disposed player may not reopen even its previous complete cache")
        } catch (_: IOException) { }
        val newPlayer = NativeVideoPlaybackResources(context, upstream, { true })
        try {
            assertArrayEquals(bytes, read(newPlayer.dataSourceFactory, spec()))
            assertEquals("A new player must reauthorize instead of inheriting the previous private cache",
                bytes.size.toLong() * 2, upstream.reads.get())
        } finally { newPlayer.close() }
        assertTrue(activeDirectories(context).isEmpty())
    }

    @Test fun staleGeneratedDirectoriesArePruned_withoutDeletingLivePlayersOrOtherCacheFiles() = fixture { context ->
        val upstream = CountingUpstream(bytes)
        val first = NativeVideoPlaybackResources(context, upstream, { true })
        try {
            read(first.dataSourceFactory, spec())
            val liveDirectory = activeDirectories(context).single()
            val orphan = File(context.root, "active-video-${UUID.randomUUID()}").apply {
                mkdirs()
                File(this, "old-segment.fixture").writeText("stale fixture bytes")
            }
            val unrelated = File(context.root, "unrelated-cache").apply { mkdirs() }
            val second = NativeVideoPlaybackResources(context, upstream, { true })
            try {
                assertFalse("Crash leftovers are removed when the next player starts", orphan.exists())
                assertTrue("A currently live player keeps its cache", liveDirectory.exists())
                assertTrue("Unrelated app cache entries are never pruned", unrelated.exists())
                val beforeReplay = upstream.reads.get()
                assertArrayEquals(bytes, read(first.dataSourceFactory, spec()))
                assertEquals(beforeReplay, upstream.reads.get())
            } finally { second.close() }
        } finally { first.close() }
        assertTrue(activeDirectories(context).isEmpty())
    }

    @Test fun unavailablePrivateCacheFallsBackToUpstream_withoutCrashingCreationOrDisposal() = fixture { context ->
        context.brokenCacheRoot = true
        val upstream = CountingUpstream(bytes)
        val resources = NativeVideoPlaybackResources(context, upstream, { true })
        try {
            assertArrayEquals(bytes, read(resources.dataSourceFactory, spec()))
            assertArrayEquals(bytes, read(resources.dataSourceFactory, spec()))
            assertEquals("Unavailable cache remains functional through its authenticated upstream",
                bytes.size.toLong() * 2, upstream.reads.get())
        } finally { resources.close(); resources.close() }
    }

    @Test fun actualTransferBytesAndTimeDriveHighLowHighBandwidth_andCacheReplayIsNotNetwork() = fixture { context ->
        val payload = ByteArray(600 * 1024) { (it % 251).toByte() }
        val delay = AtomicLong(2L)
        val networkBytes = AtomicLong(0L)
        val networkFlags = mutableListOf<Boolean>()
        val upstream = DataSource.Factory {
            object : BaseDataSource(true) {
                private val source = ByteArrayDataSource(payload)
                private var open = false
                override fun open(dataSpec: DataSpec): Long {
                    transferInitializing(dataSpec)
                    val available = source.open(dataSpec)
                    transferStarted(dataSpec)
                    open = true
                    return available
                }
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                    Thread.sleep(delay.get())
                    return source.read(buffer, offset, minOf(length, 16 * 1024)).also { count ->
                        if (count > 0) { networkBytes.addAndGet(count.toLong()); bytesTransferred(count) }
                    }
                }
                override fun getUri(): Uri? = source.uri
                override fun close() {
                    try { source.close() } finally { if (open) { open = false; transferEnded() } }
                }
            }
        }
        val meter = DefaultBandwidthMeter.Builder(context).setInitialBitrateEstimate(4_000_000)
            .setSlidingWindowMaxWeight(100).setResetOnNetworkTypeChange(false).build()
        val meterListener = checkNotNull(meter.transferListener)
        val probe = object : TransferListener {
            override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) = Unit
            override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) { networkFlags += isNetwork }
            override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) = Unit
            override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) = Unit
        }
        val resources = NativeVideoPlaybackResources(context, upstream, { true })
        try {
            assertArrayEquals(payload, read(resources.dataSourceFactory, spec("$media?quality=360"), meterListener, probe))
            val high = meter.bitrateEstimate
            delay.set(80L)
            assertArrayEquals(payload, read(resources.dataSourceFactory, spec("$media?quality=480"), meterListener, probe))
            val low = meter.bitrateEstimate
            assertTrue("Measured slow transfers must lower the real estimator: high=$high low=$low", low < high / 3)
            delay.set(2L)
            assertArrayEquals(payload, read(resources.dataSourceFactory, spec("$media?quality=720"), meterListener, probe))
            val recovered = meter.bitrateEstimate
            assertTrue("Measured fast transfers must recover the estimator: low=$low recovered=$recovered", recovered > low * 3)
            assertTrue(networkFlags.any { it })
            networkFlags.clear()
            val beforeReplay = networkBytes.get()
            assertArrayEquals(payload, read(resources.dataSourceFactory, spec("$media?quality=720"), meterListener, probe))
            assertEquals(beforeReplay, networkBytes.get())
            assertEquals("Cached bytes must not inflate network throughput", recovered, meter.bitrateEstimate)
            assertTrue("Cache transfers retain their non-network flag", networkFlags.isNotEmpty() && networkFlags.none { it })
        } finally { resources.close() }
    }
}
