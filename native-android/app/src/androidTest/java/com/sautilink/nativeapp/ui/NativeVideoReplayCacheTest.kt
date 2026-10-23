package com.sautilink.nativeapp.ui

import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sautilink.nativeapp.ui.components.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/** Real SimpleCache/CacheDataSource remount regression, with byte-array upstream.
 * No account, token, HTTP, uploads, viewer receipts or real media are involved.
 */
@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
class NativeVideoReplayCacheTest {
    private val owner = Any()
    private val account = "fixture-account"
    private val id = "00000000-0000-4000-8000-000000000001"
    private val generation = "11111111-1111-4111-8111-111111111111"
    private val nextGeneration = "22222222-2222-4222-8222-222222222222"
    private val origin = "https://sautilink.com"
    private val scope = NativeVideoReplayScope(owner, account, "fixture-credential")
    private val payload = ByteArray(96 * 1024) { ((it * 37 + it / 257) % 251).toByte() }

    private class FixtureContext(base: Context) : ContextWrapper(base) {
        val root = File(base.cacheDir, "replay-cache-fixture-${UUID.randomUUID()}").apply { mkdirs() }
        var broken = false
        override fun getApplicationContext(): Context = this
        override fun getCacheDir(): File = if (broken) File(root, "not-a-directory").apply {
            if (!exists()) writeText("fixture")
        } else root
        override fun getDatabasePath(name: String): File = File(File(root, "databases").apply { mkdirs() }, name)
        override fun openOrCreateDatabase(name: String, mode: Int, factory: SQLiteDatabase.CursorFactory?): SQLiteDatabase =
            SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name), factory)
        override fun openOrCreateDatabase(name: String, mode: Int, factory: SQLiteDatabase.CursorFactory?,
            errorHandler: DatabaseErrorHandler?): SQLiteDatabase =
            SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name).path, factory, errorHandler)
    }
    private class Counting(var bytes: ByteArray) : DataSource.Factory {
        val transferred = AtomicLong()
        override fun createDataSource(): DataSource {
            val source = ByteArrayDataSource(bytes)
            return object : DataSource {
                override fun addTransferListener(listener: TransferListener) = source.addTransferListener(listener)
                override fun open(spec: DataSpec): Long = source.open(spec)
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
                    source.read(buffer, offset, length).also { if (it > 0) transferred.addAndGet(it.toLong()) }
                override fun getUri(): Uri? = source.uri
                override fun getResponseHeaders(): Map<String, List<String>> = source.responseHeaders
                override fun close() = source.close()
            }
        }
    }
    private fun url(media: String = id, segment: Boolean = true, capability: String = "first") =
        "$origin/api/sauti-media/$media/hls/${if (segment) "s_${"a".repeat(43)}" else "m_master"}?c=$capability.${"a".repeat(43)}"
    private fun grants(media: String = id, gen: String = generation, capability: String = "first",
        clock: () -> Long = { 1_000L }) = NativeHlsGrantRegistry(now = clock).apply {
        authorize(NativeVideoSource(media, url(media, false, capability), true, 301_000L, cacheKey = gen))
    }
    private fun resource(context: Context, upstream: DataSource.Factory, pool: NativeVideoReplayPool,
        registry: NativeHlsGrantRegistry = grants(), scope: NativeVideoReplayScope = this.scope,
        active: () -> Boolean = { true }) = NativeVideoPlaybackResources(context, upstream, active,
        hlsGrants = registry, replay = NativeVideoReplayBinding(pool, scope))
    private fun spec(url: String = url()) = DataSpec.Builder().setUri(url).build()
    private fun read(resources: NativeVideoPlaybackResources, url: String = url()): ByteArray {
        val source = resources.dataSourceFactory.createDataSource()
        try {
            source.open(spec(url))
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(7 * 1024)
            while (true) {
                val count = source.read(buffer, 0, buffer.size)
                if (count == C.RESULT_END_OF_INPUT) return out.toByteArray()
                assertTrue(count > 0); out.write(buffer, 0, count)
            }
        } finally { source.close() }
    }
    private fun directories(context: FixtureContext) = context.root.listFiles().orEmpty().filter { it.name.startsWith("replay-video-") }
    private inline fun fixture(block: (FixtureContext) -> Unit) {
        val context = FixtureContext(InstrumentationRegistry.getInstrumentation().targetContext)
        try { block(context) } finally {
            check(context.root.canonicalFile.parentFile == InstrumentationRegistry.getInstrumentation().targetContext.cacheDir.canonicalFile)
            context.root.deleteRecursively()
        }
    }

    @Test fun remountNeedsFreshGrant_thenReusesSameGenerationBytesWithoutAnotherTransfer() = fixture { context ->
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { true })
        try {
            resource(context, network, pool).use { assertArrayEquals(payload, read(it)) }
            assertEquals(payload.size.toLong(), network.transferred.get())
            assertEquals(1, directories(context).size)
            assertTrue("Pooled HLS does not create an unused per-player SQLite cache",
                context.root.listFiles().orEmpty().none { it.name.startsWith("active-video-") })
            resource(context, network, pool, registry = NativeHlsGrantRegistry { 1_000L }).use {
                assertThrows(IOException::class.java) { read(it, url(capability = "renewed")) }
            }
            assertEquals("Old bytes do not authorize a new mount", payload.size.toLong(), network.transferred.get())
            resource(context, network, pool, registry = grants(capability = "renewed")).use {
                assertArrayEquals(payload, read(it, url(capability = "renewed")))
            }
            assertEquals("Fresh authorization reuses bytes rather than redownloading them", payload.size.toLong(), network.transferred.get())
        } finally { pool.close() }
        assertTrue(directories(context).isEmpty())
    }

    @Test fun manifestsAlwaysReachTheAuthorizedUpstream_andMp4NeverSharesAcrossMounts() = fixture { context ->
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { true })
        try {
            repeat(2) { resource(context, network, pool).use { read(it, url(segment = false)) } }
            assertEquals(2L * payload.size, network.transferred.get())
            repeat(2) { resource(context, network, pool).use { read(it, "$origin/api/sauti-media/$id") } }
            assertEquals(4L * payload.size, network.transferred.get())
            assertTrue("Neither manifests nor MP4 create replay stores", directories(context).isEmpty())
        } finally { pool.close() }
    }

    @Test fun generationChangeNeverAliasesOldBytes_evenWhenOpaquePathIsTheSame() = fixture { context ->
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { true })
        val changed = payload.map { (it.toInt() xor 71).toByte() }.toByteArray()
        try {
            resource(context, network, pool).use { read(it) }
            network.bytes = changed
            resource(context, network, pool, registry = grants(gen = nextGeneration)).use { assertArrayEquals(changed, read(it)) }
            assertEquals(2L * payload.size, network.transferred.get())
        } finally { pool.close() }
    }

    @Test fun foreignAccountAuthObjectAndRotatedCredentialCannotBorrowTheStore() = fixture { context ->
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { true })
        try {
            resource(context, network, pool).use { read(it) }
            listOf(NativeVideoReplayScope(Any(), account, "fixture-credential"),
                NativeVideoReplayScope(owner, "other-account", "fixture-credential"),
                NativeVideoReplayScope(owner, account, "rotated-credential")).forEach { other ->
                resource(context, network, pool, scope = other).use { read(it) }
            }
            assertEquals("Rejected namespaces fall through to their own authenticated upstream", 4L * payload.size, network.transferred.get())
        } finally { pool.close() }
    }

    @Test fun idleExpiryAndMonotonicRollbackDiscardRetainedBytes() = fixture { context ->
        var now = 1_000L
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { true }, clock = { now })
        try {
            resource(context, network, pool).use { read(it) }
            now += 120_000L
            resource(context, network, pool).use { read(it) }
            assertEquals(2L * payload.size, network.transferred.get())
            now--
            pool.pruneExpired()
            assertTrue(directories(context).isEmpty())
            resource(context, network, pool).use { read(it) }
            assertEquals(3L * payload.size, network.transferred.get())
        } finally { pool.close() }
    }

    @Test fun logoutInvalidatesAnOpenCachedReader_butDeletesOnlyAfterItsLeaseCloses() = fixture { context ->
        var active = true
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { active })
        try {
            resource(context, network, pool, active = { active }).use { read(it) }
            val mounted = resource(context, network, pool, active = { active })
            val data = mounted.dataSourceFactory.createDataSource()
            try {
                data.open(spec())
                assertTrue(data.read(ByteArray(32), 0, 32) > 0)
                active = false; pool.close()
                assertEquals("An active loader still owns its store until close", 1, directories(context).size)
                assertThrows(IOException::class.java) { data.read(ByteArray(32), 0, 32) }
            } finally { data.close(); mounted.close() }
            assertTrue(directories(context).isEmpty())
            resource(context, network, pool, active = { active }).use { assertThrows(IOException::class.java) { read(it) } }
            assertEquals(payload.size.toLong(), network.transferred.get())
        } finally { pool.close() }
    }

    @Test fun grantExpiryStillBlocksPooledBytesEvenWhenSessionAndStoreRemainActive() = fixture { context ->
        var grantTime = 1_000L
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { true })
        try {
            resource(context, network, pool).use { read(it) }
            resource(context, network, pool, registry = grants(clock = { grantTime })).use {
                grantTime = 301_000L
                assertThrows(IOException::class.java) { read(it) }
            }
            assertEquals(payload.size.toLong(), network.transferred.get())
        } finally { pool.close() }
    }

    @Test fun activeStoreLimitFallsThroughWithoutEvictingReaders_thenIdleLruCanBeReplaced() = fixture { context ->
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { true }, maxStores = 3, maxBytes = 768L * 1024)
        val mounted = mutableListOf<NativeVideoPlaybackResources>()
        val readers = mutableListOf<DataSource>()
        try {
            for (number in 1..3) {
                val media = "00000000-0000-4000-8000-${number.toString().padStart(12, '0')}"
                resource(context, network, pool, registry = grants(media)).also {
                    mounted += it; read(it, url(media))
                    it.dataSourceFactory.createDataSource().also { data ->
                        data.open(spec(url(media))); assertTrue(data.read(ByteArray(1), 0, 1) > 0); readers += data
                    }
                }
            }
            val fourth = "00000000-0000-4000-8000-000000000004"
            resource(context, network, pool, registry = grants(fourth)).use { read(it, url(fourth)); read(it, url(fourth)) }
            assertEquals(5L * payload.size, network.transferred.get())
            assertEquals(3, directories(context).size)
            readers.removeAt(0).close(); mounted.removeAt(0).close()
            resource(context, network, pool, registry = grants(fourth)).use { read(it, url(fourth)); read(it, url(fourth)) }
            assertEquals(6L * payload.size, network.transferred.get())
            assertEquals(3, directories(context).size)
        } finally { readers.forEach { it.close() }; mounted.forEach { it.close() }; pool.close() }
    }

    @Test fun oneShortsResourceCanRetireFiveSequentialClips_andReplayRecentOnesBeyondMp4PinBudget() = fixture { context ->
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { true }, maxStores = 3, maxBytes = 768L * 1024)
        val registry = NativeHlsGrantRegistry { 1_000L }
        val mounted = NativeVideoPlaybackResources(context, network, { true },
            representationPins = NativeVideoRepresentationPins(0), hlsGrants = registry,
            replay = NativeVideoReplayBinding(pool, scope))
        fun authorize(number: Int): String {
            val media = "00000000-0000-4000-8000-${number.toString().padStart(12, '0')}"
            registry.authorize(NativeVideoSource(media, url(media, false), true, 301_000L, cacheKey = generation))
            return url(media)
        }
        try {
            for (number in 1..5) {
                val requested = authorize(number)
                assertArrayEquals(payload, read(mounted, requested))
                assertArrayEquals(payload, read(mounted, requested))
                assertEquals("Each later clip still caches; closed loaders do not pin all three stores forever",
                    number.toLong() * payload.size, network.transferred.get())
            }
            assertEquals(3, directories(context).size)
            read(mounted, authorize(4))
            assertEquals("A recent clip reuses bytes after fresh authorization", 5L * payload.size, network.transferred.get())
            read(mounted, authorize(1))
            assertEquals("An older evicted clip remains playable via fresh upstream", 6L * payload.size, network.transferred.get())
        } finally { mounted.close(); pool.close() }
    }

    @Test fun defaultEightStoresRetainFiveFutureClipsAcrossAuthorizedRemount_andNinthReplacesOldIdleBytes() = fixture { context ->
        val network=Counting(payload)
        val pool=NativeVideoReplayPool(context,scope,{ true },maxBytes=2L*1024*1024)
        fun media(number: Int)="00000000-0000-4000-8000-${number.toString().padStart(12,'0')}"
        fun load(number: Int, capability: String) {
            resource(context,network,pool,registry=grants(media(number),capability=capability)).use {
                assertArrayEquals(payload,read(it,url(media(number),capability=capability)))
            }
        }
        try {
            // Two recent + current + five future stores. Every new resource
            // has its own fresh registry/capability before opening cached bytes.
            for(number in 1..8) load(number,"initial")
            assertEquals(8L*payload.size,network.transferred.get())
            assertEquals(8,directories(context).size)
            for(number in 4..8) load(number,"renewed")
            assertEquals("All five upcoming clips reuse their immutable bytes after remount",
                8L*payload.size,network.transferred.get())
            load(9,"ninth")
            assertEquals(9L*payload.size,network.transferred.get())
            assertEquals("Moving the window cannot retain a ninth disk store",8,directories(context).size)
            load(1,"reauthorized")
            assertEquals("The old idle LRU was evicted and can still load normally",10L*payload.size,network.transferred.get())
        } finally { pool.close() }
    }

    @Test fun unavailableReplayDiskNeverPreventsAuthorizedOnlinePlayback() = fixture { context ->
        context.broken = true
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { true })
        try {
            resource(context, network, pool).use { assertArrayEquals(payload, read(it)); assertArrayEquals(payload, read(it)) }
            assertEquals(2L * payload.size, network.transferred.get())
        } finally { pool.close() }
    }

    @Test fun failedSourceOpenReleasesItsLease_beforeAnotherVideoNeedsTheOnlyStore() = fixture { context ->
        val network = Counting(payload)
        var fail = true
        val upstream = DataSource.Factory {
            val delegate = network.createDataSource()
            object : DataSource by delegate {
                override fun open(dataSpec: DataSpec): Long {
                    if (fail) { fail = false; throw IOException("Fixture source could not open") }
                    return delegate.open(dataSpec)
                }
            }
        }
        val pool = NativeVideoReplayPool(context, scope, { true }, maxStores = 1)
        val first = resource(context, upstream, pool)
        val secondId = "00000000-0000-4000-8000-000000000002"
        try {
            assertThrows(IOException::class.java) { read(first) }
            resource(context, upstream, pool, registry = grants(secondId)).use {
                assertArrayEquals(payload, read(it, url(secondId)))
                assertArrayEquals(payload, read(it, url(secondId)))
            }
            assertEquals("A failed open cannot pin the only store for the viewer lifetime",
                payload.size.toLong(), network.transferred.get())
        } finally { first.close(); pool.close() }
    }

    @Test fun closingResourceDeniesReads_butAnOpenLoaderStillPinsItsStoreUntilClose() = fixture { context ->
        val network = Counting(payload)
        val pool = NativeVideoReplayPool(context, scope, { true }, maxStores = 1)
        val mounted = resource(context, network, pool)
        val data = mounted.dataSourceFactory.createDataSource()
        val otherId = "00000000-0000-4000-8000-000000000002"
        try {
            read(mounted)
            data.open(spec())
            mounted.close()
            assertThrows(IOException::class.java) { data.read(ByteArray(1), 0, 1) }
            pool.trimIdle()
            assertEquals("Resource disposal cannot delete a loader's open cache", 1, directories(context).size)
            resource(context, network, pool, registry = grants(otherId)).use {
                read(it, url(otherId)); read(it, url(otherId))
            }
            assertEquals("The other clip falls through while the old loader owns the only store",
                3L * payload.size, network.transferred.get())
            data.close()
            pool.trimIdle()
            assertTrue(directories(context).isEmpty())
            resource(context, network, pool, registry = grants(otherId)).use {
                read(it, url(otherId)); read(it, url(otherId))
            }
            assertEquals(4L * payload.size, network.transferred.get())
        } finally { data.close(); mounted.close(); pool.close() }
    }

    @Test fun ownerIsLazyAndRotationOrClearCannotReusePreviousRetention() = fixture { context ->
        val replayOwner = NativeVideoReplayOwner(context, owner, account) { true }
        val network = Counting(payload)
        try {
            assertNull(replayOwner.bindingFor(Any(), account, "fixture"))
            assertNull(replayOwner.bindingFor(owner, "other-account", "fixture"))
            val first = replayOwner.bindingFor(owner, account, "fixture")!!
            assertTrue(directories(context).isEmpty())
            NativeVideoPlaybackResources(context, network, { true }, hlsGrants = grants(), replay = first).use { read(it) }
            val rotated = replayOwner.bindingFor(owner, account, "rotated")!!
            assertNotSame(first.pool, rotated.pool)
            assertTrue(directories(context).isEmpty())
            NativeVideoPlaybackResources(context, network, { true }, hlsGrants = grants(), replay = rotated).use { read(it) }
            replayOwner.clear()
            assertTrue(directories(context).isEmpty())
            val new = replayOwner.bindingFor(owner, account, "rotated")!!
            assertNotSame(rotated.pool, new.pool)
            assertEquals(2L * payload.size, network.transferred.get())
        } finally { replayOwner.close() }
        assertNull(replayOwner.bindingFor(owner, account, "rotated"))
    }

    @Test fun backgroundAndMemoryTrimKeepAnActiveReaderHealthy_andPurgeOnlyIdleBytes() = fixture { context ->
        val replayOwner = NativeVideoReplayOwner(context, owner, account) { true }
        val network = Counting(payload)
        try {
            val binding = replayOwner.bindingFor(owner, account, "fixture")!!
            val mounted = NativeVideoPlaybackResources(context, network, { true }, hlsGrants = grants(), replay = binding)
            try {
                read(mounted)
                val data = mounted.dataSourceFactory.createDataSource()
                try {
                    data.open(spec())
                    replayOwner.trimIdle()
                    assertEquals(1, directories(context).size)
                    assertTrue("An ordinary background/trim cannot turn a healthy cache read into an error",
                        data.read(ByteArray(32), 0, 32) > 0)
                } finally { data.close() }
                assertSame(binding, replayOwner.bindingFor(owner, account, "fixture"))
            } finally { mounted.close() }
            replayOwner.trimIdle()
            assertTrue(directories(context).isEmpty())
            NativeVideoPlaybackResources(context, network, { true }, hlsGrants = grants(), replay = binding).use { read(it) }
            assertEquals(2L * payload.size, network.transferred.get())
        } finally { replayOwner.close() }
    }
}
