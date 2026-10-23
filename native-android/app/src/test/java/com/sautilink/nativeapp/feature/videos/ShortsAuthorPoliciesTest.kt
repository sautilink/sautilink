package com.sautilink.nativeapp.feature.videos

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ShortsAuthorPoliciesTest {
    private fun id(n: Int) = "00000000-0000-4000-8000-${n.toString().padStart(12, '0')}"
    private fun post(n: Int, author: Int = 99, likes: Long = 0, comments: Long = 0, reposts: Long = 0) = JSONObject()
        .put("id", id(n)).put("author_id", id(author)).put("created_at", "2026-10-23T12:00:00Z")
        .put("like_count", likes).put("comment_count", comments).put("repost_count", reposts)

    @Test fun onlyAnActualTopTwentyPostRankCanBeDisplayed() {
        assertEquals(11, shortsRankForPost(id(1), ShortsTrendingRank(id(1), 11)))
        assertNull(shortsRankForPost(id(1), ShortsTrendingRank(id(2), 11)))
        assertNull(shortsRankForPost(id(1), ShortsTrendingRank(id(1), 0)))
        assertNull(shortsRankForPost(id(1), ShortsTrendingRank(id(1), 21)))
        assertNull(shortsRankForPost(id(1), null))
    }
    @Test fun rankingUsesExistingHomeWeightsAndPostIdentityRatherThanAuthorIdentity() {
        val result = shortsTrendingRanks(listOf(post(1, likes = 3), post(2, comments = 2), post(3, reposts = 2)), emptySet())
        assertEquals(listOf(id(2), id(1), id(3)), result.keys.toList())
        assertEquals(3, result.size)
    }
    @Test fun duplicateCandidateListsDoNotConsumeRanksAndBlockedMutedAuthorsAreExcluded() {
        val item = post(1)
        val result = shortsTrendingRanks(listOf(item, item, post(2, author = 50, likes = 100), post(3)), setOf(id(50)))
        assertEquals(setOf(id(1), id(3)), result.keys)
        assertEquals(setOf(1, 2), result.values.map { it.position }.toSet())
    }
    @Test fun onlyTwentyValidServerCandidatesCanReceiveRankMetadata() {
        val rows = (1..25).map { post(it, likes = it.toLong()) } + post(30).put("id", "invalid")
        val result = shortsTrendingRanks(rows, emptySet())
        assertEquals(20, result.size)
        assertEquals(1, result[id(25)]?.position)
        assertNull(result[id(1)])
    }
    @Test fun followingAppearsOnlyAfterTheConfirmedMutationNotDuringTheRequest() {
        val initial = ShortsFollowUiState().receiveRead(0, false)
        assertEquals(ShortsFollowPresentation.FOLLOW, shortsFollowPresentation(false, initial))
        val pending = initial.beginFollow()
        assertEquals(ShortsFollowPresentation.PENDING, shortsFollowPresentation(false, pending))
        assertFalse(pending.confirmedSinceRefresh)
        val confirmed = pending.confirmFollow(pending.version)
        assertEquals(ShortsFollowPresentation.FOLLOWING, shortsFollowPresentation(false, confirmed))
        assertFalse(confirmed.pending)
    }
    @Test fun newSessionOrRefreshHidesAlreadyFollowedAuthorsAndNeverOffersUnfollow() {
        val loaded = ShortsFollowUiState().receiveRead(0, true)
        assertEquals(ShortsFollowPresentation.HIDDEN, shortsFollowPresentation(false, loaded))
        assertEquals(loaded, loaded.beginFollow())
        assertEquals(ShortsFollowPresentation.HIDDEN, shortsFollowPresentation(true, ShortsFollowUiState(following = false)))
    }
    @Test fun staleReadsAndActionResponsesCannotUndoAConfirmedNewerAction() {
        val initial = ShortsFollowUiState(following = false)
        val pending = initial.beginFollow()
        assertEquals(pending, pending.receiveRead(initial.version, false))
        assertEquals(pending, pending.confirmFollow(initial.version))
        val confirmed = pending.confirmFollow(pending.version)
        assertEquals(confirmed, confirmed.failRead(initial.version))
        assertEquals(confirmed, confirmed.receiveRead(initial.version, false))
        assertEquals(ShortsFollowPresentation.FOLLOWING,
            shortsFollowPresentation(false, confirmed.receiveRead(confirmed.version, true)))
    }
    @Test fun readFailureIsRetryableButAnUnconfirmedWriteNeverClaimsFollowing() {
        val unknown = ShortsFollowUiState()
        assertEquals(ShortsFollowPresentation.READING, shortsFollowPresentation(false, unknown))
        assertEquals(ShortsFollowPresentation.RETRY_READ, shortsFollowPresentation(false, unknown.failRead(0)))
        val pending = ShortsFollowUiState(following = false).beginFollow()
        val failed = pending.failFollow(pending.version)
        assertFalse(failed.confirmedSinceRefresh)
        assertEquals(ShortsFollowPresentation.RETRY_READ, shortsFollowPresentation(false, failed))
        assertNull(failed.following)
        assertEquals(ShortsFollowPresentation.HIDDEN,
            shortsFollowPresentation(false, failed.receiveRead(failed.version, true)))
    }
    @Test fun ownerAndRefreshGenerationBoundEveryAsyncRead() {
        val scope = ShortsAuthorReadScope(id(1), 3)
        assertTrue(scope.current(id(1), 3))
        assertFalse(scope.current(id(2), 3))
        assertFalse(scope.current(null, 3))
        assertFalse(scope.current(id(1), 4))
    }
    @Test fun optionalRanksWaitForForegroundMotionAndHealthyBufferedRunway() {
        assertTrue(shortsAuthorRanksEligible(true, true, true, true, 6_000L))
        assertFalse(shortsAuthorRanksEligible(false, true, true, true, 9_000L))
        assertFalse(shortsAuthorRanksEligible(true, false, true, true, 9_000L))
        assertFalse(shortsAuthorRanksEligible(true, true, false, true, 9_000L))
        assertFalse(shortsAuthorRanksEligible(true, true, true, false, 9_000L))
        assertFalse(shortsAuthorRanksEligible(true, true, true, true, 5_999L))
    }
}
