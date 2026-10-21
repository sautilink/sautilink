package com.sautilink.nativeapp.ui.components

import android.content.Context
import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.ConcurrentHashMap

/** Private, bounded bytes for this live player only. Fresh players reauthorize;
 * disposal removes the bytes. Index keys are salted hashes, never credentials,
 * accounts, signed URLs or Media3's caller-provided custom cache keys.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal class NativeVideoPlaybackResources(
    context: Context,
    upstream: DataSource.Factory,
    private val sessionActive: () -> Boolean,
    maxBytes: Long = 32L * 1024 * 1024,
    private val representationPins: NativeVideoRepresentationPins = NativeVideoRepresentationPins(),
    val hlsGrants: NativeHlsGrantRegistry = NativeHlsGrantRegistry(),
) : Closeable {
    private val active = AtomicBoolean(true)
    private val salt = UUID.randomUUID().toString()
    private val directory = runCatching { ActiveVideoCacheDirectories.reserve(context.cacheDir) }.getOrNull()
    private data class Store(val cache: SimpleCache, val database: StandaloneDatabaseProvider)
    private val store: Store? = directory?.let { createStore(context, it, maxBytes) }
    private val cached: DataSource.Factory? = store?.let {
        CacheDataSource.Factory()
            .setCache(it.cache)
            .setUpstreamDataSourceFactory(RequestUriSourceFactory(upstream))
            .setCacheKeyFactory { spec -> hashCacheIdentity(salt, checkNotNull(spec.key)) }
            .setFlags(CacheDataSource.FLAG_BLOCK_ON_CACHE or CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    }

    val dataSourceFactory = DataSource.Factory {
        SessionSource(cached, upstream, ::identityFor, ::allowedRequest) { active.get() && sessionActive() }
    }

    private fun identityFor(spec: DataSpec): String? {
        if (spec.httpMethod != DataSpec.HTTP_METHOD_GET || spec.httpBody != null) return null
        val identity = spec.uri.toString().takeIf { cacheableVideoUri(spec.uri) } ?: hlsGrants.cacheIdentity(spec.uri.toString())
        return identity?.takeIf { representationPins.admit(it) }
    }

    private fun allowedRequest(spec: DataSpec): Boolean =
        if (spec.uri.path?.contains("/hls/") == true) hlsGrants.allows(spec.uri.toString()) else true

    private fun createStore(context: Context, directory: File, maxBytes: Long): Store? {
        var database: StandaloneDatabaseProvider? = null
        var cache: SimpleCache? = null
        return try {
            if (maxBytes <= 0L) throw IOException("Video cache is disabled")
            database = StandaloneDatabaseProvider(context.applicationContext)
            cache = SimpleCache(directory, LeastRecentlyUsedCacheEvictor(maxBytes), database)
            cache.checkInitialization()
            Store(cache, database)
        } catch (_: Exception) {
            runCatching { cache?.release() }
            runCatching { if (database != null) SimpleCache.delete(directory, database) else directory.deleteRecursively() }
            runCatching { database?.close() }
            ActiveVideoCacheDirectories.release(directory)
            null // Storage pressure or an unavailable cache never prevents online playback.
        }
    }

    override fun close() {
        if (!active.compareAndSet(true, false)) return
        // Caller releases the player first, so no loader still owns a cache span.
        runCatching { store?.cache?.release() }
        runCatching { if (store != null && directory != null) SimpleCache.delete(directory, store.database) }
        runCatching { store?.database?.close() }
        directory?.let { ActiveVideoCacheDirectories.release(it) }
        representationPins.clear()
        hlsGrants.clear()
    }

    private class SessionSource(
        private val cached: DataSource.Factory?,
        private val upstream: DataSource.Factory,
        private val cacheIdentity: (DataSpec) -> String?,
        private val requestAllowed: (DataSpec) -> Boolean,
        private val allowed: () -> Boolean,
    ) : DataSource {
        private var delegate: DataSource? = null
        private var request: DataSpec? = null
        private val listeners = mutableListOf<TransferListener>()

        override fun addTransferListener(transferListener: TransferListener) {
            listeners += transferListener
            delegate?.addTransferListener(transferListener)
        }

        override fun open(dataSpec: DataSpec): Long {
            check(delegate == null)
            request = dataSpec
            checkSession()
            val identity = if (cached != null) cacheIdentity(dataSpec) else null
            val source = (if (identity != null) checkNotNull(cached) else upstream).createDataSource()
            delegate = source
            listeners.forEach(source::addTransferListener)
            return try {
                // The caller's DataSpec.key cannot alias qualities or distinct videos.
                val opened = source.open(if (identity != null) dataSpec.buildUpon().setKey(identity).build() else dataSpec)
                checkSession()
                opened
            } catch (error: Exception) {
                runCatching { source.close() }
                delegate = null
                throw error
            }
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            checkSession()
            val count = checkNotNull(delegate).read(buffer, offset, length)
            if (!allowed() || request?.let(requestAllowed) == false) {
                if (count > 0) buffer.fill(0, offset, offset + count)
                throw IOException("Video playback session ended")
            }
            return count
        }

        override fun getUri(): Uri? = delegate?.uri
        override fun getResponseHeaders(): Map<String, List<String>> = delegate?.responseHeaders ?: emptyMap()
        override fun close() {
            try { delegate?.close() } finally { delegate = null; request = null }
        }
        private fun checkSession() {
            if (!allowed() || request?.let(requestAllowed) == false) throw IOException("Video playback authorization ended")
        }
    }
}

/** At most 128 identities enter one live cache. Keep their tiny representation
 * records even after byte eviction, avoiding cache-listener races and lock-order
 * inversions. Further identities play online without caching. The adapter keeps
 * only 32 additional uncached records, so both metadata and stored bytes are bounded.
 */
