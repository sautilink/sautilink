package com.sautilink.nativeapp.feature.home

import org.junit.Assert.*
import org.junit.Test

class PostActionFeedCacheTest {
    private val modes = listOf("for_you", "following", "short_videos", "saved", "trending")

    @Test fun confirmedActionRetainsRowsButRejectsOldFirstPageWritesInEveryMode() {
        val cache = StagingFeedCache()
        val owner = "account-a"
        val initial = StagingFeedPage(emptyList(), 15, true)
        val obsolete = StagingFeedPage(emptyList(), 0, false)
        val stamps = modes.associateWith { mode ->
            cache.readStamp("production", owner, mode).also { stamp ->
                cache.finishPage("production", owner, mode, 0, initial, stamp, { owner }, now = 100L)
            }
        }
        assertTrue(cache.invalidatePostActions("production", owner) { owner })
        modes.forEach { mode ->
            assertEquals(Long.MAX_VALUE, cache.ageMs("production", owner, mode, now = 101L))
            assertEquals(initial, cache.cached("production", owner, mode, 10_000L, now = 101L))
            cache.finishPage("production", owner, mode, 0, obsolete, stamps.getValue(mode), { owner }, now = 102L)
            assertEquals(initial, cache.cached("production", owner, mode, 10_000L, now = 103L))
            val fresh = cache.readStamp("production", owner, mode)
            cache.finishPage("production", owner, mode, 0, obsolete, fresh, { owner }, now = 104L)
            assertEquals(1L, cache.ageMs("production", owner, mode, now = 105L))
        }
    }

    @Test fun actionAcknowledgementCannotInvalidateAnotherAccountOrBackend() {
        val cache = StagingFeedCache()
        val aliceProduction = cache.readStamp("production", "alice", "for_you")
        val bobProduction = cache.readStamp("production", "bob", "for_you")
        val aliceStaging = cache.readStamp("staging", "alice", "for_you")
        assertFalse(cache.invalidatePostActions("production", "alice") { "bob" })
        assertFalse(cache.invalidatePostActions("production", "alice") { null })
        assertEquals(aliceProduction, cache.readStamp("production", "alice", "for_you"))
        assertTrue(cache.invalidatePostActions("production", "alice") { "alice" })
        assertNotEquals(aliceProduction, cache.readStamp("production", "alice", "for_you"))
        assertEquals(bobProduction, cache.readStamp("production", "bob", "for_you"))
        assertEquals(aliceStaging, cache.readStamp("staging", "alice", "for_you"))
    }
}
