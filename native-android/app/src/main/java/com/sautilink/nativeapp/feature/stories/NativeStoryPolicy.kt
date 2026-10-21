package com.sautilink.nativeapp.feature.stories

import java.time.Instant

internal object NativeStoryPolicy {
    const val MAX_VIDEO_MS = 30_000L
    const val PHOTO_DISPLAY_MS = 7_000L
    const val MAX_IMAGES_PER_DAY = 4
    const val MAX_VIDEOS_PER_DAY = 2
    const val MAX_CAPTION = 500
    val uuid = Regex("^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")
    val handle = Regex("^[a-z0-9][a-z0-9._]{2,29}$")
    fun active(expiresAt: String, nowMs: Long): Boolean =
        runCatching { Instant.parse(expiresAt).toEpochMilli() > nowMs }.getOrDefault(false)
    fun canCreate(kind: String, imagesUsed: Int, videosUsed: Int): Boolean = when (kind) {
        "image" -> imagesUsed in 0 until MAX_IMAGES_PER_DAY
        "video" -> videosUsed in 0 until MAX_VIDEOS_PER_DAY
        else -> false
    }
    fun next(index: Int, count: Int): Int? = (index + 1).takeIf { it in 0 until count }
    fun previous(index: Int, count: Int): Int = (index - 1).coerceIn(0, (count - 1).coerceAtLeast(0))
    fun progress(positionMs: Long, durationMs: Long): Float =
        if (durationMs <= 0) 0f else (positionMs.toDouble() / durationMs).toFloat().coerceIn(0f, 1f)
    fun reaction(current: String?, tapped: String): String? {
        require(tapped == "love" || tapped == "dislike")
        return if (current == tapped) null else tapped
    }
}

internal data class NativeStoryAuthor(val id: String, val username: String, val displayName: String,
    val verified: Boolean, val badgeType: String, val hasAvatar: Boolean)
internal data class NativeStory(val id: String, val ownerId: String, val kind: String, val caption: String,
    val createdAt: String, val expiresAt: String, val durationMs: Long, val mediaPath: String,
    val thumbnailPath: String, val playbackPath: String, val seen: Boolean,
    val viewerCount: Int, val reaction: String?)
internal data class NativeStoryGroup(val author: NativeStoryAuthor, val stories: List<NativeStory>) {
    val unseenCount get() = stories.count { !it.seen }
}
internal data class NativeStoryQuota(val imagesUsed: Int = 0, val videosUsed: Int = 0, val resetsAt: String = "")
internal data class NativeStoriesFeed(val groups: List<NativeStoryGroup> = emptyList(),
    val quota: NativeStoryQuota = NativeStoryQuota(), val serverOffsetMs: Long = 0) {
    fun activeGroups(nowMs: Long = System.currentTimeMillis()): List<NativeStoryGroup> = groups.map {
        it.copy(stories = it.stories.filter { story -> NativeStoryPolicy.active(story.expiresAt, nowMs + serverOffsetMs) })
    }.filter { it.stories.isNotEmpty() }
    fun unreadCount(ownId: String?, nowMs: Long = System.currentTimeMillis()): Int = activeGroups(nowMs)
        .filter { it.author.id != ownId }.sumOf { it.unseenCount }
}
internal data class NativeStoryViewer(val author: NativeStoryAuthor, val viewedAt: String)
internal data class NativeStoryViewers(val viewers: List<NativeStoryViewer>, val total: Int, val nextCursor: String?)
