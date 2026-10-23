package com.sautilink.nativeapp.feature.videos

internal data class ShortsTrendingRank(val postId: String, val position: Int)
internal fun shortsRankForPost(postId: String, rank: ShortsTrendingRank?): Int? =
    rank?.takeIf { it.postId == postId && it.position in 1..20 }?.position

internal enum class ShortsFollowPresentation { HIDDEN, READING, FOLLOW, PENDING, FOLLOWING, RETRY_READ }

/** Ephemeral viewer/refresh state. Never put this confirmation in saved state or
 * the session presentation store; a fresh server read hides existing follows.
 */
internal data class ShortsFollowUiState(val following: Boolean? = null,
    val confirmedSinceRefresh: Boolean = false, val pending: Boolean = false,
    val readFailed: Boolean = false, val version: Long = 0L) {
    fun receiveRead(requestVersion: Long, serverFollowing: Boolean): ShortsFollowUiState =
        if (requestVersion != version || pending) this else copy(following = serverFollowing,
            confirmedSinceRefresh = confirmedSinceRefresh && serverFollowing, readFailed = false)
    fun failRead(requestVersion: Long): ShortsFollowUiState =
        if (requestVersion != version || pending) this else copy(readFailed = true)
    fun beginFollow(): ShortsFollowUiState = if (pending || following == true) this else
        copy(pending = true, readFailed = false, version = version + 1)
    fun confirmFollow(requestVersion: Long): ShortsFollowUiState =
        if (!pending || requestVersion != version) this else copy(following = true,
            pending = false, confirmedSinceRefresh = true, version = version + 1)
    fun failFollow(requestVersion: Long): ShortsFollowUiState =
        if (!pending || requestVersion != version) this else copy(following = null,
            pending = false, readFailed = true, version = version + 1)
}

internal fun shortsFollowPresentation(own: Boolean, state: ShortsFollowUiState): ShortsFollowPresentation = when {
    own -> ShortsFollowPresentation.HIDDEN
    state.pending -> ShortsFollowPresentation.PENDING
    state.following == true -> if (state.confirmedSinceRefresh) ShortsFollowPresentation.FOLLOWING else ShortsFollowPresentation.HIDDEN
    state.readFailed -> ShortsFollowPresentation.RETRY_READ
    state.following == false -> ShortsFollowPresentation.FOLLOW
    else -> ShortsFollowPresentation.READING
}

internal data class ShortsAuthorReadScope(val ownerId: String, val refreshGeneration: Int) {
    fun current(owner: String?, generation: Int): Boolean = ownerId == owner && refreshGeneration == generation
}

/** Rank metadata must not compete with the first frame or a depleted buffer. */
internal fun shortsAuthorRanksEligible(foreground: Boolean, online: Boolean,
    playing: Boolean, ready: Boolean, bufferedDurationMs: Long): Boolean =
    foreground && online && playing && ready && bufferedDurationMs >= 6_000L
