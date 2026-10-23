package com.sautilink.nativeapp.ui.state

import org.junit.Assert.*
import org.junit.Test

class SessionScreenPresentationStoreTest {
    private data class Anchor(val value: Int) : SessionScreenPresentation
    private data class Filter(val value: String) : SessionScreenPresentation

    @Test fun ownerChangeAndCloseRejectLateWritesAndReads() {
        var owner = "alice"
        val store = SessionScreenPresentationStore("production", "alice", { owner == "alice" })
        val ticket = store.read<Anchor>("home")
        assertTrue(store.save("home", ticket.revision, Anchor(12)))
        owner = "bob"
        assertNull(store.read<Anchor>("home").value)
        assertFalse(store.save("home", ticket.revision, Anchor(20)))
        store.close()
        owner = "alice"
        assertNull(store.read<Anchor>("home").value)
        assertFalse(store.save("home", store.read<Anchor>("home").revision, Anchor(30)))
    }

    @Test fun explicitInvalidationCannotBeUndoneByDisposedScreen() {
        val store = SessionScreenPresentationStore("production", "alice", { true })
        val ticket = store.read<Anchor>("feed:following")
        store.save("feed:following", ticket.revision, Anchor(8))
        store.save("rooms-navigation", ticket.revision, Anchor(2))
        store.invalidate("feed:")
        assertNull(store.read<Anchor>("feed:following").value)
        assertEquals(Anchor(2), store.read<Anchor>("rooms-navigation").value)
        assertFalse(store.save("feed:following", ticket.revision, Anchor(8)))
        val fresh = store.read<Anchor>("feed:following")
        assertTrue(store.save("feed:following", fresh.revision, Anchor(1)))
    }

    @Test fun expiryAndMemoryTrimDoNotLeaveAnAuthorizationLikeFallback() {
        var now = 0L
        val store = SessionScreenPresentationStore("production", "alice", { true }, { now })
        var ticket = store.read<Anchor>("home")
        store.save("home", ticket.revision, Anchor(4))
        now = 300_001L
        assertNull(store.read<Anchor>("home").value)
        ticket = store.read("home")
        store.save("home", ticket.revision, Anchor(6))
        store.invalidate()
        assertEquals(0, store.sizeForTest())
        assertFalse(store.save("home", ticket.revision, Anchor(7)))
    }

    @Test fun boundsEvictLeastRecentlyReadAndRejectWrongSnapshotType() {
        val store = SessionScreenPresentationStore("production", "alice", { true }, maxEntries = 2)
        val ticket = store.read<Anchor>("home")
        store.save("home", ticket.revision, Anchor(1))
        store.save("rooms", ticket.revision, Anchor(2))
        store.read<Anchor>("home")
        store.save("profile", ticket.revision, Anchor(3))
        assertEquals(2, store.sizeForTest())
        assertNull(store.read<Anchor>("rooms").value)
        assertNotNull(store.read<Anchor>("home").value)
        assertNull(store.read<Filter>("home").value)
        assertFalse(store.save("x".repeat(161), ticket.revision, Anchor(9)))
    }

    @Test fun anonymousOwnerNeverRetainsPresentation() {
        val store = SessionScreenPresentationStore("production", null, { true })
        assertFalse(store.save("home", store.read<Anchor>("home").revision, Anchor(1)))
        assertNull(store.read<Anchor>("home").value)
    }

    @Test fun nonnullableDefaultsPreserveMissHitAndInvalidationRevision() {
        val noOwner = readSessionPresentationInitial(null, "home", Anchor::class.java, Anchor(0))
        assertFalse(noOwner.restored)
        assertEquals(-1L, noOwner.revision)
        val store = SessionScreenPresentationStore("production", "alice", { true })
        val missing = readSessionPresentationInitial(store, "home", Anchor::class.java, Anchor(0))
        assertFalse(missing.restored)
        assertEquals(Anchor(0), missing.snapshot)
        assertTrue(store.save("home", missing.revision, Anchor(0)))
        val restored = readSessionPresentationInitial(store, "home", Anchor::class.java, Anchor(0))
        assertTrue(restored.restored)
        assertEquals(missing.snapshot, restored.snapshot)
        store.invalidate()
        val invalidated = readSessionPresentationInitial(store, "home", Anchor::class.java, Anchor(0))
        assertFalse(invalidated.restored)
        assertNotEquals(restored.revision, invalidated.revision)
        assertFalse(store.save("home", restored.revision, Anchor(5)))
    }

    @Test fun optionalHostAccessPreservesNoopAndRevisionGuards() {
        val absent = SessionScreenPresentationAccess(null)
        assertFalse(absent.save("home", -1L, Anchor(3)))
        absent.invalidate()
        val store = SessionScreenPresentationStore("production", "alice", { true })
        val access = SessionScreenPresentationAccess(store)
        val read = store.read<Anchor>("home")
        assertTrue(access.save("home", read.revision, Anchor(3)))
        access.invalidate("home")
        assertNull(store.read<Anchor>("home").value)
        assertFalse(access.save("home", read.revision, Anchor(4)))
    }

    @Test fun destinationKeysSeparateMembersAndKeepEachPrimaryTabIndependent() {
        assertEquals("home", sessionDestinationKey(null, 0))
        assertEquals("inbox", sessionDestinationKey(null, 3))
        assertEquals("own-profile", sessionDestinationKey(null, 4))
        assertNotEquals(sessionDestinationKey("member-profile", 0, "alice"), sessionDestinationKey("member-profile", 0, "bob"))
        assertEquals("videos", sessionDestinationKey("videos", 0))
    }
}
