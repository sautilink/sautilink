package com.sautilink.nativeapp.ui.components

import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.os.SystemClock
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import kotlinx.coroutines.*
import java.io.Closeable
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Identity only, never permission. The exact credential is digested in memory;
 * neither it, an account ID nor a capability URL is written to the byte index.
 */
internal class NativeVideoReplayScope(private val authOwner: Any, private val accountId: String,
    bearer: String) {
    private val credential = MessageDigest.getInstance("SHA-256").digest(bearer.toByteArray(Charsets.UTF_8))
    init { require(accountId.isNotBlank() && bearer.isNotBlank()) }
    internal fun matches(other: NativeVideoReplayScope): Boolean = authOwner === other.authOwner &&
        accountId == other.accountId && MessageDigest.isEqual(credential, other.credential)
}

internal data class NativeVideoReplayIdentity(val content: String, val generation: String)
internal fun nativeVideoReplayIdentity(identity: String): NativeVideoReplayIdentity? = runCatching {
    val uri = URI(identity)
    if (uri.scheme != "https" || uri.host !in setOf("sautilink.com", "test.sautilink.com") ||
        uri.port != -1 || uri.userInfo != null || uri.rawQuery != null || uri.fragment != null) return null
    val uuid = "[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"
    val match = Regex("/api/sauti-media/($uuid)/hls/($uuid)/s_[A-Za-z0-9_-]{43}").matchEntire(uri.rawPath) ?: return null
    NativeVideoReplayIdentity("${uri.scheme}://${uri.host}/api/sauti-media/${match.groupValues[1]}", match.groupValues[2])
}.getOrNull()

