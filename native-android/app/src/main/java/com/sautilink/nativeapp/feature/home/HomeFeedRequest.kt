package com.sautilink.nativeapp.feature.home

/** Owner-scoped, one-shot navigation intent; never stored as a lasting feed preference. */
data class HomeFeedRequest(val ownerId: String, val mode: String, val postId: String? = null) {
    init { require(mode in setOf("for_you", "trending")) }
}
