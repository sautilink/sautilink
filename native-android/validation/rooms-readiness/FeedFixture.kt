package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.auth.StagingAuthClient

// Only data/client boundary types; production Room models and state are compiled unchanged.
data class FeedMedia(val id: String, val kind: String, val position: Int)
data class StagingFeedPost(val id: String, val authorId: String, val authorName: String,
    val authorHandle: String, val verified: Boolean, val badgeType: String, val body: String,
    val createdAt: String, val likes: Int, val comments: Int, val reposts: Int, val mediaCount: Int,
    val media: List<FeedMedia>, val hasAvatar: Boolean)
class StagingFeedClient(auth: StagingAuthClient) {
    suspend fun loadOne(id: String): StagingFeedPost? = error("Unexpected feed read in readiness test")
}