/** Replay stores contain HLS bytes only. Authorization remains with EACH new
 * resource's fresh descriptor/registry; this pool never retains a grant.
 * Limits are aggregate across at most eight media-generation stores, not per
 * player. Each closed loader releases its lease; idle bytes survive <=2 minutes.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal class NativeVideoReplayPool(
    context: Context,
    private val scope: NativeVideoReplayScope,
    private val sessionActive: () -> Boolean,
    private val maxStores: Int = 8,
    private val maxBytes: Long = 64L * 1024 * 1024,
    private val idleTtlMillis: Long = 120_000L,
    private val clock: () -> Long = SystemClock::elapsedRealtime,
    internal val diagnosticOwnerEpoch: Long = 0L,
) : Closeable {
    internal val diagnosticEpoch = NativeVideoReplayProbe.nextEpoch()
    private val context = context.applicationContext
    private val cacheRoot = context.cacheDir
    private val entries = linkedMapOf<NativeVideoReplayIdentity, Entry>()
    private val cleanup = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var closed = false
    internal class Entry(val identity: NativeVideoReplayIdentity, val directory: File,
        val cache: SimpleCache, val database: StandaloneDatabaseProvider,
        val salt: String = UUID.randomUUID().toString(), var references: Int = 0,
        var idleAt: Long? = null, var expiry: Job? = null,
        val identities: MutableSet<String> = hashSetOf(),
        val diagnosticEpoch: Long = NativeVideoReplayProbe.nextEpoch())

    init {
        require(maxStores in 1..8 && maxBytes in maxStores.toLong()..64L * 1024 * 1024)
        require(idleTtlMillis in 1L..120_000L)
        NativeVideoReplayProbe.mark(NativeVideoReplayStage.POOL_CREATE,
            ownerEpoch = diagnosticOwnerEpoch, poolEpoch = diagnosticEpoch)
    }

    internal class Lease internal constructor(private val pool: NativeVideoReplayPool,
        private val entry: Entry) : Closeable {
        private val released = AtomicBoolean(false)
        val cache: SimpleCache get() = entry.cache
        val salt: String get() = entry.salt
        val diagnosticOwnerEpoch: Long get() = pool.diagnosticOwnerEpoch
        val diagnosticPoolEpoch: Long get() = pool.diagnosticEpoch
        val diagnosticStoreEpoch: Long get() = entry.diagnosticEpoch
        fun active(): Boolean = !released.get() && pool.valid(entry)
        fun admit(identity: String): Boolean = !released.get() && pool.admit(entry, identity)
        override fun close() { if (released.compareAndSet(false, true)) pool.release(entry) }
    }

    @Synchronized internal fun accepts(candidate: NativeVideoReplayScope): Boolean {
        if (closed || !scope.matches(candidate)) return false
        if (!sessionActive()) { invalidate(NativeVideoReplayReason.SESSION_END); return false }
        return true
    }

    @Synchronized internal fun acquire(candidate: NativeVideoReplayScope, identity: String): Lease? {
        if (!accepts(candidate)) {
            NativeVideoReplayProbe.mark(NativeVideoReplayStage.ACQUIRE_DENIED,
                reason = if (closed) NativeVideoReplayReason.CLOSED_POOL else NativeVideoReplayReason.SESSION_END,
                ownerEpoch = diagnosticOwnerEpoch, poolEpoch = diagnosticEpoch, identity = identity)
            return null
        }
        val key = nativeVideoReplayIdentity(identity) ?: run {
            NativeVideoReplayProbe.mark(NativeVideoReplayStage.ACQUIRE_DENIED, reason = NativeVideoReplayReason.INVALID_IDENTITY,
                ownerEpoch = diagnosticOwnerEpoch, poolEpoch = diagnosticEpoch, identity = identity)
            return null
        }
        pruneExpired()
        var entry = entries[key]
        if (entry == null) {
            if (entries.size >= maxStores) {
                val oldest = entries.values.filter { it.references == 0 }.minByOrNull { it.idleAt ?: Long.MAX_VALUE }
                    ?: run {
                        NativeVideoReplayProbe.mark(NativeVideoReplayStage.ACQUIRE_DENIED,
                            mediaId = key.content.substringAfterLast('/'), reason = NativeVideoReplayReason.ACTIVE_STORE_LIMIT,
                            ownerEpoch = diagnosticOwnerEpoch, poolEpoch = diagnosticEpoch, generation = key.generation, identity = identity)
                        return null // Active loaders are never evicted to admit another video.
                    }
                entries.remove(oldest.identity); dispose(oldest, NativeVideoReplayReason.LRU)
            }
            entry = create(key) ?: run {
                NativeVideoReplayProbe.mark(NativeVideoReplayStage.ACQUIRE_DENIED,
                    mediaId = key.content.substringAfterLast('/'), reason = NativeVideoReplayReason.STORAGE_UNAVAILABLE,
                    ownerEpoch = diagnosticOwnerEpoch, poolEpoch = diagnosticEpoch, generation = key.generation, identity = identity)
                return null
            }
            entries[key] = entry
            report(NativeVideoReplayStage.STORE_CREATE, entry, identity = identity)
        } else {
            report(NativeVideoReplayStage.STORE_REUSE, entry, identity = identity)
        }
        if (!admit(entry, identity, requireLease = false)) {
            report(NativeVideoReplayStage.ACQUIRE_DENIED, entry, NativeVideoReplayReason.IDENTITY_LIMIT, identity)
            return null
        }
        entry.expiry?.cancel(); entry.expiry = null; entry.idleAt = null; entry.references++
        report(NativeVideoReplayStage.STORE_ACQUIRE, entry, identity = identity)
        return Lease(this, entry)
    }

    @Synchronized private fun valid(entry: Entry): Boolean {
        if (closed) return false
        if (!sessionActive()) { invalidate(NativeVideoReplayReason.SESSION_END); return false }
        return entries[entry.identity] === entry && entry.references > 0
    }

    @Synchronized private fun admit(entry: Entry, identity: String, requireLease: Boolean = true): Boolean {
        if (closed || !sessionActive() || entries[entry.identity] !== entry ||
            (requireLease && entry.references <= 0) || nativeVideoReplayIdentity(identity) != entry.identity) return false
        if (identity in entry.identities) return true
        if (entry.identities.size >= 128) return false
        entry.identities += identity
        return true
    }

    @Synchronized private fun release(entry: Entry) {
        if (entries[entry.identity] !== entry || entry.references <= 0) return
        entry.references--
        report(NativeVideoReplayStage.STORE_RELEASE, entry)
        if (entry.references > 0) return
        if (closed || !sessionActive()) {
            entries.remove(entry.identity); dispose(entry, if (closed) NativeVideoReplayReason.CLOSED_POOL else NativeVideoReplayReason.SESSION_END)
        } else {
            entry.idleAt = clock()
            entry.expiry = cleanup.launch {
                delay(idleTtlMillis)
                synchronized(this@NativeVideoReplayPool) { pruneExpired() }
            }
        }
    }

    @Synchronized internal fun pruneExpired() {
        val now = clock()
        val expired = entries.values.filter { entry -> entry.references == 0 && entry.idleAt?.let {
            now < it || now - it >= idleTtlMillis
        } == true }
        expired.forEach { entries.remove(it.identity); dispose(it, NativeVideoReplayReason.IDLE_TTL) }
    }

    /** Background/memory trimming must not invalidate a mounted player's open
     * CacheDataSource. Only closed-loader, zero-lease stores can be discarded.
     */
    @Synchronized internal fun trimIdle(reason: NativeVideoReplayReason = NativeVideoReplayReason.MEMORY_TRIM, detail: Int = 0) {
        NativeVideoReplayProbe.mark(NativeVideoReplayStage.TRIM, reason = reason,
            ownerEpoch = diagnosticOwnerEpoch, poolEpoch = diagnosticEpoch, detail = detail)
        entries.values.filter { it.references == 0 }.toList().forEach {
            entries.remove(it.identity); dispose(it, reason)
        }
    }

    private fun create(identity: NativeVideoReplayIdentity): Entry? {
        val directory = runCatching { ActiveReplayDirectories.reserve(cacheRoot) }.getOrNull() ?: return null
        var database: StandaloneDatabaseProvider? = null
        var cache: SimpleCache? = null
        return try {
            database = StandaloneDatabaseProvider(context)
            cache = SimpleCache(directory, LeastRecentlyUsedCacheEvictor(maxBytes / maxStores), database)
            cache.checkInitialization()
            Entry(identity, directory, cache, database)
        } catch (_: Exception) {
            runCatching { cache?.release() }
            runCatching { if (database != null) SimpleCache.delete(directory, database) else directory.deleteRecursively() }
            runCatching { database?.close() }
            ActiveReplayDirectories.release(directory)
            null
        }
    }

    private fun report(stage: NativeVideoReplayStage, entry: Entry,
        reason: NativeVideoReplayReason = NativeVideoReplayReason.NONE, identity: String? = null) {
        if (!NativeVideoReplayProbe.enabled) return
        val cacheBytes = runCatching { entry.cache.cacheSpace }.getOrDefault(-1L)
        NativeVideoReplayProbe.mark(stage, mediaId = entry.identity.content.substringAfterLast('/'), reason = reason,
            ownerEpoch = diagnosticOwnerEpoch, poolEpoch = diagnosticEpoch, storeEpoch = entry.diagnosticEpoch,
            generation = entry.identity.generation, identity = identity, cacheBytes = cacheBytes, detail = entry.references)
    }

    private fun dispose(entry: Entry, reason: NativeVideoReplayReason) {
        report(NativeVideoReplayStage.STORE_DISPOSE, entry, reason)
        entry.expiry?.cancel(); entry.expiry = null
        runCatching { entry.cache.release() }
        runCatching { SimpleCache.delete(entry.directory, entry.database) }
        runCatching { entry.database.close() }
        ActiveReplayDirectories.release(entry.directory)
    }

    private fun invalidate(reason: NativeVideoReplayReason) {
        if (closed) return
        NativeVideoReplayProbe.mark(NativeVideoReplayStage.POOL_CLOSE, reason = reason,
            ownerEpoch = diagnosticOwnerEpoch, poolEpoch = diagnosticEpoch)
        closed = true
        cleanup.cancel()
        // Each data source closes its loader before releasing a lease. Invalidation
        // denies reads immediately, but only unused stores can be deleted now.
        entries.values.filter { it.references == 0 }.toList().forEach {
            entries.remove(it.identity); dispose(it, reason)
        }
    }
    @Synchronized internal fun closeFor(reason: NativeVideoReplayReason) { invalidate(reason) }
    @Synchronized override fun close() { invalidate(NativeVideoReplayReason.OWNER_DISPOSE) }
}

