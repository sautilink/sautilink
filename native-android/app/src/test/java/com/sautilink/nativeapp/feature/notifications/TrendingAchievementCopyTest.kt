package com.sautilink.nativeapp.feature.notifications

import org.junit.Assert.*
import org.junit.Test

class TrendingAchievementCopyTest {
    @Test fun celebratesOneOrSeveralPostsWithoutInventingARank() {
        assertTrue(trendingAchievementCopy(1, 2).contains("Your post made the Trending Charts · #2"))
        assertTrue(trendingAchievementCopy(3, 1).contains("3 of your posts made the Trending Charts · #1"))
        assertFalse(trendingAchievementCopy(1, 0).contains("#"))
    }
}
