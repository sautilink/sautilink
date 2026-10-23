package com.sautilink.nativeapp.ui.state

/** Presentation only: never credentials, signed media URLs, permission grants, players, or jobs. */
internal interface SessionScreenPresentation

internal data class SessionPresentationRead<T : SessionScreenPresentation>(val value: T?, val revision: Long)

/** Normalize optional reads before a large composable establishes its local flow graph. */
internal data class SessionPresentationInitial<T : SessionScreenPresentation>(
    val restored: Boolean,
    val revision: Long,
    val snapshot: T,
)

internal fun <T : SessionScreenPresentation> readSessionPresentationInitial(
    store: SessionScreenPresentationStore?, key: String, type: Class<T>, default: T,
): SessionPresentationInitial<T> {
    if (store == null) return SessionPresentationInitial(false, -1L, default)
    val read = store.readTyped(key, type)
    val snapshot = read.value
    if (snapshot == null) return SessionPresentationInitial(false, read.revision, default)
    return SessionPresentationInitial(true, read.revision, snapshot)
}

/** A small, memory-only return stack. Every network read and mutation still authorizes normally. */
internal class SessionScreenPresentationStore(
    val backendId: String,
    val accountId: String?,
    private val isCurrentOwner: () -> Boolean,
    private val clock: () -> Long = { System.nanoTime() / 1_000_000 },
    private val maxEntries: Int = 12,
    private val maxAgeMillis: Long = 5 * 60_000L,
) {
    private data class Entry(val value: SessionScreenPresentation, val savedAt: Long)
    private val entries = LinkedHashMap<String, Entry>(16, .75f, true)
    private var revision = 0L
    private var closed = false

    init { require(maxEntries in 1..24 && maxAgeMillis in 1..300_000L) }

    inline fun <reified T : SessionScreenPresentation> read(key: String): SessionPresentationRead<T> = readTyped(key, T::class.java)

    @PublishedApi
    @Synchronized internal fun <T : SessionScreenPresentation> readTyped(key: String, type: Class<T>): SessionPresentationRead<T> {
        if (!usable() || !validKey(key)) return SessionPresentationRead(null, revision)
        val now = clock()
        entries.entries.removeAll { now - it.value.savedAt !in 0..maxAgeMillis }
        val value = entries[key]?.value
        return SessionPresentationRead(if (type.isInstance(value)) type.cast(value) else null, revision)
    }

    @Synchronized fun save(key: String, expectedRevision: Long, value: SessionScreenPresentation): Boolean {
        if (!usable() || !validKey(key) || expectedRevision != revision) return false
        entries[key] = Entry(value, clock())
        while (entries.size > maxEntries) entries.remove(entries.keys.first())
        return true
    }

    /** Revokes older writers too, so a disposed screen cannot repopulate invalidated rows. */
    @Synchronized fun invalidate(prefix: String? = null) {
        revision++
        if (prefix == null) entries.clear() else entries.keys.removeAll { it.startsWith(prefix) }
    }

    @Synchronized fun close() { closed = true; revision++; entries.clear() }
    @Synchronized internal fun sizeForTest() = entries.size
    private fun usable() = !closed && accountId != null && isCurrentOwner()
    private fun validKey(key: String) = key.isNotBlank() && key.length <= 160 && key.none { it.isISOControl() }
}

internal fun sessionDestinationKey(detail: String?, root: Int, entity: String = ""): String = when (detail) {
    null -> when (root) { 0 -> "home"; 1 -> "explore"; 3 -> "inbox"; 4 -> "own-profile"; else -> "home" }
    "member-profile", "post", "entity-explore" -> "$detail:${entity.take(110)}"
    else -> detail.take(120)
}