internal class NativeVideoReplayBinding internal constructor(internal val pool: NativeVideoReplayPool,
    internal val scope: NativeVideoReplayScope)

/** One session owner, created by the provider without requesting a token. A
 * bearer is supplied only when normal playback creates a resource. Rotation
 * replaces its pool conservatively; stale owners cannot acquire another lease.
 */
internal class NativeVideoReplayOwner(context: Context, private val authOwner: Any,
    private val accountId: String, private val sessionActive: () -> Boolean) : Closeable {
    private val context = context.applicationContext
    private var binding: NativeVideoReplayBinding? = null
    private var closed = false
    private val diagnosticEpoch = NativeVideoReplayProbe.nextEpoch()
    init { NativeVideoReplayProbe.mark(NativeVideoReplayStage.OWNER_CREATE, ownerEpoch = diagnosticEpoch) }
    @Synchronized fun bindingFor(owner: Any, account: String?, bearer: String): NativeVideoReplayBinding? {
        if (closed || owner !== authOwner || account != accountId || bearer.isBlank() || !sessionActive()) return null
        val candidate = NativeVideoReplayScope(owner, accountId, bearer)
        binding?.takeIf { it.pool.accepts(candidate) }?.let {
            NativeVideoReplayProbe.mark(NativeVideoReplayStage.POOL_REUSE, ownerEpoch = diagnosticEpoch,
                poolEpoch = it.pool.diagnosticEpoch)
            return it
        }
        val previous = binding
        if (previous != null) previous.pool.closeFor(if (!previous.scope.matches(candidate))
            NativeVideoReplayReason.CREDENTIAL_ROTATION else NativeVideoReplayReason.OWNER_CLEAR)
        return NativeVideoReplayBinding(NativeVideoReplayPool(context, candidate, sessionActive,
            diagnosticOwnerEpoch = diagnosticEpoch), candidate).also { binding = it }
    }
    @Synchronized fun clear(reason: NativeVideoReplayReason = NativeVideoReplayReason.OWNER_CLEAR) { binding?.pool?.closeFor(reason); binding = null }
    @Synchronized fun trimIdle(reason: NativeVideoReplayReason = NativeVideoReplayReason.MEMORY_TRIM, detail: Int = 0) { binding?.pool?.trimIdle(reason, detail) }
    @Synchronized override fun close() { if (!closed) { closed = true; clear(NativeVideoReplayReason.OWNER_DISPOSE) } }
}

