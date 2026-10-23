package com.sautilink.nativeapp.feature.home

import org.junit.Assert.*
import org.junit.Test
import com.sautilink.nativeapp.ui.state.SessionScreenPresentationStore

class FeedReturnPresentationTest {
    private fun post(id: String, likes: Int = 0) = StagingFeedPost(id, "author", "Member", "member", false,
        "standard", "body", "2026-10-23T00:00:00Z", likes, 0, 0, 0, emptyList(), false)

    @Test fun headRevalidationUpdatesArtworkWithoutReplacingLoadedTailOrMovingReader() {
        val current = listOf(post("a"), post("b"), post("older-page"))
        val result = mergeReturningFeedRows(current, listOf(post("new-head"), post("a", 3), post("b", 2)))
        assertEquals(listOf("a", "b", "older-page"), result.map { it.id })
        assertEquals(listOf(3, 2, 0), result.map { it.likes })
    }
    @Test fun leavingDuringAnUnacknowledgedWriteForcesItsStateToBeReadAgain() {
        val confirmed = mapOf("a" to false, "b" to true, "c" to false)
        val pending = setOf("like:a", "save:b")
        assertEquals(mapOf("b" to true, "c" to false), confirmedFeedReturnArtwork(confirmed, pending, "like"))
        assertEquals(mapOf("a" to false, "c" to false), confirmedFeedReturnArtwork(confirmed, pending, "save"))
    }
    @Test fun emptyDefaultsDoNotPretendThatAReturnSnapshotWasRestored() {
        val store = SessionScreenPresentationStore("production", "alice", { true })
        val missing = readFeedReturnPresentation(store, "feed:for_you")
        assertFalse(missing.restored)
        assertTrue(missing.snapshot.posts.isEmpty())
        assertTrue(store.save("feed:for_you", missing.revision, missing.snapshot))
        val returning = readFeedReturnPresentation(store, "feed:for_you")
        assertTrue(returning.restored)
        assertEquals(missing.snapshot, returning.snapshot)
    }
}
