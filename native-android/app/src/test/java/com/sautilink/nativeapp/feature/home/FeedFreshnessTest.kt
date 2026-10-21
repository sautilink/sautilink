package com.sautilink.nativeapp.feature.home

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class FeedFreshnessTest {
    private val time = Instant.parse("2026-10-21T10:00:00Z")
    private fun head(id: String, seconds: Long = 0) = FeedHeadStamp(id, time.plusSeconds(seconds))

    @Test fun initialPointersAndRankChangesDoNotInterruptReading() {
        val tracker = FeedNewPostsTracker()
        assertFalse(tracker.observe(listOf(head("first"), head("second", -1))))
        assertFalse(tracker.observe(listOf(head("older-ranked-post", -30), head("first"))))
        assertFalse(tracker.observe(emptyList()))
    }
    @Test fun newerPostNoticeSurvivesRemovalsUntilASuccessfulRefresh() {
        val tracker = FeedNewPostsTracker()
        tracker.observe(listOf(head("first")))
        assertTrue(tracker.observe(listOf(head("new", 1))))
        assertTrue(tracker.observe(listOf(head("first"))))
        tracker.refreshed()
        assertFalse(tracker.available)
        assertFalse(tracker.observe(listOf(head("new", 1))))
    }
    @Test fun timestampTiesAndPreviouslyEmptyFeedDoNotMissNewIds() {
        val tracker = FeedNewPostsTracker()
        tracker.observe(listOf(head("first")))
        assertTrue(tracker.observe(listOf(head("different-at-same-time"))))
        tracker.refreshed(); assertFalse(tracker.observe(emptyList()))
        assertTrue(tracker.observe(listOf(head("first-ever-post"))))
    }
    @Test fun realHeadProjectionsParseWithoutLoadingContent() {
        val id = "00000000-0000-4000-8000-000000000001"
        assertEquals(listOf(FeedHeadStamp(id, time)), parseFeedHead("for_you", "[{\"id\":\"$id\",\"created_at\":\"$time\"}]"))
        assertEquals(listOf(FeedHeadStamp(id, time)), parseFeedHead("following", "[{\"post_id\":\"$id\",\"event_at\":\"$time\"}]"))
        assertEquals(emptyList<FeedHeadStamp>(), parseFeedHead("trending", "[]"))
    }
    @Test fun malformedOrOversizedHeadNeverBecomesAFakeNewPost() {
        val id = "00000000-0000-4000-8000-000000000001"
        val row = "{\"id\":\"$id\",\"created_at\":\"$time\"}"
        assertThrows(Exception::class.java) { parseFeedHead("for_you", "[" + List(6) { row }.joinToString(",") + "]") }
        assertThrows(Exception::class.java) { parseFeedHead("for_you", "[{\"id\":\"foreign\",\"created_at\":\"$time\"}]") }
        assertThrows(Exception::class.java) { parseFeedHead("following", "[{\"post_id\":\"$id\",\"event_at\":\"invalid\"}]") }
        assertThrows(IllegalArgumentException::class.java) { feedHeadRoute("saved") }
    }
    @Test fun accountTabAndRefreshChangesRejectLateHeadAndPageCompletions() {
        val read = FeedReadScope("owner-a", "for_you", 3)
        assertTrue(read.current("owner-a", "for_you", 3))
        assertFalse(read.current("owner-b", "for_you", 3))
        assertFalse(read.current(null, "for_you", 3))
        assertFalse(read.current("owner-a", "following", 3))
        assertFalse(read.current("owner-a", "for_you", 4))
    }
    @Test fun followFeedbackIsTemporaryAndNeverAddsAFeedUnfollowControl() {
        assertTrue(feedFollowButtonVisible(false, false, null))
        assertTrue(feedFollowButtonVisible(false, false, true))
        assertTrue(feedFollowButtonVisible(true, true, null))
        assertFalse(feedFollowButtonVisible(true, false, null))
        assertTrue(feedFollowButtonVisible(null, false, null))
    }
    @Test fun quietPollingHonorsServerCooldownRatherThanRetryingImmediately() {
        assertEquals(30_000L, feedHeadPollDelay(java.io.IOException(), time))
        assertEquals(120_000L, feedHeadPollDelay(FollowReadHttpFailure(429, "120"), time))
        assertEquals(900_000L, feedHeadPollDelay(FollowReadHttpFailure(429, "999999999"), time))
        assertEquals(120_000L, feedHeadPollDelay(FollowReadHttpFailure(503, "Wed, 21 Oct 2026 10:02:00 GMT"), time))
    }
    @Test fun explicitRefreshCannotBeOverwrittenByAnOlderFirstPageCacheWrite() {
        val cache = StagingFeedCache()
        val owner = "account-a"
        val oldStamp = cache.readStamp("production", owner, "for_you")
        val old = StagingFeedPage(emptyList(), 15, true)
        cache.finishPage("production", owner, "for_you", 0, old, oldStamp, { owner }, now = 100L)
        cache.invalidateFirstPage("production", owner, "for_you")
        assertEquals(old, cache.cached("production", owner, "for_you", 10_000L, now = 101L))
        assertEquals(Long.MAX_VALUE, cache.ageMs("production", owner, "for_you", now = 101L))
        val fresh = StagingFeedPage(emptyList(), 0, false)
        val freshStamp = cache.readStamp("production", owner, "for_you")
        cache.finishPage("production", owner, "for_you", 0, fresh, freshStamp, { owner }, now = 102L)
        cache.finishPage("production", owner, "for_you", 0, old, oldStamp, { owner }, now = 103L)
        assertEquals(fresh, cache.cached("production", owner, "for_you", 10_000L, now = 104L))
        assertEquals(2L, cache.ageMs("production", owner, "for_you", now = 104L))
    }
}
