package com.sautilink.nativeapp.ui.components

import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicLong

internal enum class NativeVideoReplayStage {
    OWNER_CREATE, POOL_CREATE, POOL_REUSE, POOL_CLOSE, STORE_CREATE, STORE_REUSE,
    STORE_ACQUIRE, STORE_RELEASE, STORE_DISPOSE, ACQUIRE_DENIED, DESCRIPTOR,
    RESOURCE_IDENTITY, RESOURCE_DENIED, RESOURCE_CLOSE, CACHE_HIT, CACHE_IGNORED, TRIM,
}
internal enum class NativeVideoReplayReason {
    NONE, CREDENTIAL_ROTATION, OWNER_CLEAR, OWNER_DISPOSE, SESSION_END, CLOSED_POOL,
    BACKGROUND, MEMORY_TRIM, LOW_MEMORY, DESTROY, IDLE_TTL, LRU, ACTIVE_STORE_LIMIT,
    INVALID_IDENTITY, IDENTITY_LIMIT, STORAGE_UNAVAILABLE, MISSING_GENERATION, GRANT_UNAVAILABLE,
}
internal data class NativeVideoReplayEvent(
    val stage: NativeVideoReplayStage,
    val mediaId: String?,
    val reason: NativeVideoReplayReason,
    val ownerEpoch: Long,
    val poolEpoch: Long,
    val storeEpoch: Long,
    val generationTag: Long,
    val resourceTag: Long,
    val bytes: Long,
    val cacheBytes: Long,
    val detail: Int,
    val elapsedNanos: Long,
)

/** Instrumentation-only memory sink. No URL, grant, bearer, account identity,
 * cache generation or resource string can enter the event. A new observer gets
 * a fresh in-memory salt, so numeric tags compare identities only within a run.
 * With no observer installed, no hashing, random generation or event allocation
 * takes place. Normal builds never install a sink and produce no replay logs.
 */
internal object NativeVideoReplayProbe {
    private val lock = Any()
    private val epochs = AtomicLong()
    private var salt: ByteArray? = null
    @Volatile private var installed: ((NativeVideoReplayEvent) -> Unit)? = null
    var observer: ((NativeVideoReplayEvent) -> Unit)?
        get() = installed
        set(value) = synchronized(lock) {
            salt?.fill(0)
            salt = if (value == null) null else ByteArray(32).also(SecureRandom()::nextBytes)
            installed = value
        }
    val enabled: Boolean get() = installed != null
    fun nextEpoch(): Long = if (enabled) epochs.incrementAndGet() else 0L

    fun mark(stage: NativeVideoReplayStage, mediaId: String? = null,
        reason: NativeVideoReplayReason = NativeVideoReplayReason.NONE,
        ownerEpoch: Long = 0L, poolEpoch: Long = 0L, storeEpoch: Long = 0L,
        generation: String? = null, identity: String? = null, bytes: Long = 0L, cacheBytes: Long = -1L, detail: Int = 0) {
        val sink = installed ?: return
        runCatching {
            val runSalt = synchronized(lock) { salt?.copyOf() } ?: return
            fun tag(kind: String, value: String?): Long {
                if (value == null) return 0L
                val digest = MessageDigest.getInstance("SHA-256")
                digest.update(runSalt); digest.update(kind.toByteArray(Charsets.UTF_8))
                return ByteBuffer.wrap(digest.digest(value.toByteArray(Charsets.UTF_8))).long
            }
            val safeMedia = mediaId?.takeIf { it.matches(Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")) }
            sink(NativeVideoReplayEvent(stage, safeMedia, reason, ownerEpoch, poolEpoch, storeEpoch,
                tag("generation", generation), tag("resource", identity), bytes.coerceAtLeast(0L),
                cacheBytes.coerceAtLeast(-1L), detail, System.nanoTime()))
            runSalt.fill(0)
        }
    }
}
