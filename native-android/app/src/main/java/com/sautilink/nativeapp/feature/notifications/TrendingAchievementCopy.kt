package com.sautilink.nativeapp.feature.notifications

internal fun trendingAchievementCopy(count: Int, rank: Int): String {
    val achievement = if (count <= 1) "Your post made the Trending Charts" else "$count of your posts made the Trending Charts"
    val place = if (rank in 1..20) " · #$rank" else ""
    return "Congratulations! $achievement$place. 🎉 Your voice is connecting people. Keep sharing!"
}
