package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.ui.state.SessionScreenPresentation
import com.sautilink.nativeapp.ui.state.SessionScreenPresentationStore

/** Bounded rows and confirmed artwork only; no credentials or playback grants. */
internal data class FeedReturnPresentation(
    val posts: List<StagingFeedPost>, val nextOffset: Int, val hasMore: Boolean,
    val firstIndex: Int, val firstOffset: Int,
    val liked: Map<String, Boolean>, val saved: Map<String, Boolean>, val reposted: Map<String, Boolean>,
    val following: Map<String, Boolean>, val followFeedback: Map<String, Int>,
) : SessionScreenPresentation

internal const val MAX_RETURN_FEED_POSTS = 120

/** Keep nullable cache lookup flow outside the large feed composable. */
internal data class FeedReturnInitialState(
    val restored: Boolean,
    val revision: Long,
    val snapshot: FeedReturnPresentation,
)

internal fun readFeedReturnPresentation(
    store: SessionScreenPresentationStore?,
    key: String,
): FeedReturnInitialState {
    if (store == null) return emptyFeedReturnInitialState(-1L)
    val read = store.read<FeedReturnPresentation>(key)
    val snapshot = read.value
    if (snapshot == null) return emptyFeedReturnInitialState(read.revision)
    return FeedReturnInitialState(true, read.revision, snapshot)
}

private fun emptyFeedReturnInitialState(revision: Long) = FeedReturnInitialState(
    false, revision, FeedReturnPresentation(
        emptyList(), 0, false, 0, 0,
        emptyMap(), emptyMap(), emptyMap(), emptyMap(), emptyMap(),
    ),
)

internal fun buildFeedReturnPresentation(
    posts: List<StagingFeedPost>,
    nextOffset: Int,
    hasMore: Boolean,
    firstIndex: Int,
    firstOffset: Int,
    liked: Map<String, Boolean>,
    saved: Map<String, Boolean>,
    reposted: Map<String, Boolean>,
    following: Map<String, Boolean>,
    followFeedback: Map<String, Int>,
    pendingActions: Set<String>,
    pendingFollowing: Map<String, Boolean>,
): FeedReturnPresentation {
    val ids = posts.map { it.id }.toSet()
    val authors = posts.map { it.authorId }.toSet()
    return FeedReturnPresentation(
        posts.toList(), nextOffset, hasMore, firstIndex, firstOffset,
        confirmedFeedReturnArtwork(liked.filterKeys { it in ids }, pendingActions, "like"),
        confirmedFeedReturnArtwork(saved.filterKeys { it in ids }, pendingActions, "save"),
        confirmedFeedReturnArtwork(reposted.filterKeys { it in ids }, pendingActions, "repost"),
        confirmedFeedReturnArtwork(following.filterKeys { it in authors && it !in pendingFollowing }, pendingActions, "follow"),
        followFeedback.filterKeys { it in authors && it !in pendingFollowing },
    )
}

internal fun confirmedFeedReturnArtwork(states: Map<String, Boolean>, pending: Set<String>, kind: String): Map<String, Boolean> =
    states.filterKeys { "$kind:$it" !in pending }

/** Preserve the reader's position; new head posts use the existing New Posts affordance. */
internal fun mergeReturningFeedRows(current: List<StagingFeedPost>, head: List<StagingFeedPost>): List<StagingFeedPost> {
    val updated = head.associateBy { it.id }
    return current.map { updated[it.id] ?: it }
}