internal class NativeVideoRepresentationPins(private val maxCachedKeys: Int = 128) {
    private val retained = ConcurrentHashMap<String, Boolean>()
    @Synchronized fun admit(identity: String): Boolean {
        if (retained.containsKey(identity)) return true
        if (maxCachedKeys <= 0 || retained.size >= maxCachedKeys) return false
        retained[identity] = true
        return true
    }
    fun retains(identity: String): Boolean = retained.containsKey(identity)
    fun clear() { retained.clear() }
}

/** CacheDataSource persists a redirected URI in its index. Keep the request URI
 * for cached segments; the validated upstream independently forbids redirects.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private class RequestUriSourceFactory(private val upstream: DataSource.Factory) : DataSource.Factory {
    override fun createDataSource(): DataSource {
        val source = upstream.createDataSource()
        return object : DataSource {
            private var requestUri: Uri? = null
            override fun addTransferListener(transferListener: TransferListener) = source.addTransferListener(transferListener)
            override fun open(dataSpec: DataSpec): Long {
                requestUri = dataSpec.uri
                return source.open(dataSpec)
            }
            override fun read(buffer: ByteArray, offset: Int, length: Int) = source.read(buffer, offset, length)
            override fun getUri(): Uri? = requestUri
            override fun getResponseHeaders(): Map<String, List<String>> = source.responseHeaders
            override fun close() {
                try { source.close() } finally { requestUri = null }
            }
        }
    }
}

/** Cache index identity has a random per-player namespace; no token goes to disk. */
private fun hashCacheIdentity(salt: String, identity: String): String =
    MessageDigest.getInstance("SHA-256").digest("$salt|$identity".toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

/** Only immutable canonical published MP4 paths enter the default cache. */
internal fun cacheableVideoUri(uri: Uri): Boolean =
    uri.scheme == "https" && uri.host in setOf("sautilink.com", "test.sautilink.com") &&
        uri.port == -1 && uri.userInfo == null && uri.fragment == null && uri.encodedPath == uri.path &&
        uri.path?.matches(Regex("/api/sauti-media/[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")) == true &&
        (uri.encodedQuery == null || uri.encodedQuery?.matches(Regex("quality=(240|360|480|720|1080)")) == true)

/** Crash leftovers are removed on the next cache creation. Only our generated UUID
 * directories directly under this cache root qualify; active players are retained.
 */
private object ActiveVideoCacheDirectories {
    private val live = mutableSetOf<String>()
    private val name = Regex("active-video-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    @Synchronized fun reserve(root: File): File {
        val parent = root.canonicalFile
        val directory = File(parent, "active-video-${UUID.randomUUID()}")
        live += directory.absolutePath
        runCatching {
            parent.listFiles().orEmpty().forEach { old ->
                if (name.matches(old.name) && old.absolutePath !in live && old.canonicalFile == old.absoluteFile &&
                    old.canonicalFile.parentFile == parent) runCatching { old.deleteRecursively() }
            }
        }
        return directory
    }
    @Synchronized fun release(directory: File) { live -= directory.absolutePath }
}
