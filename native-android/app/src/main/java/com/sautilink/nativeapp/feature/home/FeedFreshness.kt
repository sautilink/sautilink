package com.sautilink.nativeapp.feature.home

import org.json.JSONArray
import java.time.Instant

internal data class FeedHeadStamp(val id: String, val at: Instant)

/** One tiny head projection only: no captions, author profiles, media or action reads. */
internal fun feedHeadRoute(mode: String): String = when (mode) {
    "following" -> "rpc/social_home_feed?p_mode=following&p_limit=5&p_offset=0"
    "for_you", "trending" -> "social_posts?select=id,created_at&circle_id=is.null&parent_post_id=is.null" +
        "&post_status=eq.published&deleted_at=is.null" + (if (mode == "trending") "&visibility=eq.public" else "") +
        "&order=created_at.desc,id.desc&limit=5"
    else -> throw IllegalArgumentException("This feed does not poll for new posts")
}

internal fun parseFeedHead(mode: String, value: String): List<FeedHeadStamp> {
    require(mode in setOf("following", "for_you", "trending"))
    val rows = JSONArray(value)
    require(rows.length() <= 5) { "Feed head exceeded its limit" }
    val uuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
    return (0 until rows.length()).map { index ->
        val row = rows.getJSONObject(index)
        val id = row.getString(if (mode == "following") "post_id" else "id")
        require(uuid.matches(id)) { "Invalid feed pointer" }
        val at = Instant.parse(row.getString(if (mode == "following") "event_at" else "created_at"))
        FeedHeadStamp(id, at)
    }.distinct()
}

/** Keep a fixed successful-refresh watermark. Ranking changes/removals do not
 * reorder the visible list, count as new posts, or erase an already seen alert.
 */
internal class FeedNewPostsTracker {
    private var initialized = false
    private var latest: Instant? = null
    private var idsAtLatest: Set<String> = emptySet()
    var available: Boolean = false
        private set

    fun observe(head: List<FeedHeadStamp>): Boolean {
        if (!initialized) {
            initialized = true
            latest = head.maxOfOrNull { it.at }
            idsAtLatest = head.filter { it.at == latest }.map { it.id }.toSet()
            return false
        }
        if (head.any { row -> latest?.let { row.at > it || row.at == it && row.id !in idsAtLatest } ?: true }) available = true
        return available
    }

    fun refreshed() { initialized = false; latest = null; idsAtLatest = emptySet(); available = false }
}

internal data class FeedReadScope(val accountId: String?, val mode: String, val refreshVersion: Int) {
    fun current(account: String?, currentMode: String, currentRefresh: Int): Boolean =
        accountId != null && accountId == account && mode == currentMode && refreshVersion == currentRefresh
}

/** A confirmed tap may show Following until the next successful refresh. Already
 * followed authors have no feed button; relationship removal lives on profiles.
 */
internal fun feedFollowButtonVisible(following: Boolean?, confirmedSinceRefresh: Boolean, pending: Boolean?): Boolean =
    following != true || confirmedSinceRefresh || pending == true

/** Honor server cooldowns without foreground retry storms. Pointer failures stay
 * quiet; explicit refresh and account/lifecycle changes own their own requests.
 */
internal fun feedHeadPollDelay(error: Throwable, now: Instant = Instant.now()): Long {
    val http = error as? FollowReadHttpFailure ?: return 30_000L
    val header = http.retryAfter?.trim().orEmpty()
    val seconds = header.toLongOrNull()?.takeIf { it >= 0L }
    val wait = seconds?.let { if (it > 900L) 900_000L else it * 1_000L } ?: runCatching {
        java.time.Duration.between(now, java.time.ZonedDateTime.parse(header, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()).toMillis()
    }.getOrNull() ?: 30_000L
    return wait.coerceIn(30_000L, 900_000L)
}
