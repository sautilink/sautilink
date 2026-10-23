package com.sautilink.nativeapp.feature.explore

import com.sautilink.nativeapp.feature.home.StagingFeedPost
import org.junit.Assert.*
import org.junit.Test

class DiscoverTrendingPresentationTest {
    private fun post(n: Int) = StagingFeedPost("post-$n", "author-$n", "Name $n", "member$n",
        true, "standard", "Real post $n", "2026-10-23T12:00:00Z", n * 3, n, 0, 0, emptyList(), false)

    @Test fun discoverKeepsTheExistingRankOrderAndShowsOnlyFiveDistinctPosts() {
        val ranked = listOf(post(9), post(1), post(9), post(7), post(2), post(4), post(8))
        assertEquals(listOf("post-9", "post-1", "post-7", "post-2", "post-4"),
            discoveryTrendingPosts(ranked).map { it.id })
    }
    @Test fun displayedIdentityAndCountsComeFromTheRankedPostWithoutInventedFallbackRows() {
        assertTrue(discoveryTrendingPosts(emptyList()).isEmpty())
        val real = post(3)
        val shown = discoveryTrendingPosts(listOf(real)).single()
        assertEquals(real.authorHandle, shown.authorHandle)
        assertEquals(real.authorName, shown.authorName)
        assertEquals(real.body, shown.body)
        assertEquals(real.likes, shown.likes)
        assertEquals(real.comments, shown.comments)
        assertEquals(real.badgeType, shown.badgeType)
    }
}