internal val LocalNativeVideoReplayOwner = staticCompositionLocalOf<NativeVideoReplayOwner?> { null }

/** Wrap once around the authenticated application. No token/vault/network read
 * occurs here. Background/memory pressure purges idle retention; auth disposal
 * invalidates everything. Mounted loader leases remain safe on ordinary resume.
 */
@Composable
internal fun NativeVideoReplaySession(auth: StagingAuthClient, content: @Composable () -> Unit) {
    val context = LocalContext.current.applicationContext
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val account = auth.account?.id
    val signedIn = auth.sessionState == StagingSessionState.SIGNED_IN && account != null
    val replayOwner = remember(auth, account) {
        account?.let { id -> NativeVideoReplayOwner(context, auth, id) {
            auth.account?.id == id && auth.sessionState == StagingSessionState.SIGNED_IN
        } }
    }
    SideEffect { if (!signedIn) replayOwner?.clear() }
    DisposableEffect(replayOwner, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) replayOwner?.trimIdle(NativeVideoReplayReason.BACKGROUND)
            if (event == Lifecycle.Event.ON_DESTROY) replayOwner?.clear(NativeVideoReplayReason.DESTROY)
        }
        val trim = object : ComponentCallbacks2 {
            override fun onTrimMemory(level: Int) { replayOwner?.trimIdle(NativeVideoReplayReason.MEMORY_TRIM, level) }
            override fun onLowMemory() { replayOwner?.trimIdle(NativeVideoReplayReason.LOW_MEMORY) }
            override fun onConfigurationChanged(newConfig: Configuration) = Unit
        }
        lifecycle.addObserver(observer)
        context.registerComponentCallbacks(trim)
        onDispose {
            lifecycle.removeObserver(observer); context.unregisterComponentCallbacks(trim); replayOwner?.close()
        }
    }
    CompositionLocalProvider(LocalNativeVideoReplayOwner provides replayOwner.takeIf { signedIn }, content = content)
}

private object ActiveReplayDirectories {
    private val live = mutableSetOf<String>()
    private val name = Regex("replay-video-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    @Synchronized fun reserve(root: File): File {
        val parent = root.canonicalFile
        val directory = File(parent, "replay-video-${UUID.randomUUID()}")
        live += directory.absolutePath
        runCatching { parent.listFiles().orEmpty().forEach { old ->
            if (name.matches(old.name) && old.absolutePath !in live && old.canonicalFile == old.absoluteFile &&
                old.canonicalFile.parentFile == parent) runCatching { old.deleteRecursively() }
        } }
        return directory
    }
    @Synchronized fun release(directory: File) { live -= directory.absolutePath }
}
